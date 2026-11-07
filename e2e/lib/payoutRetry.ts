// AS2: helpers for the payout-retry races. The payout job works on every payout in the database, so a run
// started by another test (in another worker) can take a payout's retry, send it and report it in its own
// answer. A test therefore checks the payout itself, once it has settled, not which run's answer listed it.
import crypto from 'crypto'
import { expect } from '@playwright/test'
import { db, ageBooking } from './db'
import { fakes } from './fakes'
import { COMMISSION } from './invariants'
import { cron, type Actor, type Reply, type World } from './world'

const DAY = 86_400_000

/**
 * A paid short stay whose payout is due and whose first transfer failed (Paystack answered 500).
 * `due: true` (default) sets the failure back two hours, past the retry delay, so any run may retry it,
 * including another test's. `due: false` keeps the failure fresh, so no run retries it.
 *
 * `rowFirst` (AS17): the failed payout is written as the job writes it (lib/payouts.ts: the row, then the 500
 * recorded as its failure) BEFORE the stay falls due, so no run of the job, this test's or another's, can ever
 * hold the stay in its list of due stays without a payout. Without it a run that read its list in the moment
 * between the stay falling due and the payout being made reaches the stay later, takes a retry claimed meanwhile
 * and sends it at once. `onDue` runs as soon as the stay is due (in either order), for a test that starts a run
 * there on purpose.
 */
export async function failedPayout(world: World, host: Actor, o: { due?: boolean; rowFirst?: boolean; onDue?: () => Promise<unknown> } = {}) {
  const guest = await world.guest()
  const home = await world.listing(host, { priceNightly: 100 })
  const { id } = await world.paidBooking(guest, home.id, { nights: 2 })
  const booking = await db.booking.findUniqueOrThrow({ where: { id } })
  const fallDue = () => ageBooking(id, Math.ceil((booking.checkIn.getTime() - Date.now()) / DAY) + 3)
  if (o.rowFirst) {
    const h = await db.user.findUniqueOrThrow({ where: { id: booking.hostId } })
    const now = new Date()
    await db.payout.create({
      data: {
        hostId: booking.hostId, bookingId: id, instalmentId: null, instalmentSeq: 0,
        amount: booking.subtotal * (1 - COMMISSION), currency: 'USD',
        method: h.payoutMethod ?? 'MOMO', momoNetwork: h.payoutMomoNetwork, momoNumber: h.payoutMomoNumber,
        accountNumber: h.payoutMethod === 'BANK_TRANSFER' ? h.payoutBankAccountNumber : h.payoutMomoNumber,
        accountName: h.payoutBankAccountName,
        paystackTransferReference: `pyt-${crypto.randomUUID()}`,
        status: 'FAILED', failureReason: 'Paystack returned HTTP 500: Internal server error (fake)',
        initiatedAt: now, lastFailedAt: now,
      },
    })
    await fallDue()
    await o.onDue?.()
  } else {
    await fallDue()
    await o.onDue?.()
    const undo = await fakes.rule('transfer', 'http500', { match: `booking ${id}`, times: 1 })
    await cron('process-payouts')
    // (another test's run of the job may be making this payout's first attempt: wait for it)
    await expect.poll(async () => (await db.payout.findFirst({ where: { bookingId: id } }))?.status, { timeout: 20_000 }).toBe('FAILED')
    await undo()
  }
  const failed = await db.payout.findFirstOrThrow({ where: { bookingId: id } })
  expect(await fakes.transfers(`booking ${id}`)).toHaveLength(0)
  if (o.due !== false) await db.payout.update({ where: { id: failed.id }, data: { lastFailedAt: new Date(Date.now() - 2 * 3_600_000) } })
  return { bookingId: id, payoutId: failed.id, reference: failed.paystackTransferReference! }
}

/**
 * Exactly what retryFailedPayouts' claim writes (lib/payouts.ts), with no run carrying on afterwards: a run
 * that claimed the retry and died before calling Paystack. `madeAgo` sets when the payout was made: in
 * production a retry always comes at least 30 minutes after the payout was made (the retry delay).
 */
export async function claimedRetryNobodyIsSending(payoutId: string, madeAgo: number) {
  const claimed = await db.payout.updateMany({
    where: { id: payoutId, status: 'FAILED', retryCount: 0 },
    data: { status: 'PENDING', retryCount: { increment: 1 }, failureReason: null, completedAt: null, initiatedAt: null, createdAt: new Date(Date.now() - madeAgo) },
  })
  expect(claimed.count, 'the retry was claimed by the test, as a run would').toBe(1)
}

/** The payout once no run is still working on it (no longer PENDING), as resilience/paystack.spec.ts does. */
export async function settledPayout(payoutId: string, timeout = 20_000) {
  await expect.poll(async () => (await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).status, { timeout, message: `payout ${payoutId} still PENDING after ${timeout} ms` }).not.toBe('PENDING')
  return db.payout.findUniqueOrThrow({ where: { id: payoutId } })
}

type Said = { bookingId?: string; payoutId?: string; action?: string; ok?: boolean; unanswered?: boolean; status?: string; error?: string }
/** What one run's answer said about this payout: new and resumed payouts are listed by booking, retries by payout. */
export const saidAbout = (reply: Reply, bookingId: string, payoutId: string): string[] =>
  Object.entries((reply.json ?? {}) as Record<string, unknown>).flatMap(([list, v]) => Array.isArray(v)
    ? (v as Said[]).filter((x) => x?.bookingId === bookingId || x?.payoutId === payoutId).map((x) =>
      `${list}: ${x.action ?? (x.ok ? 'retry sent' : x.unanswered ? 'retry unanswered' : 'retry not sent')}, ${x.status}${x.error ? ` (${x.error})` : ''}`)
    : [])

/** Which of these runs listed the payout, or that none did (another test's run took it). */
export function listedBy(runs: Reply[], bookingId: string, payoutId: string, names?: string[]): string {
  const by = runs.map((r, i) => ({ name: names?.[i] ?? `run ${i + 1}`, said: saidAbout(r, bookingId, payoutId) })).filter((x) => x.said.length)
  return by.length ? by.map((x) => `${x.name} (${x.said.join('; ')})`).join(', ') : 'none of these runs (another test\'s run of the job)'
}

/** What Paystack (the fake) was asked about this payout since `since`. */
export async function paystackAsked(since: number, bookingId: string, reference: string) {
  return (await fakes.calls({ service: 'paystack' })).filter((c) => c.at >= since && (c.text.includes(`booking ${bookingId}`) || c.text.includes(reference)))
}

import crypto from 'crypto'
import * as Sentry from '@sentry/nextjs'
import { db } from '@/lib/db'
import { Prisma, type Payout } from '@prisma/client'
import { PayoutsOffError, payoutGate, payoutLimitPesewas } from '@/lib/payoutSwitches'
import { isSettled } from '@/lib/rentRules'
import { OPEN_DISPUTE_STATUSES, PAYABLE_REFUND_REASONS, hostShare } from '@/lib/disputes'
import { notify } from '@/lib/messaging/notify'
import { HOST_ID_SELECT, HostIdNotApprovedError, WAITING_FOR_HOST_ID, hostIdApproved } from '@/lib/hostId'
import { PayoutMethodTooNewError, WAITING_FOR_NEW_METHOD, payoutMethodSettled } from '@/lib/payoutMethod'
import { HostSuspendedError, WAITING_FOR_SUSPENSION, isSuspended } from '@/lib/suspension'
import { NO_CEDI_AMOUNT } from '@/lib/cediShare'
import { OutboundTimeoutError, readWithRetry, sendOnce } from '@/lib/outbound'
import { payoutCedis } from '@/lib/payoutCedis'

const PAYSTACK_BASE = 'https://api.paystack.co'
const MIN_TRANSFER_PESEWAS = 100 // Paystack's own floor is GHS 1

/** A payout claimed for sending this long ago, with no answer recorded, is
 *  treated as abandoned (the run crashed) and may be picked up again. */
export const STALE_CLAIM_MS = 15 * 60 * 1000

function getSecret(): string {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
    throw new Error('Paystack is not configured — set PAYSTACK_SECRET_KEY in .env')
  }
  return secret
}

export type InitiateHostPayoutResult = {
  ok: boolean
  payout: Payout
  error?: string
  /** true if Paystack was never called this time because the row already
   *  had a transfer code (or a terminal status) from a previous attempt. */
  alreadyInitiated?: boolean
  /** true when Paystack did not answer, so nobody knows yet whether the
   *  transfer was made. The row stays PENDING and nothing is recorded as
   *  failed; the next run asks Paystack before it sends anything. */
  unanswered?: boolean
}

/** Recorded nowhere: the reason given in the job's report while a transfer's fate is not known. */
export const TRANSFER_UNANSWERED = 'Paystack did not answer in time. The transfer will be checked before anything is sent again.'

/**
 * Initiates (or safely resumes) the Paystack transfer that pays a host for
 * one booking. This is a plain callable function, not a route — the next
 * slice wires a scheduler/trigger up to call it; for now it's meant to be
 * called directly (e.g. from a script or an admin action) or exercised in
 * tests.
 *
 * Safe to call more than once for the same (hostId, bookingId): the Payout
 * row is found-or-created in PENDING status BEFORE any Paystack call, so a
 * crash between "we decided to pay this" and "Paystack confirmed it" never
 * loses the record — a retry just picks the same row back up. Once that
 * row has a paystackTransferCode (or has reached a terminal status), this
 * function will not call Paystack again for it; it just returns the
 * existing state.
 *
 * Safe to call at the same moment from two places too: the database allows
 * one Payout per booking, and only the caller that claims the row (below)
 * goes on to call Paystack.
 *
 * Refuses to do anything while payouts are switched off (see
 * lib/payoutSwitches.ts), or for a booking made before PAYOUTS_NOT_BEFORE.
 * This is the only place a transfer is started, so the switch covers every
 * caller.
 *
 * `amount` is the USD amount to actually pay the host — i.e. already net
 * of platform commission — not the booking's gross price.
 *
 * What is sent is that share of the cedis the guest actually paid
 * (lib/payoutCedis.ts), not a conversion at today's rate. A payout whose
 * payment has no stored cedi amount is HELD with an alert, like one over the
 * limit: it is never converted at today's rate.
 *
 * With `instalmentId` the payout is for one rent instalment of a monthly or
 * long-term booking, which must be settled. There is one payout per
 * instalment; a booking with none has one payout, stored with instalmentSeq 0.
 *
 * A payout above PAYOUT_LIMIT_GHS is not sent: it is marked HELD, an alert is
 * raised once, and a person pays it. It is never split or retried.
 *
 * Refuses a host whose ID is not approved (lib/hostId.ts), before a row is
 * created or claimed, so nothing is written and nothing is marked failed: the
 * payout simply waits. Like the switch, this covers every caller.
 */
export async function initiateHostPayout({
  hostId,
  bookingId,
  amount,
  instalmentId,
}: {
  hostId: string
  bookingId: string
  amount: number
  instalmentId?: string | null
}): Promise<InitiateHostPayoutResult> {
  const gate = payoutGate()
  if (!gate.live) throw new PayoutsOffError(gate.reason)

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      createdAt: true, status: true, subtotal: true,
      refund: { select: { reason: true, stayRefund: true } },
      disputes: { where: { raisedByRole: 'GUEST', status: { in: OPEN_DISPUTE_STATUSES } }, select: { id: true } },
    },
  })
  if (!booking) {
    throw new Error(`Booking ${bookingId} not found`)
  }
  // A cancelled or refunded stay is never paid out. The cron's own query
  // already leaves cancelled bookings out; this covers a payout row that was
  // created earlier and is being resumed or retried after the cancellation.
  // The exception is a refund that leaves the host owed something: a
  // dispute's part refund, or a deposit going back to the guest.
  const refundBlocks = !!booking.refund && !PAYABLE_REFUND_REASONS.includes(booking.refund.reason)
  if (booking.status === 'CANCELLED' || booking.status === 'DECLINED' || refundBlocks) {
    throw new Error(`Booking ${bookingId} is cancelled or refunded: no payout`)
  }
  // A guest's open dispute holds the payout until an admin decides
  if (booking.disputes?.length) {
    throw new Error(`Booking ${bookingId} has an open dispute: payout on hold`)
  }
  const instalment = instalmentId
    ? await db.instalment.findUnique({ where: { id: instalmentId }, select: { id: true, bookingId: true, sequence: true, status: true, amount: true, coveredFromDeposit: true } })
    : null
  if (instalmentId) {
    if (!instalment || instalment.bookingId !== bookingId) {
      throw new Error(`Instalment ${instalmentId} not found on booking ${bookingId}`)
    }
    // Rent that has not been paid or covered in full is never paid out
    if (!isSettled(instalment)) {
      throw new Error(`Instalment ${instalmentId} is not settled: no payout`)
    }
  }
  // Never more than the host's share: of this instalment's rent, or of what
  // is left of the stay price. A dispute's part refund comes out of the first
  // payment, so it reduces the first instalment only.
  if (instalment) {
    const share = hostShare(instalment.amount, instalment.sequence === 1 ? booking.refund?.stayRefund ?? 0 : 0)
    if (amount > share + 0.005) {
      throw new Error(`Payout of ${amount} for instalment ${instalment.id} is more than the host's share of ${share}`)
    }
  } else if (typeof booking.subtotal === 'number') {
    const share = hostShare(booking.subtotal, booking.refund?.stayRefund ?? 0)
    if (amount > share + 0.005) {
      throw new Error(`Payout of ${amount} for booking ${bookingId} is more than the host's share of ${share}`)
    }
  }
  if (booking.createdAt.getTime() < gate.notBefore.getTime()) {
    throw new PayoutsOffError(`booking ${bookingId} was made before PAYOUTS_NOT_BEFORE`)
  }

  const host = await db.user.findUnique({ where: { id: hostId }, include: { verification: HOST_ID_SELECT.verification } })
  if (!host) {
    throw new Error(`Host ${hostId} not found`)
  }
  // No money is sent to a suspended account (lib/suspension.ts). Thrown before
  // any row is created or claimed: the payout waits until it is restored.
  if (isSuspended(host)) {
    throw new HostSuspendedError(hostId)
  }
  // No money is sent to a host whose ID FieGH has not approved. Thrown before
  // any row is created or claimed: the payout waits and is tried again later.
  if (!hostIdApproved(host)) {
    throw new HostIdNotApprovedError(hostId)
  }
  if (!host.paystackRecipientCode || !host.payoutMethodVerifiedAt) {
    throw new Error(`Host ${hostId} has no verified payout method`)
  }
  // A payout method saved in the last day is not paid into yet (lib/payoutMethod.ts).
  // Also before any row is created or claimed: the payout waits.
  if (!payoutMethodSettled(host)) {
    throw new PayoutMethodTooNewError(hostId)
  }

  // Find-or-create the Payout row for this booking FIRST, before any
  // network call — this is the record that survives a crash mid-call.
  const instalmentSeq = instalment?.sequence ?? 0
  let payout = await db.payout.findFirst({ where: { hostId, bookingId, instalmentSeq } })
  if (!payout) {
    try {
      payout = await db.payout.create({
        data: {
          hostId,
          bookingId,
          instalmentId: instalment?.id ?? null,
          instalmentSeq,
          amount,
          currency: 'USD',
          method: host.payoutMethod ?? 'MOMO',
          momoNetwork: host.payoutMomoNetwork,
          momoNumber: host.payoutMomoNumber,
          accountNumber: host.payoutMethod === 'BANK_TRANSFER' ? host.payoutBankAccountNumber : host.payoutMomoNumber,
          accountName: host.payoutBankAccountName,
          status: 'PENDING',
          // Our own idempotent key — generated once here and reused on every
          // retry of this same row, unless Paystack already consumed it on a
          // transfer that then conclusively failed (see retryFailedPayouts).
          paystackTransferReference: newTransferReference(),
        },
      })
    } catch (error) {
      // Another run created this payout a moment ago: the unique index on
      // (bookingId, instalmentSeq) refused ours, so use theirs.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      payout = await db.payout.findFirst({ where: { bookingId, instalmentSeq } })
      if (!payout) throw error
    }
  }

  // Idempotency guard: already has a real Paystack transfer code, or has
  // already reached a terminal state from a prior real attempt — do not
  // call Paystack again no matter how many times this is retried.
  // A HELD payout is over the transfer limit and waits for a person.
  if (payout.paystackTransferCode || payout.status === 'COMPLETED' || payout.status === 'FAILED' || payout.status === 'HELD') {
    return { ok: payout.status !== 'FAILED' && payout.status !== 'HELD', payout, alreadyInitiated: true }
  }

  // Claim the row before any network call, so two runs holding the same
  // PENDING row cannot both send it. A claim older than STALE_CLAIM_MS with
  // nothing recorded is a run that died; taking it over reuses the same
  // reference, which Paystack will not pay twice.
  // An earlier attempt may have reached Paystack: a claim that went stale (the
  // run died, or Paystack never answered), or a retry after a failure.
  const mayHaveBeenSent = payout.initiatedAt !== null || payout.retryCount > 0
  const claimedAt = new Date()
  const claim = await db.payout.updateMany({
    where: {
      id: payout.id,
      status: 'PENDING',
      paystackTransferCode: null,
      OR: [{ initiatedAt: null }, { initiatedAt: { lte: new Date(claimedAt.getTime() - STALE_CLAIM_MS) } }],
    },
    data: { initiatedAt: claimedAt },
  })
  if (claim.count === 0) {
    return { ok: true, payout, alreadyInitiated: true }
  }

  const secret = getSecret()

  // Before anything is sent a second time, ask Paystack what it holds under
  // this reference and act on that. A refusal of a duplicate reference is
  // not relied on.
  if (mayHaveBeenSent && payout.paystackTransferReference) {
    const held = await findTransfer(payout.paystackTransferReference, secret)
    if (held === 'unknown') {
      // Could not ask: nothing is sent and nothing is marked failed. The claim
      // goes stale and the next run asks again.
      return { ok: false, payout, error: TRANSFER_UNANSWERED, unanswered: true }
    }
    if (held) return { ...(await adoptTransfer(payout.id, held)), alreadyInitiated: true }
  }

  // The host's share of the cedis the guest paid, at the rate they paid at
  const [amountPesewas] = await payoutCedis([{ bookingId, instalmentId: instalment?.id ?? null, coveredFromDeposit: instalment?.coveredFromDeposit, amount }])
  // A payment from before cedi amounts were stored: a person works it out.
  // Never a guess at today's rate.
  if (amountPesewas === null) {
    const held = await holdPayout(payout.id, NO_CEDI_AMOUNT, 'NO_CEDI_AMOUNT', {})
    return { ok: false, payout: held, error: NO_CEDI_AMOUNT }
  }

  if (amountPesewas < MIN_TRANSFER_PESEWAS) {
    const failed = await recordPayoutFailure(payout.id, 'Amount too small to transfer via Paystack', { initiatedAt: new Date() })
    return { ok: false, payout: failed, error: 'Amount too small to transfer via Paystack' }
  }

  // Over the most one transfer may be: held for a person, never split into
  // smaller transfers and never sent to Paystack to be refused.
  const limit = payoutLimitPesewas()
  if (limit !== null && amountPesewas > limit) {
    const held = await holdPayout(
      payout.id,
      `Over the transfer limit: GHS ${(amountPesewas / 100).toFixed(2)} is more than the GHS ${(limit / 100).toFixed(2)} one transfer may be. Pay it by hand.`,
      'OVER_LIMIT', { amountPesewas, limitPesewas: limit },
    )
    notify('payout.held', { payoutId: held.id })
    return { ok: false, payout: held, error: held.failureReason ?? 'Over the transfer limit' }
  }

  try {
    // One attempt with a time limit, never repeated here (lib/outbound.ts)
    const res = await sendOnce(`${PAYSTACK_BASE}/transfer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'balance',
        amount: amountPesewas,
        recipient: host.paystackRecipientCode,
        reference: payout.paystackTransferReference,
        reason: `FieGH host payout — booking ${bookingId}${instalment ? `, rent ${instalment.sequence}` : ''}`,
      }),
    })
    const raw = await res.text()
    let json: { status?: boolean; message?: string; data?: { transfer_code?: string; status?: string } } | null = null
    try { json = JSON.parse(raw) } catch { /* handled below via !json */ }

    if (!res.ok || !json?.status || !json.data?.transfer_code) {
      console.error('[Payouts] Paystack transfer initiate failed:', { httpStatus: res.status, raw })
      // The HTTP status is kept alongside Paystack's message because it's
      // what tells a 5xx (their side, worth retrying) apart from a 4xx.
      const failed = await recordPayoutFailure(
        payout.id,
        `Paystack returned HTTP ${res.status}${json?.message ? `: ${json.message}` : ''}`,
        { initiatedAt: new Date() },
      )
      return { ok: false, payout: failed, error: json?.message || 'Failed to initiate transfer' }
    }

    // Paystack transfers can require OTP finalization depending on the
    // account's dashboard settings — data.status will be "otp" rather than
    // "pending"/"success" in that case. Either way we now have a real
    // transfer_code; final settlement status still comes via webhook.
    const updated = await db.payout.update({
      where: { id: payout.id },
      data: {
        status: 'PROCESSING',
        paystackTransferCode: json.data.transfer_code,
        initiatedAt: new Date(),
      },
    })
    return { ok: true, payout: updated }
  } catch (error) {
    // No answer in time: Paystack may have made the transfer. It is NOT
    // recorded as failed, which would send it again on a retry. The row stays
    // PENDING under its claim, and the next run asks Paystack first.
    if (error instanceof OutboundTimeoutError) {
      console.error(`[Payouts] Paystack did not answer for payout ${payout.id}: left PENDING to be checked`)
      return { ok: false, payout, error: TRANSFER_UNANSWERED, unanswered: true }
    }
    console.error('[Payouts] Transfer initiate network error:', error)
    const failed = await recordPayoutFailure(
      payout.id,
      `Network error calling Paystack: ${error instanceof Error ? error.message : 'unknown'}`,
      { initiatedAt: new Date() },
    )
    return { ok: false, payout: failed, error: 'Network error calling Paystack' }
  }
}

type PaystackTransfer = { transfer_code?: string; status?: string }

/**
 * Asks Paystack for the transfer made under one of our references. Read-only.
 * Returns it, null when Paystack has none, or 'unknown' when Paystack could
 * not be asked (in which case nothing must be sent).
 */
async function findTransfer(reference: string, secret: string): Promise<PaystackTransfer | null | 'unknown'> {
  try {
    const res = await readWithRetry(`${PAYSTACK_BASE}/transfer/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    let json: { status?: boolean; message?: string; data?: PaystackTransfer } | null = null
    try { json = await res.json() } catch { /* handled below */ }
    if ((res.status === 404 || res.status === 400) && /not found/i.test(json?.message ?? '')) return null
    if (!res.ok || !json?.status || !json.data?.transfer_code) return 'unknown'
    return json.data
  } catch {
    return 'unknown'
  }
}

/** Writes onto our row a transfer Paystack already holds for it, instead of sending another. */
async function adoptTransfer(payoutId: string, transfer: PaystackTransfer): Promise<InitiateHostPayoutResult> {
  const code = transfer.transfer_code!
  if (transfer.status === 'failed' || transfer.status === 'reversed') {
    // It was made and has conclusively failed. Kept with its code, so a retry uses a new reference.
    await db.payout.update({ where: { id: payoutId }, data: { paystackTransferCode: code } })
    const failed = await recordPayoutFailure(payoutId, `Paystack transfer ${transfer.status}`, { completedAt: new Date() })
    return { ok: false, payout: failed, error: failed.failureReason ?? undefined }
  }
  const done = transfer.status === 'success'
  const updated = await db.payout.update({
    where: { id: payoutId },
    data: { paystackTransferCode: code, failureReason: null, ...(done ? { status: 'COMPLETED', completedAt: new Date() } : { status: 'PROCESSING' }) },
  })
  if (done) notify('payout.sent', { payoutId })
  return { ok: true, payout: updated }
}

/**
 * Marks a payout HELD for a person to pay: it is over the transfer limit, or
 * the guest's payment has no stored cedi amount. One alert; the job never
 * picks a HELD payout up again.
 */
async function holdPayout(payoutId: string, reason: string, why: 'OVER_LIMIT' | 'NO_CEDI_AMOUNT', sums: Record<string, number>): Promise<Payout> {
  const now = new Date()
  const held = await db.payout.update({
    where: { id: payoutId },
    data: {
      status: 'HELD',
      failureReason: reason,
      alertedAt: now,
    },
  })
  console.error(`[Payouts] Payout ${held.id} is held (${why})`)
  Sentry.captureMessage(why === 'OVER_LIMIT'
    ? 'A host payout is over the transfer limit and is held: pay it by hand'
    : 'A host payout is held: the guest\'s payment has no stored cedi amount. Pay it by hand', {
    level: 'error',
    tags: { area: 'payouts', payout_failure: why },
    fingerprint: ['payout-held', held.id],
    // IDs and amounts only: no account or mobile money numbers
    contexts: {
      payout: {
        payoutId: held.id, hostId: held.hostId, bookingId: held.bookingId, instalmentSeq: held.instalmentSeq,
        amount: held.amount, currency: held.currency, ...sums,
      },
    },
  })
  return held
}

// ─── Failure handling & retry policy ────────────────────────────────────────

/** Automatic retries after the first attempt — so at most 3 attempts total. */
export const MAX_PAYOUT_RETRIES = 2

/** Minimum gap between a failure and its retry. The process-payouts cron runs
 *  hourly, so in practice a retry lands on the first run after this passes. */
export const PAYOUT_RETRY_DELAY_MS = 30 * 60 * 1000

export type PayoutFailureKind = 'TRANSIENT' | 'PERMANENT'

// Messages from Paystack's transfer error docs
// (https://paystack.com/docs/api/errors/transfer/ and
// https://paystack.com/docs/transfers/how-transfers-work/), plus the reasons
// our own code writes. Permanent patterns are checked FIRST, so a webhook
// failure whose detail says e.g. "Account closed" is never retried just
// because it also carries the retryable "transfer failed" prefix.
const PERMANENT_PATTERNS: RegExp[] = [
  /account closed/i,
  /cannot resolve account/i,
  /account number is (invalid|required)/i,
  /bank.?code is (invalid|required)/i,
  /recipient specified is invalid/i,
  /can'?t make the transfer to this recipient/i, // recipient on fraud watchlist
  /unique reference/i, // a transfer already exists under this reference — needs a human, never auto-retry
  /illegal special characters|invalid entries/i,
  /third party payouts/i, // business not upgraded to Registered
  /amount too small/i,
  /no verified payout method|host .* not found/i,
  /is cancelled or refunded/i, // never retry a payout for a cancelled or refunded stay
  /more than the host's share/i, // a wrong amount needs a person
]

const TRANSIENT_PATTERNS: RegExp[] = [
  /balance is not enough/i, // our Paystack balance — fixed by topping up, then a retry succeeds
  /system malfunction/i, // Paystack: unspecified error at the customer's bank, "retry the transfer"
  /^Network error calling Paystack/,
  /^Paystack returned HTTP (5\d\d|429)\b/,
  // Paystack: "failed" = "typically happens when the processor is down";
  // "reversed" = "the customer's bank is unable to receive money at that moment"
  /^Paystack transfer (failed|reversed)\b/,
]

/**
 * Anything unrecognised is treated as PERMANENT: an unknown error gets one
 * alert and a human look, rather than being blindly retried.
 */
export function classifyPayoutFailure(reason: string | null | undefined): PayoutFailureKind {
  if (!reason) return 'PERMANENT'
  if (PERMANENT_PATTERNS.some((re) => re.test(reason))) return 'PERMANENT'
  if (TRANSIENT_PATTERNS.some((re) => re.test(reason))) return 'TRANSIENT'
  return 'PERMANENT'
}

/**
 * The single place a payout is marked FAILED. If the failure won't be retried
 * (permanent reason, or the retry budget is used up) it alerts via Sentry right
 * away; otherwise it leaves the payout for retryFailedPayouts() to pick up.
 */
export async function recordPayoutFailure(
  payoutId: string,
  reason: string,
  timestamps: { initiatedAt?: Date; completedAt?: Date } = {},
): Promise<Payout> {
  const now = new Date()
  const failed = await db.payout.update({
    where: { id: payoutId },
    data: { status: 'FAILED', failureReason: reason, lastFailedAt: now, ...timestamps },
  })

  const kind = classifyPayoutFailure(reason)
  if (kind === 'TRANSIENT' && failed.retryCount < MAX_PAYOUT_RETRIES) {
    return failed
  }

  alertPayoutFailure(failed, kind === 'PERMANENT' ? 'PERMANENT' : 'RETRIES_EXHAUSTED')
  notify('payout.failed', { payoutId })
  return db.payout.update({ where: { id: payoutId }, data: { alertedAt: now } })
}

function alertPayoutFailure(payout: Payout, why: 'PERMANENT' | 'RETRIES_EXHAUSTED') {
  const summary =
    why === 'PERMANENT'
      ? 'permanent failure, not retried'
      : `still failing after ${payout.retryCount} automatic retries`
  console.error(`[Payouts] Payout ${payout.id} needs attention (${summary}):`, payout.failureReason)
  Sentry.captureException(new Error(`Host payout failed — ${summary}: ${payout.failureReason}`), {
    level: 'error',
    tags: { area: 'payouts', payout_failure: why },
    // No account/MoMo numbers here — IDs are enough to look the rest up.
    contexts: {
      payout: {
        payoutId: payout.id,
        hostId: payout.hostId,
        bookingId: payout.bookingId,
        amount: payout.amount,
        currency: payout.currency,
        method: payout.method,
        failureReason: payout.failureReason,
        retryCount: payout.retryCount,
        paystackTransferReference: payout.paystackTransferReference,
      },
    },
  })
}

export type RetryResult = {
  payoutId: string; ok: boolean; status: string; retryCount: number; error?: string
  /** True when nothing was attempted because the host's ID is not approved: the payout waits as it was */
  waitingForHostId?: boolean
  /** True when nothing was tried because the host's account is suspended */
  waitingForSuspension?: boolean
  /** True when nothing was attempted because the payout method was saved in the last day */
  waitingForNewMethod?: boolean
  /** True when Paystack did not answer: the payout is PENDING and is checked on the next run */
  unanswered?: boolean
}

/**
 * Picks FAILED payouts that are retryable (transient reason, not yet alerted,
 * under the retry cap, failed at least PAYOUT_RETRY_DELAY_MS ago) and runs
 * them through initiateHostPayout() again. Called from the process-payouts
 * cron, so the delay between attempts is the cron's own cadence.
 *
 * Rows that failed before this policy existed have no lastFailedAt and are
 * deliberately left alone.
 */
export async function retryFailedPayouts(): Promise<RetryResult[]> {
  // Nothing is retried while payouts are off: a refused attempt would
  // otherwise be recorded as one more failure.
  if (!payoutGate().live) return []

  const candidates = await db.payout.findMany({
    where: {
      status: 'FAILED',
      alertedAt: null,
      retryCount: { lt: MAX_PAYOUT_RETRIES },
      lastFailedAt: { lte: new Date(Date.now() - PAYOUT_RETRY_DELAY_MS) },
      bookingId: { not: null },
    },
  })

  const results: RetryResult[] = []
  for (const payout of candidates) {
    if (classifyPayoutFailure(payout.failureReason) !== 'TRANSIENT') continue
    // An instalment's payout whose instalment is gone cannot be checked: a person looks at it
    if (payout.instalmentSeq > 0 && !payout.instalmentId) continue

    // A host whose ID is not approved is not retried: the row is left exactly
    // as it is, retry count and all, and is looked at again on the next run.
    const host = await db.user.findUnique({ where: { id: payout.hostId }, select: { ...HOST_ID_SELECT, paystackRecipientCode: true, payoutMethodVerifiedAt: true, suspendedAt: true } })
    // A suspended host is not retried either: the row is left as it is
    if (isSuspended(host)) {
      results.push({ payoutId: payout.id, ok: false, status: payout.status, retryCount: payout.retryCount, error: WAITING_FOR_SUSPENSION, waitingForSuspension: true })
      continue
    }
    if (!hostIdApproved(host)) {
      results.push({ payoutId: payout.id, ok: false, status: payout.status, retryCount: payout.retryCount, error: WAITING_FOR_HOST_ID, waitingForHostId: true })
      continue
    }
    // Nor is one whose payout method was saved in the last day. A host with
    // no method at all goes on to fail as before: that needs a person.
    if (host?.paystackRecipientCode && host.payoutMethodVerifiedAt && !payoutMethodSettled(host)) {
      results.push({ payoutId: payout.id, ok: false, status: payout.status, retryCount: payout.retryCount, error: WAITING_FOR_NEW_METHOD, waitingForNewMethod: true })
      continue
    }

    // Claim the row atomically so two overlapping cron runs can't both retry
    // it — only the run whose update matches the current retryCount wins.
    //
    // Reference: if Paystack gave us a transfer_code, a transfer was really
    // created under this reference and has since conclusively failed/reversed,
    // so Paystack will reject the same reference ("Please provide a unique
    // reference") — a new one is needed. With no transfer_code, the failure
    // happened at initiation, and Paystack's docs say to retry with the SAME
    // reference so a request that did get through can't be paid twice.
    const claimed = await db.payout.updateMany({
      where: { id: payout.id, status: 'FAILED', retryCount: payout.retryCount },
      data: {
        status: 'PENDING',
        retryCount: { increment: 1 },
        failureReason: null,
        completedAt: null,
        initiatedAt: null, // releases the last attempt's claim
        ...(payout.paystackTransferCode
          ? { paystackTransferCode: null, paystackTransferReference: newTransferReference() }
          : {}),
      },
    })
    if (claimed.count === 0) continue

    try {
      const result = await initiateHostPayout({
        hostId: payout.hostId,
        bookingId: payout.bookingId!,
        amount: payout.amount,
        instalmentId: payout.instalmentId,
      })
      results.push({
        payoutId: payout.id,
        ok: result.ok,
        status: result.payout.status,
        retryCount: result.payout.retryCount,
        error: result.error,
        ...(result.unanswered ? { unanswered: true } : {}),
      })
    } catch (error) {
      // The host's ID stopped being approved between the check above and the
      // attempt. That is a wait, never a failure: the row stays PENDING and
      // unclaimed, and the job picks it up again once the ID is approved.
      if (error instanceof HostSuspendedError) {
        results.push({ payoutId: payout.id, ok: false, status: 'PENDING', retryCount: payout.retryCount + 1, error: WAITING_FOR_SUSPENSION, waitingForSuspension: true })
        continue
      }
      if (error instanceof HostIdNotApprovedError) {
        results.push({ payoutId: payout.id, ok: false, status: 'PENDING', retryCount: payout.retryCount + 1, error: WAITING_FOR_HOST_ID, waitingForHostId: true })
        continue
      }
      if (error instanceof PayoutMethodTooNewError) {
        results.push({ payoutId: payout.id, ok: false, status: 'PENDING', retryCount: payout.retryCount + 1, error: WAITING_FOR_NEW_METHOD, waitingForNewMethod: true })
        continue
      }
      // e.g. the host removed their payout method since — record it so the
      // row doesn't sit in PENDING, which the main cron query never revisits.
      const failed = await recordPayoutFailure(payout.id, error instanceof Error ? error.message : 'Unknown error')
      results.push({ payoutId: payout.id, ok: false, status: failed.status, retryCount: failed.retryCount, error: failed.failureReason ?? undefined })
    }
  }
  return results
}

// Paystack wants references to be lowercase alphanumerics plus - and _.
function newTransferReference(): string {
  return `pyt-${crypto.randomUUID()}`
}

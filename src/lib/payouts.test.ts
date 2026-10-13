import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payout } from '@prisma/client'

// ─── In-memory stand-ins for Prisma + Sentry ────────────────────────────────
// Only the query shapes lib/payouts.ts and the webhook actually use.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ payouts: [] as Row[], users: [] as Row[] }))
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))

vi.mock('@sentry/nextjs', () => sentry)
// Messages are covered by lib/messaging tests; here notify() is only a call that must not get in the way
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
    const value = row[key]
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { lt?: number; lte?: Date; not?: unknown }
      if ('lt' in c && !((value as number) < c.lt!)) return false
      if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
      if ('not' in c && value === c.not) return false
      return true
    }
    return (value ?? null) === cond
  })
}

function apply(row: Row, data: Row) {
  for (const [key, v] of Object.entries(data)) {
    row[key] = v !== null && typeof v === 'object' && 'increment' in v ? (row[key] as number) + (v as { increment: number }).increment : v
  }
}

// instalmentSeq is 0 unless set, as the column's default has it
const payoutRows = () => state.payouts.map((p) => (p.instalmentSeq === undefined ? Object.assign(p, { instalmentSeq: 0 }) : p))
vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: async ({ where }: { where: Row }) => state.users.find((u) => u.id === where.id) ?? null },
    // Every booking here was made after the PAYOUTS_NOT_BEFORE date set below
    booking: { findUnique: async () => ({ createdAt: new Date('2026-09-01T00:00:00Z'), status: 'CONFIRMED', subtotal: 1000, refund: null, disputes: [] }) },
    // Today's rate, which no payout may be worked out from (lib/payoutCedis.ts)
    exchangeRate: { findFirst: async () => ({ usdToGhs: 99 }) },
    // Every guest here paid $1,000 for the stay at 15 cedis to the dollar
    payment: {
      findMany: async ({ where }: { where: { bookingId: { in: string[] } } }) =>
        where.bookingId.in.map((bookingId) => ({ bookingId, instalmentId: null, amount: 1000, amountPesewas: 1_500_000 })),
    },
    payout: {
      findFirst: async ({ where }: { where: Row }) => {
        const row = payoutRows().find((p) => matches(p, where))
        return row ? { ...row } : null
      },
      findMany: async ({ where }: { where: Row }) => payoutRows().filter((p) => matches(p, where)).map((p) => ({ ...p })),
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: `payout_${state.payouts.length + 1}`,
          retryCount: 0, lastFailedAt: null, alertedAt: null, paystackTransferCode: null,
          failureReason: null, initiatedAt: null, completedAt: null, createdAt: new Date(),
          instalmentSeq: 0,
          ...data,
        }
        state.payouts.push(row)
        return { ...row }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.payouts.find((p) => p.id === where.id)!
        apply(row, data)
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.payouts.filter((p) => matches(p, where))
        rows.forEach((r) => apply(r, data))
        return { count: rows.length }
      },
    },
  },
}))

import {
  MAX_PAYOUT_RETRIES,
  classifyPayoutFailure,
  initiateHostPayout,
  retryFailedPayouts,
} from '@/lib/payouts'
import { POST as paystackWebhook } from '@/app/api/webhooks/paystack/route'

// ─── Helpers ────────────────────────────────────────────────────────────────

const SECRET = 'sk_test_retrypolicy'
/** An ID FieGH has approved: the flag, an APPROVED document and the admin who reviewed it (lib/hostId.ts) */
const approvedId = { isVerified: true, verification: { status: 'APPROVED', reviewedById: 'admin_1' } }
const fetchMock = vi.fn()
/** The references Paystack was asked about, and what it holds ('silent': it does not answer) */
const lookups: string[] = []
const held: { transfer: null | 'silent' | { transfer_code: string; status: string } } = { transfer: null }
let clock = new Date('2026-09-22T12:00:00Z').getTime()

const paystackError = (httpStatus: number, message: string) =>
  new Response(JSON.stringify({ status: false, message }), { status: httpStatus })
const paystackOk = (code: string) =>
  new Response(JSON.stringify({ status: true, data: { transfer_code: code, status: 'pending' } }), { status: 200 })

/** Moves time past the retry delay and runs the cron's retry pass. */
function advanceHour() {
  clock += 61 * 60 * 1000
  vi.setSystemTime(clock)
}

const payout = () => state.payouts[0] as unknown as Payout
const alerts = () => sentry.captureException.mock.calls

function webhook(event: string, data: Row) {
  const body = JSON.stringify({ event, data })
  const sig = crypto.createHmac('sha512', SECRET).update(body).digest('hex')
  return paystackWebhook(new Request('http://x/api/webhooks/paystack', {
    method: 'POST', body, headers: { 'x-paystack-signature': sig },
  }))
}

beforeEach(() => {
  state.payouts.length = 0
  state.users.length = 0
  state.users.push({ id: 'host_1', paystackRecipientCode: 'RCP_1', payoutMethodVerifiedAt: new Date('2026-01-01T00:00:00Z'), payoutMethod: 'MOMO', ...approvedId })
  sentry.captureException.mockReset()
  fetchMock.mockReset()
  // Asked whether a transfer already exists under a reference (before any
  // re-send), Paystack says it has none, unless a test says otherwise. Every
  // other call is answered by fetchMock, in the order the test queued.
  lookups.length = 0
  held.transfer = null
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/transfer/verify/')) {
      lookups.push(String(url).split('/').pop()!)
      if (held.transfer === 'silent') throw new DOMException('timed out', 'TimeoutError')
      return held.transfer
        ? new Response(JSON.stringify({ status: true, data: held.transfer }), { status: 200 })
        : new Response(JSON.stringify({ status: false, message: 'Transfer not found' }), { status: 404 })
    }
    return fetchMock(url, init)
  })
  vi.stubEnv('PAYSTACK_SECRET_KEY', SECRET)
  // Payouts are off unless both switches are set (lib/payoutSwitches.ts)
  vi.stubEnv('PAYOUTS_ENABLED', 'true')
  vi.stubEnv('PAYOUTS_NOT_BEFORE', '2026-01-01')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

const start = () => initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 100 })

// ─── A host whose ID is not approved ────────────────────────────────────────

describe('retrying while the host\'s ID is not approved', () => {
  const transient = () => paystackError(400, 'Your balance is not enough to fulfil this request')
  const idRemoved = () => Object.assign(state.users[0], { isVerified: false, verification: { status: 'REJECTED', reviewedById: 'admin_1' } })

  it('a FAILED payout is not retried while the host\'s ID is not approved, and keeps its retry count', async () => {
    fetchMock.mockResolvedValueOnce(transient()).mockResolvedValueOnce(paystackOk('TRF_ok'))
    await start()
    expect(payout()).toMatchObject({ status: 'FAILED', retryCount: 0 })
    const before = { ...state.payouts[0] }

    idRemoved()
    for (let hour = 0; hour < 5; hour++) {
      advanceHour()
      expect(await retryFailedPayouts()).toEqual([
        { payoutId: 'payout_1', ok: false, status: 'FAILED', retryCount: 0, error: 'the host has no approved ID', waitingForHostId: true },
      ])
    }
    // Exactly as it was: not claimed, not counted as an attempt, not alerted
    expect(state.payouts[0]).toEqual(before)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(alerts()).toHaveLength(0)

    // Approved again: the retry it was owed goes ahead, under the same reference
    Object.assign(state.users[0], approvedId)
    advanceHour()
    const [r] = await retryFailedPayouts()
    expect(r).toMatchObject({ ok: true, status: 'PROCESSING', retryCount: 1 })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reference).toBe(before.paystackTransferReference)
  })

  it('an ID hold is never recorded as a failed payout', async () => {
    fetchMock.mockResolvedValueOnce(transient())
    await start()
    // Approved when the retry pass looks, not approved a moment later when the transfer would start
    let looks = 0
    const host = state.users[0]
    Object.defineProperty(host, 'isVerified', { get: () => looks++ < 1, configurable: true })
    advanceHour()
    const results = await retryFailedPayouts()
    Object.defineProperty(host, 'isVerified', { value: true, writable: true, configurable: true })

    expect(results).toEqual([expect.objectContaining({ payoutId: 'payout_1', ok: false, status: 'PENDING', waitingForHostId: true })])
    // Waiting, not failed: no failure reason, no alert, and no second call to Paystack
    expect(payout()).toMatchObject({ status: 'PENDING', failureReason: null, alertedAt: null, initiatedAt: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(alerts()).toHaveLength(0)
  })

  it('a first attempt for a host with no approved ID throws, and no payout row is made', async () => {
    idRemoved()
    await expect(start()).rejects.toThrow('has no approved ID')
    expect(state.payouts).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('retrying after the payout method was changed', () => {
  it('a FAILED payout is not retried to a payout method saved less than 24 hours ago, and keeps its retry count', async () => {
    fetchMock.mockResolvedValueOnce(paystackError(400, 'Your balance is not enough to fulfil this request')).mockResolvedValueOnce(paystackOk('TRF_ok'))
    await start()
    const before = { ...state.payouts[0] }

    advanceHour()
    state.users[0].payoutMethodVerifiedAt = new Date(clock - 60 * 60 * 1000)
    expect(await retryFailedPayouts()).toEqual([
      { payoutId: 'payout_1', ok: false, status: 'FAILED', retryCount: 0, error: 'the payout method was saved less than 24 hours ago', waitingForNewMethod: true },
    ])
    expect(state.payouts[0]).toEqual(before)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(alerts()).toHaveLength(0)

    // A day on, the retry it was owed goes ahead
    clock += 24 * 60 * 60 * 1000
    vi.setSystemTime(clock)
    expect((await retryFailedPayouts())[0]).toMatchObject({ ok: true, status: 'PROCESSING', retryCount: 1 })
  })

  it('a first attempt to a payout method saved less than 24 hours ago throws, and no payout row is made', async () => {
    state.users[0].payoutMethodVerifiedAt = new Date(clock - 60 * 60 * 1000)
    await expect(start()).rejects.toThrow('less than 24 hours ago')
    expect(state.payouts).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('retrying while the host is suspended', () => {
  it('a FAILED payout is not retried to a suspended host, and keeps its retry count', async () => {
    fetchMock.mockResolvedValueOnce(paystackError(400, 'Your balance is not enough to fulfil this request')).mockResolvedValueOnce(paystackOk('TRF_ok'))
    await start()
    const before = { ...state.payouts[0] }

    advanceHour()
    state.users[0].suspendedAt = new Date(clock - 60 * 1000)
    expect(await retryFailedPayouts()).toEqual([
      { payoutId: 'payout_1', ok: false, status: 'FAILED', retryCount: 0, error: 'the host\'s account is suspended', waitingForSuspension: true },
    ])
    expect(state.payouts[0]).toEqual(before)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(alerts()).toHaveLength(0)

    // Restored: the retry it was owed goes ahead
    state.users[0].suspendedAt = null
    expect((await retryFailedPayouts())[0]).toMatchObject({ ok: true, status: 'PROCESSING', retryCount: 1 })
  })

  it('a first attempt to a suspended host throws, and no payout row is made', async () => {
    state.users[0].suspendedAt = new Date(clock - 60 * 1000)
    await expect(start()).rejects.toThrow('is suspended')
    expect(state.payouts).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── Classification ─────────────────────────────────────────────────────────

describe('classifyPayoutFailure', () => {
  it.each([
    'Paystack returned HTTP 400: Your balance is not enough to fulfil this request',
    'Paystack returned HTTP 502',
    'Paystack returned HTTP 400: System Malfunction',
    'Network error calling Paystack: fetch failed',
    'Paystack transfer failed',
    'Paystack transfer reversed',
  ])('transient: %s', (reason) => expect(classifyPayoutFailure(reason)).toBe('TRANSIENT'))

  it.each([
    'Paystack returned HTTP 400: Account closed',
    'Paystack returned HTTP 400: Cannot resolve account',
    'Paystack returned HTTP 400: Recipient specified is invalid',
    "Paystack returned HTTP 400: Sorry, we can't make the transfer to this recipient at the moment",
    'Paystack returned HTTP 400: Please provide a unique reference',
    'Paystack transfer failed: Account closed', // permanent detail wins over the retryable prefix
    'Amount too small to transfer via Paystack',
    'Paystack returned HTTP 400: Something nobody has seen before', // unknown → alert, don't guess
    null,
  ])('permanent: %s', (reason) => expect(classifyPayoutFailure(reason)).toBe('PERMANENT'))
})

// ─── Policy, end to end ─────────────────────────────────────────────────────

describe('retry policy', () => {
  it('retries a transient failure up to the cap, then alerts once', async () => {
    fetchMock.mockImplementation(async () => paystackError(400, 'Your balance is not enough to fulfil this request'))

    await start()
    expect(payout().status).toBe('FAILED')
    expect(alerts()).toHaveLength(0)

    // Not before the delay has passed.
    expect(await retryFailedPayouts()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    for (let attempt = 1; attempt <= MAX_PAYOUT_RETRIES; attempt++) {
      advanceHour()
      const [r] = await retryFailedPayouts()
      expect(r).toMatchObject({ ok: false, status: 'FAILED', retryCount: attempt })
      expect(alerts()).toHaveLength(attempt === MAX_PAYOUT_RETRIES ? 1 : 0)
    }

    expect(fetchMock).toHaveBeenCalledTimes(1 + MAX_PAYOUT_RETRIES)
    expect(payout().alertedAt).toBeInstanceOf(Date)

    const [error, ctx] = alerts()[0]
    expect((error as Error).message).toContain('still failing after 2 automatic retries')
    expect(ctx).toMatchObject({
      tags: { payout_failure: 'RETRIES_EXHAUSTED' },
      contexts: { payout: { hostId: 'host_1', amount: 100, retryCount: 2, failureReason: expect.stringContaining('balance is not enough') } },
    })

    // Exhausted: later cron runs leave it alone and don't re-alert.
    advanceHour()
    expect(await retryFailedPayouts()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(alerts()).toHaveLength(1)
  })

  it('reuses the same reference when retrying an initiation failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(paystackOk('TRF_ok'))
    await start()
    const ref = payout().paystackTransferReference

    advanceHour()
    const [r] = await retryFailedPayouts()
    expect(r).toMatchObject({ ok: true, status: 'PROCESSING', retryCount: 1 })
    expect(payout().paystackTransferReference).toBe(ref)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reference).toBe(ref)
    expect(alerts()).toHaveLength(0)
  })

  it('does not retry a permanent failure, and alerts immediately', async () => {
    fetchMock.mockResolvedValue(paystackError(400, 'Account closed'))
    await start()

    expect(payout()).toMatchObject({ status: 'FAILED', retryCount: 0 })
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0][1]).toMatchObject({ tags: { payout_failure: 'PERMANENT' } })

    advanceHour()
    expect(await retryFailedPayouts()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves FAILED payouts from before this policy existed alone', async () => {
    state.payouts.push({ id: 'legacy', hostId: 'host_1', bookingId: 'b0', status: 'FAILED', failureReason: 'Paystack transfer failed', retryCount: 0, lastFailedAt: null, alertedAt: null })
    advanceHour()
    expect(await retryFailedPayouts()).toEqual([])
  })
})

describe('webhook failures', () => {
  it('retries a transfer.failed with a fresh reference, ignoring duplicate deliveries', async () => {
    fetchMock.mockResolvedValueOnce(paystackOk('TRF_first')).mockResolvedValueOnce(paystackOk('TRF_second'))
    await start()
    const firstRef = payout().paystackTransferReference!

    // data.reason is our own narration and must not become the failure reason.
    const event = { transfer_code: 'TRF_first', reference: firstRef, reason: 'FieGH host payout — booking booking_1', failures: null }
    expect((await webhook('transfer.failed', event)).status).toBe(200)
    expect(payout()).toMatchObject({ status: 'FAILED', failureReason: 'Paystack transfer failed' })
    await webhook('transfer.failed', event) // Paystack redelivery
    expect(payout().retryCount).toBe(0)
    expect(alerts()).toHaveLength(0)

    advanceHour()
    const [r] = await retryFailedPayouts()
    expect(r).toMatchObject({ ok: true, status: 'PROCESSING', retryCount: 1 })
    expect(payout().paystackTransferCode).toBe('TRF_second')
    // Paystack rejects a reused reference once a transfer was created under it.
    expect(payout().paystackTransferReference).not.toBe(firstRef)
    expect(payout().paystackTransferReference).toMatch(/^pyt-[0-9a-f-]+$/)
  })

  it('treats transfer.reversed as transient', async () => {
    fetchMock.mockResolvedValueOnce(paystackOk('TRF_r'))
    await start()
    await webhook('transfer.reversed', { transfer_code: 'TRF_r' })
    expect(payout()).toMatchObject({ status: 'FAILED', failureReason: 'Paystack transfer reversed' })
    expect(alerts()).toHaveLength(0)
  })

  it('alerts straight away when the webhook carries a permanent reason', async () => {
    fetchMock.mockResolvedValueOnce(paystackOk('TRF_p'))
    await start()
    await webhook('transfer.failed', { transfer_code: 'TRF_p', gateway_response: 'Account closed' })
    expect(payout().failureReason).toBe('Paystack transfer failed: Account closed')
    expect(alerts()).toHaveLength(1)
    advanceHour()
    expect(await retryFailedPayouts()).toEqual([])
  })
})

// ─── Paystack does not answer (lib/outbound.ts) ─────────────────────────────

describe('a transfer Paystack never answered', () => {
  const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  const posts = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/transfer'))

  it('is not recorded as failed: the payout stays PENDING, with no retry counted and no alert', async () => {
    fetchMock.mockRejectedValueOnce(timeout())
    const result = await start()
    expect(result).toMatchObject({ ok: false, unanswered: true })
    expect(payout()).toMatchObject({ status: 'PENDING', retryCount: 0, failureReason: null, paystackTransferCode: null })
    expect(payout().initiatedAt).toBeInstanceOf(Date)
    expect(alerts()).toHaveLength(0)
    // Nothing for the retry policy to pick up, however long passes
    advanceHour()
    expect(await retryFailedPayouts()).toEqual([])
    expect(posts()).toHaveLength(1)
  })

  it('is left alone while the claim is fresh: the first attempt may still be in flight', async () => {
    fetchMock.mockRejectedValueOnce(timeout())
    await start()
    const again = await start()
    expect(again).toMatchObject({ ok: true, alreadyInitiated: true })
    expect(posts()).toHaveLength(1)
    expect(lookups).toEqual([])
  })

  it('before sending again, Paystack is asked for the transfer: one it already holds is adopted, not sent twice', async () => {
    fetchMock.mockRejectedValueOnce(timeout())
    await start()
    const reference = payout().paystackTransferReference
    held.transfer = { transfer_code: 'TRF_first', status: 'pending' }
    advanceHour()
    const again = await start()
    expect(lookups).toEqual([reference])
    expect(again).toMatchObject({ ok: true, alreadyInitiated: true })
    expect(payout()).toMatchObject({ status: 'PROCESSING', paystackTransferCode: 'TRF_first', paystackTransferReference: reference })
    // The one request that timed out is the only transfer ever asked for
    expect(posts()).toHaveLength(1)
  })

  it('a transfer Paystack says has already succeeded is marked completed, and nothing is sent', async () => {
    fetchMock.mockRejectedValueOnce(timeout())
    await start()
    held.transfer = { transfer_code: 'TRF_first', status: 'success' }
    advanceHour()
    await start()
    expect(payout()).toMatchObject({ status: 'COMPLETED', paystackTransferCode: 'TRF_first' })
    expect(payout().completedAt).toBeInstanceOf(Date)
    expect(posts()).toHaveLength(1)
  })

  it('is sent again, with the same reference, only when Paystack says it holds no such transfer', async () => {
    fetchMock.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(paystackOk('TRF_second'))
    await start()
    const reference = payout().paystackTransferReference
    advanceHour()
    const again = await start()
    expect(lookups).toEqual([reference])
    expect(again.ok).toBe(true)
    expect(posts()).toHaveLength(2)
    expect(posts().map(([, init]) => JSON.parse(init.body).reference)).toEqual([reference, reference])
    expect(payout()).toMatchObject({ status: 'PROCESSING', paystackTransferCode: 'TRF_second' })
  })

  it('is not sent at all while Paystack cannot be asked: nothing is known, so nothing moves', async () => {
    fetchMock.mockRejectedValueOnce(timeout())
    await start()
    held.transfer = 'silent'
    for (let run = 0; run < 3; run++) {
      advanceHour()
      expect(await start()).toMatchObject({ ok: false, unanswered: true })
    }
    expect(posts()).toHaveLength(1)
    expect(payout()).toMatchObject({ status: 'PENDING', retryCount: 0, failureReason: null })
    expect(alerts()).toHaveLength(0)
  })

  it('a transfer Paystack made and then failed is recorded as failed, and retried under a new reference', async () => {
    fetchMock.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(paystackOk('TRF_new'))
    await start()
    const reference = payout().paystackTransferReference
    held.transfer = { transfer_code: 'TRF_first', status: 'failed' }
    advanceHour()
    expect(await start()).toMatchObject({ ok: false })
    expect(payout()).toMatchObject({ status: 'FAILED', paystackTransferCode: 'TRF_first', failureReason: 'Paystack transfer failed' })
    held.transfer = null
    advanceHour()
    await retryFailedPayouts()
    expect(payout().paystackTransferReference).not.toBe(reference)
    expect(payout()).toMatchObject({ status: 'PROCESSING', paystackTransferCode: 'TRF_new' })
  })

  it('a retry after a dropped connection also asks first, and adopts a transfer that did get through', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await start()
    expect(payout().status).toBe('FAILED')
    held.transfer = { transfer_code: 'TRF_got_through', status: 'pending' }
    advanceHour()
    const [retried] = await retryFailedPayouts()
    expect(retried).toMatchObject({ ok: true, status: 'PROCESSING' })
    expect(payout().paystackTransferCode).toBe('TRF_got_through')
    expect(posts()).toHaveLength(1)
  })
})

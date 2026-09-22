import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payout } from '@prisma/client'

// ─── In-memory stand-ins for Prisma + Sentry ────────────────────────────────
// Only the query shapes lib/payouts.ts and the webhook actually use.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ payouts: [] as Row[], users: [] as Row[] }))
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))

vi.mock('@sentry/nextjs', () => sentry)

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

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: async ({ where }: { where: Row }) => state.users.find((u) => u.id === where.id) ?? null },
    exchangeRate: { findFirst: async () => ({ usdToGhs: 15 }) },
    payout: {
      findFirst: async ({ where }: { where: Row }) => {
        const row = state.payouts.find((p) => matches(p, where))
        return row ? { ...row } : null
      },
      findMany: async ({ where }: { where: Row }) => state.payouts.filter((p) => matches(p, where)).map((p) => ({ ...p })),
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: `payout_${state.payouts.length + 1}`,
          retryCount: 0, lastFailedAt: null, alertedAt: null, paystackTransferCode: null,
          failureReason: null, initiatedAt: null, completedAt: null, createdAt: new Date(),
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
const fetchMock = vi.fn()
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
  state.users.push({ id: 'host_1', paystackRecipientCode: 'RCP_1', payoutMethodVerifiedAt: new Date(), payoutMethod: 'MOMO' })
  sentry.captureException.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('PAYSTACK_SECRET_KEY', SECRET)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

const start = () => initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 100 })

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

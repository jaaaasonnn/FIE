import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory stand-in for the database and a mocked fetch. No test may
// reach Paystack or a real database.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ refunds: [] as Row[], payments: [] as Row[], bookings: [] as Row[], writes: 0 }))
const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)
// Messages are covered by lib/messaging tests; here notify() is only a call that must not get in the way
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

vi.mock('@/lib/db', () => {
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
      if (key === 'payment') {
        const payment = state.payments.find((p) => p.id === row.paymentId)
        return !!payment && matches(payment, cond as Row)
      }
      const value = row[key]
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { lt?: number; lte?: Date; in?: unknown[] }
        if ('in' in c && !c.in!.includes(value)) return false
        if ('lt' in c && !((value as number) < c.lt!)) return false
        if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
        return true
      }
      return (value ?? null) === cond
    })
  const apply = (row: Row, data: Row) => {
    for (const [key, v] of Object.entries(data)) {
      row[key] = v !== null && typeof v === 'object' && 'increment' in v ? (row[key] as number) + (v as { increment: number }).increment : v
    }
  }
  const withPayment = (r: Row) => ({ ...r, payment: { ...state.payments.find((p) => p.id === r.paymentId)! } })
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    db: {
      refund: {
        findUnique: async ({ where }: { where: Row }) => {
          await tick()
          const row = state.refunds.find((r) => r.id === where.id)
          return row ? withPayment(row) : null
        },
        findFirst: async ({ where }: { where: Row }) => {
          const row = state.refunds.find((r) => matches(r, where))
          return row ? { ...row } : null
        },
        findMany: async ({ where }: { where: Row }) => state.refunds.filter((r) => matches(r, where)).map((r) => ({ ...r })),
        update: async ({ where, data }: { where: Row; data: Row }) => {
          const row = state.refunds.find((r) => r.id === where.id)!
          apply(row, data)
          state.writes++
          return withPayment(row)
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const rows = state.refunds.filter((r) => matches(r, where))
          rows.forEach((r) => apply(r, data))
          state.writes += rows.length
          return { count: rows.length }
        },
      },
      booking: {
        update: async ({ where, data }: { where: Row; data: Row }) => {
          const row = state.bookings.find((b) => b.id === where.id)!
          apply(row, data)
          state.writes++
          return { ...row }
        },
      },
      payout: { findFirst: async () => null },
    },
  }
})

import {
  MAX_REFUND_RETRIES, classifyRefundFailure, handleRefundEvent, mapRefundStatus, runRefunds, sendRefund,
} from '@/lib/refunds'
import { POST as paystackWebhook } from '@/app/api/webhooks/paystack/route'
import { previewCancellation, type CancelBooking } from '@/lib/cancellation'
import { CANCEL_CONTACT_SUPPORT } from '@/lib/cancelRules'

// ─── Helpers ────────────────────────────────────────────────────────────────

const SECRET = 'sk_test_refunds'
const fetchMock = vi.fn()
let clock = new Date('2027-03-01T10:00:00Z').getTime()

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const created = (status = 'pending', id = 9001) => json({ status: true, data: { id, status } })
const calls = (method: 'GET' | 'POST') => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method)
const posted = (i = 0) => JSON.parse(calls('POST')[i][1].body as string)
const refund = () => state.refunds[0]

/** A paid booking of $498 (771,900 pesewas) with a refund owed on it. */
function owed(over: Row = {}): Row {
  state.bookings.push({ id: 'booking_1', paymentStatus: 'PAID', status: 'CANCELLED' })
  state.payments.push({ id: 'payment_1', bookingId: 'booking_1', amount: 498, amountPesewas: 771_900, gatewayReference: 'FIE-booking_1-1', status: 'SUCCESS' })
  const row = {
    id: 'refund_1', bookingId: 'booking_1', paymentId: 'payment_1', reason: 'GUEST_CANCELLED', policy: 'MODERATE',
    stayRefund: 400, serviceFeeRefund: 48, depositRefund: 50, amount: 498, currency: 'USD', amountPesewas: 771_900,
    status: 'PENDING', paystackRefundId: null, failureReason: null, retryCount: 0,
    lastFailedAt: null, alertedAt: null, initiatedAt: null, processedAt: null, createdAt: new Date(clock),
    ...over,
  }
  state.refunds.push(row)
  return row
}
const partRefund = { stayRefund: 200, serviceFeeRefund: 0, depositRefund: 50, amount: 250, amountPesewas: 387_500 }

function advance(minutes: number) {
  clock += minutes * 60 * 1000
  vi.setSystemTime(clock)
}

function webhook(event: string, data: Row) {
  const body = JSON.stringify({ event, data })
  const sig = crypto.createHmac('sha512', SECRET).update(body).digest('hex')
  return paystackWebhook(new Request('http://x/api/webhooks/paystack', { method: 'POST', body, headers: { 'x-paystack-signature': sig } }))
}

beforeEach(() => {
  state.refunds.length = 0
  state.payments.length = 0
  state.bookings.length = 0
  state.writes = 0
  sentry.captureException.mockReset()
  fetchMock.mockReset()
  // Paystack takes a moment to answer; that gap is where a second caller could slip in
  fetchMock.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 0)); return created() })
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('PAYSTACK_SECRET_KEY', SECRET)
  vi.stubEnv('REFUNDS_ENABLED', 'true')
  vi.useFakeTimers({ toFake: ['Date'] })
  clock = new Date('2027-03-01T10:00:00Z').getTime()
  vi.setSystemTime(clock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ─── The switch ─────────────────────────────────────────────────────────────

describe('with REFUNDS_ENABLED off', () => {
  it('sends nothing and leaves the refund owed', async () => {
    for (const value of ['', '1', 'TRUE', 'yes']) {
      vi.stubEnv('REFUNDS_ENABLED', value)
      state.refunds.length = 0; state.payments.length = 0; state.bookings.length = 0
      owed()
      const result = await sendRefund('refund_1')
      expect(result).toMatchObject({ sent: false, skipped: 'REFUNDS_ENABLED is not set to true' })
      expect(refund().status).toBe('PENDING')
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('reports what the hourly job would send, and changes nothing', async () => {
    vi.stubEnv('REFUNDS_ENABLED', '')
    owed()
    const run = await runRefunds()
    expect(run).toMatchObject({ mode: 'dry-run', reason: 'REFUNDS_ENABLED is not set to true', checked: 1 })
    expect(run.results).toEqual([{ refundId: 'refund_1', bookingId: 'booking_1', amount: 498, action: 'would-send', status: 'PENDING' }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('stays in dry run when ?dryRun=1 is passed, even switched on', async () => {
    owed()
    const run = await runRefunds({ dryRun: true })
    expect(run).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('is sent by the hourly job once refunds are switched on', async () => {
    vi.stubEnv('REFUNDS_ENABLED', '')
    owed()
    await runRefunds()
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    const run = await runRefunds()
    expect(run).toMatchObject({ mode: 'live', checked: 1 })
    expect(run.results[0]).toMatchObject({ action: 'sent', status: 'PROCESSING' })
    // A first attempt needs no check for an earlier one
    expect(calls('GET')).toHaveLength(0)
    expect(calls('POST')).toHaveLength(1)
  })
})

// ─── Sending ────────────────────────────────────────────────────────────────

describe('sendRefund', () => {
  it('refunds the whole payment by leaving the amount out', async () => {
    owed()
    const result = await sendRefund('refund_1')
    expect(result.sent).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.paystack.co/refund')
    expect(posted()).toEqual({
      transaction: 'FIE-booking_1-1', currency: 'GHS',
      merchant_note: 'FieGH refund refund_1', customer_note: 'Refund for your cancelled FieGH booking',
    })
    expect(refund()).toMatchObject({ status: 'PROCESSING', paystackRefundId: '9001' })
  })

  it('sends a part refund in pesewas: the same share of the cedis charged', async () => {
    owed(partRefund)
    await sendRefund('refund_1')
    expect(posted()).toMatchObject({ transaction: 'FIE-booking_1-1', amount: 387_500, currency: 'GHS' })
  })

  it('never sends more than the stored refund, whatever is asked of it', async () => {
    owed(partRefund)
    await sendRefund('refund_1')
    expect(posted().amount).toBeLessThanOrEqual(771_900)
    expect(Object.keys(posted()).sort()).toEqual(['amount', 'currency', 'customer_note', 'merchant_note', 'transaction'])
  })

  it('marks the booking refunded when Paystack says it has landed', async () => {
    fetchMock.mockImplementation(async () => created('processed'))
    owed()
    await sendRefund('refund_1')
    expect(refund().status).toBe('PROCESSED')
    expect(refund().processedAt).toBeInstanceOf(Date)
    expect(state.bookings[0].paymentStatus).toBe('REFUNDED')
  })

  it('marks a part refund as partially refunded', async () => {
    fetchMock.mockImplementation(async () => created('processed'))
    owed(partRefund)
    await sendRefund('refund_1')
    expect(state.bookings[0].paymentStatus).toBe('PARTIALLY_REFUNDED')
  })

  it('does nothing for a refund that has already left PENDING', async () => {
    owed({ status: 'PROCESSING', paystackRefundId: '9001' })
    expect(await sendRefund('refund_1')).toMatchObject({ sent: false, skipped: 'already PROCESSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends once when called twice at the same moment', async () => {
    owed()
    const results = await Promise.all([sendRefund('refund_1'), sendRefund('refund_1')])
    expect(calls('POST')).toHaveLength(1)
    expect(results.filter((r) => r.sent)).toHaveLength(1)
    // The second caller stands aside at the claim: it neither asks Paystack
    // anything nor records a failure against the refund
    expect(results.find((r) => !r.sent)).toMatchObject({ skipped: 'another run is sending it' })
    expect(calls('GET')).toHaveLength(0)
    expect(refund()).toMatchObject({ status: 'PROCESSING', failureReason: null })
  })

  it('asks a person when a part refund has no stored cedi amount', async () => {
    owed({ ...partRefund, amountPesewas: null })
    const result = await sendRefund('refund_1')
    expect(result).toMatchObject({ sent: false, skipped: 'needs attention' })
    expect(refund().status).toBe('NEEDS_ATTENTION')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('can still refund in full without a stored cedi amount', async () => {
    owed({ amountPesewas: null })
    state.payments[0].amountPesewas = null
    await sendRefund('refund_1')
    expect(posted()).not.toHaveProperty('amount')
    expect(refund().status).toBe('PROCESSING')
  })
})

// ─── Failures and retries ───────────────────────────────────────────────────

describe('failures', () => {
  it('sorts failures into ones worth retrying and ones for a person', () => {
    expect(classifyRefundFailure('Network error calling Paystack: fetch failed')).toBe('TRANSIENT')
    expect(classifyRefundFailure('Paystack returned HTTP 503')).toBe('TRANSIENT')
    expect(classifyRefundFailure('Paystack returned HTTP 429')).toBe('TRANSIENT')
    expect(classifyRefundFailure('Paystack returned HTTP 400: Your balance is not enough')).toBe('TRANSIENT')
    expect(classifyRefundFailure('Could not check Paystack for an existing refund')).toBe('TRANSIENT')
    expect(classifyRefundFailure('Paystack returned HTTP 400: Transaction has been fully reversed')).toBe('PERMANENT')
    expect(classifyRefundFailure('something new')).toBe('PERMANENT')
    expect(classifyRefundFailure(null)).toBe('PERMANENT')
    expect(mapRefundStatus('pending')).toBe('PROCESSING')
    expect(mapRefundStatus('needs-attention')).toBe('PROCESSING')
  })

  it('alerts straight away on a failure that will not fix itself', async () => {
    fetchMock.mockImplementation(async () => json({ status: false, message: 'Transaction has been fully reversed' }, 400))
    owed()
    const result = await sendRefund('refund_1')
    expect(result.error).toBe('Transaction has been fully reversed')
    expect(refund()).toMatchObject({ status: 'FAILED', failureReason: 'Paystack returned HTTP 400: Transaction has been fully reversed' })
    expect(refund().alertedAt).toBeInstanceOf(Date)
    expect(sentry.captureException).toHaveBeenCalledTimes(1)

    advance(61)
    expect((await runRefunds()).checked).toBe(0)
    expect(calls('POST')).toHaveLength(1)
  })

  it('retries a passing failure after 30 minutes, checking Paystack first', async () => {
    fetchMock.mockImplementationOnce(async () => json({ status: false, message: 'Service unavailable' }, 503))
    owed()
    await sendRefund('refund_1')
    expect(refund()).toMatchObject({ status: 'FAILED', retryCount: 0 })
    expect(sentry.captureException).not.toHaveBeenCalled()

    advance(20)
    expect((await runRefunds()).checked).toBe(0)

    advance(15)
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' ? json({ status: true, data: [] }) : created())
    const run = await runRefunds()
    expect(run.results[0]).toMatchObject({ action: 'sent', status: 'PROCESSING' })
    expect(calls('GET')).toHaveLength(1)
    expect(String(calls('GET')[0][0])).toContain('/refund?reference=FIE-booking_1-1')
    expect(calls('POST')).toHaveLength(2)
    expect(refund()).toMatchObject({ status: 'PROCESSING', retryCount: 1 })
  })

  it('adopts a refund Paystack already has instead of sending a second one', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error('socket hang up') })
    owed(partRefund)
    await sendRefund('refund_1')
    expect(refund().failureReason).toBe('Network error calling Paystack: socket hang up')

    advance(31)
    // The first request did get through
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? json({ status: true, data: [
            { id: 111, status: 'processed', merchant_note: 'FieGH refund someone_else', transaction_reference: 'FIE-other' },
            { id: 222, status: 'processing', merchant_note: 'FieGH refund refund_1', transaction_reference: 'FIE-booking_1-1', amount: 387_500 },
          ] })
        : created())
    const run = await runRefunds()
    expect(run.results[0]).toMatchObject({ action: 'adopted', status: 'PROCESSING' })
    expect(calls('POST')).toHaveLength(1) // only the original attempt
    expect(refund()).toMatchObject({ status: 'PROCESSING', paystackRefundId: '222' })
  })

  it('does not send when Paystack cannot be asked about earlier attempts', async () => {
    fetchMock.mockImplementationOnce(async () => json({ status: false, message: 'Bad gateway' }, 502))
    owed()
    await sendRefund('refund_1')
    advance(31)
    fetchMock.mockImplementation(async () => json({ status: false, message: 'down' }, 500))
    const run = await runRefunds()
    expect(run.results[0]).toMatchObject({ action: 'failed' })
    expect(calls('POST')).toHaveLength(1)
    expect(refund()).toMatchObject({ status: 'FAILED', failureReason: 'Could not check Paystack for an existing refund' })
  })

  it('stops after the retry cap and alerts once', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' ? json({ status: true, data: [] }) : json({ status: false, message: 'Service unavailable' }, 503))
    owed()
    await sendRefund('refund_1')
    for (let i = 0; i < MAX_REFUND_RETRIES + 3; i++) {
      advance(31)
      await runRefunds()
    }
    expect(calls('POST')).toHaveLength(1 + MAX_REFUND_RETRIES)
    expect(refund()).toMatchObject({ status: 'FAILED', retryCount: MAX_REFUND_RETRIES })
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('picks up a refund a dead run left claimed, checking Paystack first', async () => {
    owed({ initiatedAt: new Date(clock - 16 * 60 * 1000) })
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' ? json({ status: true, data: [] }) : created())
    const run = await runRefunds()
    expect(run.results[0]).toMatchObject({ action: 'sent' })
    expect(calls('GET')).toHaveLength(1)
  })

  it('leaves a refund another run claimed a moment ago', async () => {
    owed({ initiatedAt: new Date(clock - 60_000) })
    expect((await runRefunds()).checked).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries once when two hourly runs overlap', async () => {
    fetchMock.mockImplementationOnce(async () => json({ status: false, message: 'Service unavailable' }, 503))
    owed()
    await sendRefund('refund_1')
    advance(31)
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 0))
      return (init?.method ?? 'GET') === 'GET' ? json({ status: true, data: [] }) : created()
    })
    await Promise.all([runRefunds(), runRefunds()])
    expect(calls('POST')).toHaveLength(2) // the first attempt and one retry
    expect(refund().retryCount).toBe(1)
  })
})

// ─── Webhook ────────────────────────────────────────────────────────────────

describe('refund webhooks', () => {
  it('moves a refund through pending, processing and processed', async () => {
    owed({ status: 'PROCESSING', paystackRefundId: '9001' })
    expect((await webhook('refund.pending', { id: 9001, transaction_reference: 'FIE-booking_1-1' })).status).toBe(200)
    expect(refund().status).toBe('PROCESSING')
    await webhook('refund.processing', { id: 9001 })
    expect(refund().status).toBe('PROCESSING')
    await webhook('refund.processed', { id: 9001 })
    expect(refund().status).toBe('PROCESSED')
    expect(state.bookings[0].paymentStatus).toBe('REFUNDED')
  })

  it('finds the refund by the payment reference when the id is new to us', async () => {
    owed({ status: 'PROCESSING' })
    await webhook('refund.processed', { id: 4242, transaction_reference: 'FIE-booking_1-1' })
    expect(refund()).toMatchObject({ status: 'PROCESSED', paystackRefundId: '4242' })
  })

  it('records a failed refund once and alerts', async () => {
    owed({ status: 'PROCESSING', paystackRefundId: '9001' })
    await webhook('refund.failed', { id: 9001 })
    await webhook('refund.failed', { id: 9001 })
    expect(refund()).toMatchObject({ status: 'FAILED', failureReason: 'Paystack could not complete the refund' })
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('keeps a landed refund landed, whatever arrives afterwards', async () => {
    owed({ status: 'PROCESSED', paystackRefundId: '9001', processedAt: new Date(clock) })
    await webhook('refund.failed', { id: 9001 })
    await webhook('refund.pending', { id: 9001 })
    expect(refund().status).toBe('PROCESSED')
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('ignores a refund it does not know, and rejects a bad signature', async () => {
    owed()
    await handleRefundEvent('refund.processed', { id: 1, transaction_reference: 'FIE-unknown' })
    expect(refund().status).toBe('PENDING')
    const res = await paystackWebhook(new Request('http://x/api/webhooks/paystack', {
      method: 'POST', body: JSON.stringify({ event: 'refund.processed', data: { id: 9001 } }), headers: { 'x-paystack-signature': 'nope' },
    }))
    expect(res.status).toBe(401)
    expect(refund().status).toBe('PENDING')
  })
})

// ─── What cancelling would do ───────────────────────────────────────────────

describe('previewCancellation', () => {
  const NOW = new Date('2027-03-01T10:00:00Z')
  const booking = (over: Partial<CancelBooking> = {}): CancelBooking => ({
    status: 'CONFIRMED', paymentStatus: 'PAID', rentalMode: 'SHORT_STAY',
    checkIn: new Date('2027-03-11T12:00:00Z'), subtotal: 400, serviceFee: 48, damageDeposit: 50, pricePerUnit: 100,
    cancellationPolicy: 'MODERATE', listing: { cancellationPolicy: 'STRICT' }, ...over,
  })
  const payment = { id: 'payment_1', amount: 498, amountPesewas: 771_900 }
  const preview = (b: CancelBooking, by: 'GUEST' | 'HOST' = 'GUEST', extra: { hasPayout?: boolean; payment?: typeof payment | null; now?: Date } = {}) =>
    previewCancellation({ booking: b, payment: extra.payment === undefined ? payment : extra.payment, hasPayout: extra.hasPayout ?? false, by, now: extra.now ?? NOW })

  it('shows the exact amount back, the amount kept and the last day it applies', () => {
    const p = preview(booking())
    expect(p).toMatchObject({
      canCancel: true, by: 'GUEST', paid: true, policy: 'MODERATE', policyLabel: 'Moderate', daysBefore: 10,
      quote: { percent: 100, total: 498, kept: 0 }, paidAmount: 498, refundPesewas: 771_900, appliesUntil: '2027-03-06',
    })
    const late = preview(booking(), 'GUEST', { now: new Date('2027-03-08T10:00:00Z') })
    expect(late).toMatchObject({ daysBefore: 3, quote: { percent: 50, stayRefund: 200, serviceFeeRefund: 0, depositRefund: 50, total: 250, kept: 248 }, refundPesewas: 387_500, appliesUntil: '2027-03-10' })
  })

  it('uses the policy copied onto the booking, not the listing as it is now', () => {
    expect(preview(booking(), 'GUEST', { now: new Date('2027-03-08T10:00:00Z') })).toMatchObject({ policy: 'MODERATE', quote: { percent: 50 } })
    expect(preview(booking({ cancellationPolicy: null }), 'GUEST', { now: new Date('2027-03-08T10:00:00Z') })).toMatchObject({ policy: 'STRICT', quote: { percent: 0, total: 50 } })
  })

  it('gives the guest everything when the host cancels', () => {
    const p = preview(booking({ cancellationPolicy: 'STRICT' }), 'HOST', { now: new Date('2027-03-10T10:00:00Z') })
    expect(p).toMatchObject({ canCancel: true, by: 'HOST', quote: { percent: 100, total: 498, kept: 0 }, appliesUntil: null })
  })

  it('sends cancellations on or after the check-in day to support', () => {
    for (const now of ['2027-03-11T00:00:00Z', '2027-03-11T15:00:00Z', '2027-03-14T09:00:00Z']) {
      expect(preview(booking(), 'GUEST', { now: new Date(now) })).toEqual({ canCancel: false, message: CANCEL_CONTACT_SUPPORT })
      expect(preview(booking(), 'HOST', { now: new Date(now) })).toEqual({ canCancel: false, message: CANCEL_CONTACT_SUPPORT })
    }
  })

  it('sends it to support once a payout exists', () => {
    expect(preview(booking(), 'GUEST', { hasPayout: true })).toEqual({ canCancel: false, message: CANCEL_CONTACT_SUPPORT })
  })

  it('has nothing to refund on an unpaid booking', () => {
    const p = preview(booking({ paymentStatus: 'UNPAID' }), 'GUEST', { payment: null })
    expect(p).toMatchObject({ canCancel: true, paid: false, quote: null, refundPesewas: null, withdrawal: false })
  })

  it('lets a guest withdraw a request the host has not answered, with nothing to refund', () => {
    const pending = booking({ status: 'PENDING', paymentStatus: 'UNPAID' })
    expect(preview(pending, 'GUEST', { payment: null })).toMatchObject({ canCancel: true, withdrawal: true, quote: null })
    // even on the day itself: nothing is owed either way
    expect(preview(pending, 'GUEST', { payment: null, now: new Date('2027-03-11T15:00:00Z') })).toMatchObject({ canCancel: true, withdrawal: true })
    // the host declines a request, they do not cancel it
    expect(preview(pending, 'HOST', { payment: null })).toMatchObject({ canCancel: false })
  })

  it('refuses a booking that is already cancelled, declined or completed', () => {
    for (const status of ['CANCELLED', 'DECLINED', 'COMPLETED']) {
      expect(preview(booking({ status }))).toEqual({ canCancel: false, message: `Cannot cancel a booking that is ${status.toLowerCase()}` })
    }
  })

  it('does not guess when a booking is marked paid with no payment on record', () => {
    expect(preview(booking(), 'GUEST', { payment: null })).toMatchObject({ canCancel: false })
  })

  it('leaves the cedi amount empty when the payment has none stored', () => {
    expect(preview(booking(), 'GUEST', { payment: { ...payment, amountPesewas: null as unknown as number } })).toMatchObject({ refundPesewas: null, quote: { total: 498 } })
  })
})

import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real route handlers and jobs, run against an in-memory stand-in for the
// database and a mocked fetch. No test may reach Paystack or a real database.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  payments: [] as Row[], bookings: [] as Row[], refunds: [] as Row[], blockedDates: [] as Row[],
  listing: {} as Row, user: null as { id: string; role: string; email: string | null } | null, writes: 0,
}))
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(), captureMessage: vi.fn(),
  withMonitor: (_name: string, fn: () => unknown) => fn(),
}))
const sendRefund = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => sentry)
// Messages are covered by lib/messaging tests; here notify() is only a call that must not get in the way
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => state.user }))
vi.mock('@/lib/refunds', async (original) => ({ ...(await original<typeof import('@/lib/refunds')>()), sendRefund }))

vi.mock('@/lib/db', async () => {
  const { Prisma } = await import('@prisma/client')
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' })
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
      const value = row[key] ?? null
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; not?: unknown; lte?: Date; gte?: Date; lt?: Date }
        if ('in' in c && !c.in!.includes(value)) return false
        if ('not' in c && value === c.not) return false
        if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
        if ('gte' in c && !(value instanceof Date && value >= c.gte!)) return false
        if ('lt' in c && !(value instanceof Date && value < c.lt!)) return false
        return true
      }
      return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond
    })
  const write = (rows: Row[], data: Row) => { rows.forEach((r) => Object.assign(r, data)); state.writes += rows.length }

  const bookingView = (b: Row, shape: Row = {}) => {
    const paymentsWhere = (shape.payments as { where?: Row } | undefined)?.where
    return {
      ...b,
      listing: { ...state.listing },
      guest: { id: b.guestId, email: 'guest@example.test' },
      payments: state.payments.filter((p) => p.bookingId === b.id && matches(p, paymentsWhere)).map((p) => ({ ...p })),
      refund: state.refunds.find((r) => r.bookingId === b.id) ?? null,
      // None of these bookings is paid in instalments: those are covered in rentInstalments.test.ts
      instalments: [],
    }
  }

  const db = {
    payment: {
      findUnique: async ({ where }: { where: Row }) => {
        await tick()
        const row = state.payments.find((p) => matches(p, where))
        if (!row) return null
        return { ...row, booking: bookingView(state.bookings.find((b) => b.id === row.bookingId)!) }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.payments.filter((p) => matches(p, where))
        write(rows, data)
        return { count: rows.length }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.payments.find((p) => p.id === where.id)!
        write([row], data)
        return { ...row }
      },
      create: async ({ data }: { data: Row }) => {
        if (state.payments.some((p) => p.gatewayReference === data.gatewayReference)) throw known('P2002')
        const row = { id: `payment_${state.payments.length + 1}`, status: 'PENDING', createdAt: new Date(), ...data }
        state.payments.push(row)
        state.writes++
        return { ...row }
      },
    },
    booking: {
      findUnique: async ({ where, include }: { where: Row; include?: Row }) => {
        const row = state.bookings.find((b) => b.id === where.id)
        return row ? bookingView(row, include) : null
      },
      findFirst: async () => null,
      findMany: async ({ where, select }: { where: Row; select?: Row }) =>
        state.bookings.filter((b) => matches(b, where)).map((b) => bookingView(b, select)),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.bookings.filter((b) => matches(b, where))
        write(rows, data)
        return { count: rows.length }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.bookings.find((b) => matches(b, where))
        if (!row) throw known('P2025')
        write([row], data)
        return bookingView(row)
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `booking_${state.bookings.length + 1}`, createdAt: new Date(), ...data }
        state.bookings.push(row)
        state.writes++
        return { ...row }
      },
    },
    refund: {
      create: async ({ data }: { data: Row }) => {
        // One refund per booking, as the unique index has it
        if (state.refunds.some((r) => r.bookingId === data.bookingId)) throw known('P2002')
        const row = { id: `refund_${state.refunds.length + 1}`, status: 'PENDING', ...data }
        state.refunds.push(row)
        state.writes++
        return { ...row }
      },
    },
    blockedDate: {
      findFirst: async () => null,
      createMany: async ({ data }: { data: Row[] }) => { state.blockedDates.push(...data); state.writes++; return { count: data.length } },
      deleteMany: async ({ where }: { where: Row }) => {
        const keep = state.blockedDates.filter((d) => !matches(d, where))
        const count = state.blockedDates.length - keep.length
        state.blockedDates.splice(0, state.blockedDates.length, ...keep)
        state.writes += count
        return { count }
      },
    },
    listing: { findUnique: async () => ({ ...state.listing, host: { id: state.listing.hostId } }) },
    exchangeRate: { findFirst: async () => ({ usdToGhs: 15.5 }) },
    payout: { findFirst: async () => null },
    instalment: { updateMany: async () => ({ count: 0 }) },
    user: { findMany: async () => [] },
    notification: { createMany: async () => ({ count: 0 }) },
  }

  // One transaction at a time, and a thrown error puts everything back: what
  // row locks and a rollback give the real database
  let queue: Promise<unknown> = Promise.resolve()
  const tables = ['payments', 'bookings', 'refunds', 'blockedDates'] as const
  ;(db as unknown as { $transaction: unknown }).$transaction = (arg: unknown) => {
    if (typeof arg !== 'function') return Promise.all(arg as Promise<unknown>[])
    const run = queue.then(async () => {
      const before = tables.map((t) => state[t].map((r) => ({ ...r })))
      const writes = state.writes
      try {
        return await (arg as (tx: unknown) => unknown)(db)
      } catch (error) {
        tables.forEach((t, i) => state[t].splice(0, state[t].length, ...before[i]))
        state.writes = writes
        throw error
      }
    })
    queue = run.catch(() => {})
    return run
  }
  return { db }
})

import { settlePayment } from '@/lib/paymentSettle'
import { runExpiry } from '@/lib/bookingExpiry'
import {
  EXPIRED_UNANSWERED, EXPIRED_UNPAID, HOST_MUST_ACCEPT, PAY_WINDOW_PASSED,
  answerDeadline, formatPayBy, payDeadline, payState,
} from '@/lib/payDeadline'
import { POST as paystackWebhook } from '@/app/api/webhooks/paystack/route'
import { GET as verifyRoute } from '@/app/api/payments/verify/route'
import { POST as startPayment } from '@/app/api/payments/route'
import { POST as createBooking } from '@/app/api/bookings/route'
import { PATCH as updateBooking } from '@/app/api/bookings/[id]/route'
import * as expireCron from '@/app/api/cron/expire-bookings/route'

// ─── Helpers ────────────────────────────────────────────────────────────────

const SECRET = 'sk_test_settle'
const REF = 'FIE-booking_1-1'
const NOW = new Date('2027-03-01T10:00:00Z')
const MIN = 60 * 1000
const HOUR = 60 * MIN
const fetchMock = vi.fn()

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const ahead = (ms: number) => new Date(NOW.getTime() + ms)
const booking = (id = 'booking_1') => state.bookings.find((b) => b.id === id)!
const payment = (id = 'payment_1') => state.payments.find((p) => p.id === id)!
const alerts = () => sentry.captureMessage.mock.calls.map(([, options]) => options.tags.payment_issue)

/** A confirmed, unpaid booking of $498, and (unless told not to) a payment started on it for 771,900 pesewas. */
function unpaid(over: Row = {}, pay: Row | false = {}) {
  state.bookings.push({
    id: 'booking_1', listingId: 'listing_1', guestId: 'guest_1', hostId: 'host_1',
    status: 'CONFIRMED', paymentStatus: 'UNPAID', rentalMode: 'SHORT_STAY',
    checkIn: new Date('2027-03-10T12:00:00Z'), checkOut: new Date('2027-03-12T12:00:00Z'),
    pricePerUnit: 200, subtotal: 400, serviceFee: 48, damageDeposit: 50, totalPrice: 498,
    cancellationPolicy: 'MODERATE', payBy: ahead(30 * MIN), createdAt: ago(30 * MIN),
    cancelledBy: null, cancelReason: null, cancelledAt: null,
    ...over,
  })
  if (pay) started(pay)
}
function started(over: Row = {}) {
  state.payments.push({
    id: `payment_${state.payments.length + 1}`, bookingId: 'booking_1', amount: 498, currency: 'USD', method: 'MOMO',
    amountPesewas: 771_900, usdToGhs: 15.5, gatewayReference: REF, status: 'PENDING', createdAt: ago(5 * MIN),
    ...over,
  })
}

/** What Paystack says when asked about a transaction. */
function paystackSays(status: string, over: Row = {}) {
  fetchMock.mockImplementation(async () => json({ status: true, data: { status, amount: 771_900, currency: 'GHS', reference: REF, ...over } }))
}
const charge = (over: Row = {}) => ({ reference: REF, status: 'success', amount: 771_900, currency: 'GHS', ...over })

function webhook(data: Row, { signature }: { signature?: string | null } = {}) {
  const body = JSON.stringify({ event: 'charge.success', data })
  const sig = signature === undefined ? crypto.createHmac('sha512', SECRET).update(body).digest('hex') : signature
  return paystackWebhook(new Request('http://x/api/webhooks/paystack', {
    method: 'POST', body, headers: sig === null ? {} : { 'x-paystack-signature': sig },
  }))
}
const verify = (reference = REF) => verifyRoute(new Request(`http://x/api/payments/verify?reference=${reference}`))
const landedOn = (res: Response) => new URL(res.headers.get('location')!).searchParams.get('payment')
const pay = () => startPayment(new Request('http://x/api/payments', { method: 'POST', body: JSON.stringify({ bookingId: 'booking_1', method: 'MOMO' }) }))
const patch = (body: Row) => updateBooking(
  new Request('http://x/api/bookings/booking_1', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 'booking_1' }) },
)
const cron = (query = '', secret: string | null = 'cron_secret') => expireCron.GET(new Request(`http://x/api/cron/expire-bookings${query}`, {
  headers: secret ? { authorization: `Bearer ${secret}` } : {},
}))

beforeEach(() => {
  state.payments.length = 0
  state.bookings.length = 0
  state.refunds.length = 0
  state.blockedDates.length = 0
  state.listing = { id: 'listing_1', hostId: 'host_1', title: 'A home', cancellationPolicy: 'MODERATE' }
  state.user = { id: 'guest_1', role: 'GUEST', email: 'guest@example.test' }
  state.writes = 0
  sentry.captureMessage.mockReset()
  sendRefund.mockReset()
  sendRefund.mockResolvedValue({ sent: false, skipped: 'REFUNDS_ENABLED is not set to true' })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('PAYSTACK_SECRET_KEY', SECRET)
  vi.stubEnv('NEXTAUTH_URL', 'http://x')
  vi.stubEnv('CRON_SECRET', 'cron_secret')
  vi.stubEnv('PAYMENT_WEBHOOK_ENABLED', 'true')
  vi.stubEnv('BOOKING_EXPIRY_ENABLED', 'true')
  vi.stubEnv('BOOKING_EXPIRY_NOT_BEFORE', '2027-01-01')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

// ─── One confirmation path ──────────────────────────────────────────────────

describe('a payment that succeeds', () => {
  it('is confirmed by the verify route when the guest comes back', async () => {
    unpaid()
    paystackSays('success')
    const res = await verify()
    expect(landedOn(res)).toBe('success')
    expect(payment().status).toBe('SUCCESS')
    expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    // The only call is the read-only lookup
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.paystack.co/transaction/verify/${REF}`)
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
  })

  it('is confirmed by the webhook when the guest closes the tab and verify never runs', async () => {
    unpaid()
    const res = await webhook(charge())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(payment().status).toBe('SUCCESS')
    expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    // The signed payload is enough: Paystack is not asked again
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is confirmed once when the webhook arrives before verify', async () => {
    unpaid()
    paystackSays('success')
    await webhook(charge())
    const writes = state.writes
    expect(landedOn(await verify())).toBe('success')
    expect(state.writes).toBe(writes)
  })

  it('is confirmed once when verify arrives before the webhook', async () => {
    unpaid()
    paystackSays('success')
    await verify()
    const writes = state.writes
    expect((await webhook(charge())).status).toBe(200)
    expect(state.writes).toBe(writes)
    expect(booking().paymentStatus).toBe('PAID')
  })

  it('is confirmed once when the webhook is delivered twice', async () => {
    unpaid()
    await webhook(charge())
    const writes = state.writes
    await webhook(charge())
    await webhook(charge())
    expect(state.writes).toBe(writes)
    expect(writes).toBe(2) // the payment and the booking, once each
  })

  it('is confirmed once when the webhook and verify arrive at the same moment', async () => {
    unpaid()
    paystackSays('success')
    const [a, b] = await Promise.all([webhook(charge()), verify()])
    expect(a.status).toBe(200)
    expect(landedOn(b)).toBe('success')
    expect(state.writes).toBe(2)
    expect(state.refunds).toHaveLength(0)
  })

  it('wins over an earlier failure: a payment marked failed is still confirmed', async () => {
    unpaid()
    paystackSays('abandoned')
    expect(landedOn(await verify())).toBe('failed')
    expect(payment().status).toBe('FAILED')
    await webhook(charge())
    expect(payment().status).toBe('SUCCESS')
    expect(booking().paymentStatus).toBe('PAID')
  })
})

// ─── The amount, currency and reference must match ──────────────────────────

describe('a payment that does not match what we asked for', () => {
  it.each([
    ['a smaller amount', { amount: 100 }],
    ['a larger amount', { amount: 771_901 }],
    ['another currency', { currency: 'NGN' }],
    ['no currency', { currency: undefined }],
  ])('is not confirmed: %s', async (_name, over) => {
    unpaid()
    await webhook(charge(over))
    expect(payment().status).toBe('MISMATCH')
    expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID' })
    expect(state.refunds).toHaveLength(0)
    expect(alerts()).toEqual(['MISMATCH'])
    // Delivered again: nothing more happens, and no second alert
    await webhook(charge(over))
    expect(alerts()).toEqual(['MISMATCH'])
  })

  it('is not confirmed through the verify route either', async () => {
    unpaid()
    paystackSays('success', { amount: 5_000 })
    expect(landedOn(await verify())).toBe('error')
    expect(booking().paymentStatus).toBe('UNPAID')
    expect(payment().status).toBe('MISMATCH')
  })

  it('is not confirmed when the payment has no stored cedi amount to compare with', async () => {
    unpaid({}, { amountPesewas: null })
    await webhook(charge())
    expect(payment().status).toBe('MISMATCH')
    expect(booking().paymentStatus).toBe('UNPAID')
  })

  it('does nothing for a reference that is not ours', async () => {
    unpaid()
    const res = await webhook(charge({ reference: 'FIE-someone-else' }))
    expect(res.status).toBe(200)
    expect(state.writes).toBe(0)
    expect(await settlePayment(charge({ reference: 'nope' }))).toMatchObject({ outcome: 'unknown-reference', changed: false })
  })

  it('alerts with IDs and amounts only', async () => {
    unpaid()
    await webhook(charge({ amount: 100 }))
    const [, options] = sentry.captureMessage.mock.calls[0]
    expect(options.contexts.payment).toEqual({
      paymentId: 'payment_1', bookingId: 'booking_1', bookingStatus: 'CONFIRMED',
      expectedPesewas: 771_900, paidPesewas: 100, currency: 'GHS',
    })
  })
})

// ─── The signature ──────────────────────────────────────────────────────────

describe('the webhook signature', () => {
  it.each([
    ['a wrong signature', 'deadbeef'],
    ['a signature made with another key', crypto.createHmac('sha512', 'sk_test_other').update('{}').digest('hex')],
    ['no signature', null],
  ])('refuses %s and changes nothing', async (_name, signature) => {
    unpaid()
    const res = await webhook(charge(), { signature })
    expect(res.status).toBe(401)
    expect(state.writes).toBe(0)
    expect(booking().paymentStatus).toBe('UNPAID')
  })

  it('is checked against the exact bytes sent, not a re-serialised copy', async () => {
    unpaid()
    // The same JSON with different spacing has a different signature
    const sent = `{"event":"charge.success",  "data":${JSON.stringify(charge())}}`
    const sig = crypto.createHmac('sha512', SECRET).update(sent).digest('hex')
    const res = await paystackWebhook(new Request('http://x/api/webhooks/paystack', { method: 'POST', body: sent, headers: { 'x-paystack-signature': sig } }))
    expect(res.status).toBe(200)
    expect(booking().paymentStatus).toBe('PAID')
  })
})

// ─── The switch ─────────────────────────────────────────────────────────────

describe('with PAYMENT_WEBHOOK_ENABLED off', () => {
  it('checks the signature, reports what it would do and writes nothing', async () => {
    for (const value of ['', '1', 'TRUE', 'yes']) {
      vi.stubEnv('PAYMENT_WEBHOOK_ENABLED', value)
      state.bookings.length = 0; state.payments.length = 0
      unpaid()
      const res = await webhook(charge())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ received: true, dryRun: true, would: 'confirmed' })
      expect(payment().status).toBe('PENDING')
      expect(booking().paymentStatus).toBe('UNPAID')
    }
    expect(state.writes).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still refuses a bad signature', async () => {
    vi.stubEnv('PAYMENT_WEBHOOK_ENABLED', '')
    unpaid()
    expect((await webhook(charge(), { signature: 'deadbeef' })).status).toBe(401)
  })

  it('reports a refund it would record, and a mismatch, without recording either', async () => {
    vi.stubEnv('PAYMENT_WEBHOOK_ENABLED', '')
    unpaid({ status: 'CANCELLED' })
    expect(await (await webhook(charge())).json()).toMatchObject({ dryRun: true, would: 'refunded' })
    expect(await (await webhook(charge({ amount: 1 }))).json()).toMatchObject({ dryRun: true, would: 'mismatch' })
    expect(state.writes).toBe(0)
    expect(state.refunds).toHaveLength(0)
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('leaves the verify route working as the way a payment is confirmed', async () => {
    vi.stubEnv('PAYMENT_WEBHOOK_ENABLED', '')
    unpaid()
    paystackSays('success')
    expect(landedOn(await verify())).toBe('success')
    expect(booking().paymentStatus).toBe('PAID')
  })
})

// ─── A booking that no longer stands ────────────────────────────────────────

describe('a payment for a booking that no longer stands', () => {
  it.each([
    ['cancelled', { status: 'CANCELLED', cancelledBy: 'GUEST' }],
    ['declined', { status: 'DECLINED' }],
    ['expired', { status: 'CANCELLED', cancelledBy: 'SYSTEM', cancelReason: 'UNPAID_EXPIRED' }],
  ])('is refunded in full and the %s booking is not revived', async (_name, over) => {
    unpaid(over)
    await webhook(charge())
    expect(payment().status).toBe('SUCCESS')
    expect(booking()).toMatchObject({ status: over.status, paymentStatus: 'PAID' })
    expect(state.refunds).toEqual([expect.objectContaining({
      bookingId: 'booking_1', paymentId: 'payment_1', reason: 'LATE_PAYMENT',
      stayRefund: 400, serviceFeeRefund: 48, depositRefund: 50, amount: 498, amountPesewas: 771_900,
    })])
    expect(sendRefund).toHaveBeenCalledTimes(1)
    expect(sendRefund).toHaveBeenCalledWith('refund_1')
    // A dead booking being paid for is expected, not an alarm
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('records one refund however many times it is told', async () => {
    unpaid({ status: 'CANCELLED' })
    paystackSays('success')
    await webhook(charge())
    await webhook(charge())
    expect(landedOn(await verify())).toBe('refunded')
    expect(state.refunds).toHaveLength(1)
    expect(sendRefund).toHaveBeenCalledTimes(1)
  })

  it('sends the guest to the refunded screen from the verify route', async () => {
    unpaid({ status: 'DECLINED' })
    paystackSays('success')
    expect(landedOn(await verify())).toBe('refunded')
    expect(booking().status).toBe('DECLINED')
  })

  it('still records the refund when sending it throws', async () => {
    unpaid({ status: 'CANCELLED' })
    sendRefund.mockRejectedValue(new Error('Paystack is down'))
    const result = await settlePayment(charge())
    expect(result).toMatchObject({ outcome: 'refunded', changed: true, refundId: 'refund_1' })
    expect(state.refunds).toHaveLength(1)
  })

  it('refunds a payment that lands on a request the host has not accepted, and alerts', async () => {
    unpaid({ status: 'PENDING', payBy: null })
    await webhook(charge())
    expect(booking()).toMatchObject({ status: 'PENDING', paymentStatus: 'PAID' })
    expect(state.refunds).toEqual([expect.objectContaining({ reason: 'LATE_PAYMENT', amount: 498 })])
    expect(alerts()).toEqual(['PAID_PENDING_REQUEST'])
  })
})

// ─── A second payment ───────────────────────────────────────────────────────

describe('a second successful payment on one booking', () => {
  it('is marked a duplicate, alerts, and leaves the refund to a person', async () => {
    unpaid({ paymentStatus: 'PAID' }, { id: 'payment_1', status: 'SUCCESS', gatewayReference: 'FIE-booking_1-0' })
    started({ id: 'payment_2' })
    await webhook(charge())
    expect(payment('payment_2').status).toBe('DUPLICATE')
    expect(payment('payment_1').status).toBe('SUCCESS')
    expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    expect(state.refunds).toHaveLength(0)
    expect(sendRefund).not.toHaveBeenCalled()
    expect(alerts()).toEqual(['DUPLICATE'])
    await webhook(charge())
    expect(alerts()).toEqual(['DUPLICATE'])
  })

  it('is a duplicate on a cancelled booking that already has its one refund', async () => {
    unpaid({ status: 'CANCELLED' }, { id: 'payment_1', gatewayReference: 'FIE-booking_1-0' })
    started({ id: 'payment_2' })
    await webhook(charge({ reference: 'FIE-booking_1-0' }))
    await webhook(charge())
    expect(payment('payment_1').status).toBe('SUCCESS')
    expect(payment('payment_2').status).toBe('DUPLICATE')
    expect(state.refunds).toHaveLength(1)
    expect(alerts()).toEqual(['DUPLICATE'])
  })
})

// ─── Failed, and still in progress ──────────────────────────────────────────

describe('a payment that does not succeed', () => {
  it.each(['failed', 'abandoned'])('is marked failed when Paystack says %s, and the booking is untouched', async (status) => {
    unpaid()
    paystackSays(status)
    expect(landedOn(await verify())).toBe('failed')
    expect(payment().status).toBe('FAILED')
    expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID' })
    expect(state.refunds).toHaveLength(0)
  })

  it.each(['ongoing', 'pending', 'processing', 'queued'])('stays pending while Paystack says %s', async (status) => {
    unpaid()
    paystackSays(status)
    expect(landedOn(await verify())).toBe('pending')
    expect(payment().status).toBe('PENDING')
    expect(state.writes).toBe(0)
  })

  it('counts a reference Paystack has never heard of as abandoned', async () => {
    unpaid()
    fetchMock.mockImplementation(async () => json({ status: false, message: 'Transaction reference not found' }, 400))
    expect(landedOn(await verify())).toBe('failed')
    expect(payment().status).toBe('FAILED')
  })

  it.each([
    ['Paystack is down', async () => json({ status: false, message: 'Internal error' }, 500)],
    ['the network fails', async () => { throw new Error('ECONNRESET') }],
  ])('changes nothing when %s', async (_name, answer) => {
    unpaid()
    fetchMock.mockImplementation(answer)
    expect(landedOn(await verify())).toBe('error')
    expect(state.writes).toBe(0)
    expect(payment().status).toBe('PENDING')
  })
})

// ─── A request must be accepted before it is paid ───────────────────────────

describe('paying for a request', () => {
  const initialised = () => fetchMock.mockImplementation(async () => json({ status: true, data: { authorization_url: 'https://checkout.paystack.com/x', access_code: 'x', reference: 'r' } }))

  it('is refused until the host accepts, before anything is written or sent', async () => {
    unpaid({ status: 'PENDING', payBy: null }, false)
    const res = await pay()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(HOST_MUST_ACCEPT)
    expect(HOST_MUST_ACCEPT).toBe('The host needs to accept your request first.')
    expect(state.writes).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('can be paid for once the host accepts, with 24 hours to do it', async () => {
    unpaid({ status: 'PENDING', payBy: null }, false)
    state.user = { id: 'host_1', role: 'HOST', email: null }
    const accepted = await patch({ action: 'accept' })
    expect(accepted.status).toBe(200)
    expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID', payBy: ahead(24 * HOUR) })

    state.user = { id: 'guest_1', role: 'GUEST', email: 'guest@example.test' }
    initialised()
    const res = await pay()
    expect(res.status).toBe(200)
    expect((await res.json()).authorizationUrl).toBe('https://checkout.paystack.com/x')
    expect(payment()).toMatchObject({ status: 'PENDING', amountPesewas: 771_900, bookingId: 'booking_1' })
  })

  it('gives a declined request no deadline', async () => {
    unpaid({ status: 'PENDING', payBy: null }, false)
    state.user = { id: 'host_1', role: 'HOST', email: null }
    await patch({ action: 'decline' })
    expect(booking()).toMatchObject({ status: 'DECLINED', payBy: null })
  })

  it('cannot be accepted while a payment on it is being refunded', async () => {
    unpaid({ status: 'PENDING', payBy: null, paymentStatus: 'PAID' }, false)
    state.user = { id: 'host_1', role: 'HOST', email: null }
    const res = await patch({ action: 'accept' })
    expect(res.status).toBe(409)
    expect(booking().status).toBe('PENDING')
  })

  it('is refused once the time to pay has passed', async () => {
    unpaid({ payBy: ago(1 * MIN) }, false)
    const res = await pay()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PAY_WINDOW_PASSED)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is allowed up to the deadline, and on a booking with no deadline', async () => {
    for (const payBy of [ahead(1 * MIN), null]) {
      state.bookings.length = 0; state.payments.length = 0
      unpaid({ payBy }, false)
      initialised()
      expect((await pay()).status).toBe(200)
    }
  })

  it.each([
    ['expired unpaid', { cancelReason: 'UNPAID_EXPIRED' }, EXPIRED_UNPAID],
    ['expired unanswered', { cancelReason: 'NO_HOST_RESPONSE' }, EXPIRED_UNANSWERED],
  ])('is refused on a booking that %s, with the reason', async (_name, over, message) => {
    unpaid({ status: 'CANCELLED', cancelledBy: 'SYSTEM', ...over }, false)
    const res = await pay()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(message)
  })
})

// ─── Deadlines ──────────────────────────────────────────────────────────────

describe('pay deadlines', () => {
  const checkIn = new Date('2027-03-10T12:00:00Z')

  it('gives an instant booking one hour and an accepted request 24', () => {
    expect(payDeadline('INSTANT', checkIn, NOW)).toEqual(ahead(1 * HOUR))
    expect(payDeadline('ACCEPTED', checkIn, NOW)).toEqual(ahead(24 * HOUR))
  })

  it('never runs past the end of the check-in day', () => {
    const today = new Date('2027-03-01T12:00:00Z')
    expect(payDeadline('ACCEPTED', today, NOW)).toEqual(new Date('2027-03-02T00:00:00Z'))
    // Booked for today at 23:30: half an hour, not an hour
    expect(payDeadline('INSTANT', today, new Date('2027-03-01T23:30:00Z'))).toEqual(new Date('2027-03-02T00:00:00Z'))
    // A stay booked for this afternoon can still be paid for
    expect(payDeadline('INSTANT', today, new Date('2027-03-01T15:00:00Z'))).toEqual(new Date('2027-03-01T16:00:00Z'))
  })

  it('ends an unanswered request after 48 hours, or with the check-in day if sooner', () => {
    expect(answerDeadline(NOW, checkIn)).toEqual(ahead(48 * HOUR))
    expect(answerDeadline(NOW, new Date('2027-03-02T12:00:00Z'))).toEqual(new Date('2027-03-03T00:00:00Z'))
  })

  it('stamps an instant booking with its deadline and leaves a request without one', async () => {
    for (const instantBook of [true, false]) {
      state.bookings.length = 0
      state.listing = {
        id: 'listing_1', hostId: 'host_1', title: 'A home', isActive: true, instantBook, cancellationPolicy: 'MODERATE',
        rentalModes: '["SHORT_STAY"]', priceNightly: 200, priceMonthly: null, priceAnnual: null, minStayNights: 1, damageDeposit: 50,
      }
      const res = await createBooking(new Request('http://x/api/bookings', {
        method: 'POST', body: JSON.stringify({ listingId: 'listing_1', rentalMode: 'SHORT_STAY', checkIn: '2027-03-10', checkOut: '2027-03-12' }),
      }))
      expect(res.status).toBe(201)
      expect(state.bookings[0]).toMatchObject(instantBook
        ? { status: 'CONFIRMED', paymentStatus: 'UNPAID', payBy: ahead(1 * HOUR) }
        : { status: 'PENDING', paymentStatus: 'UNPAID', payBy: null })
      // Two nights at $200 and a $50 deposit: no service fee is added
      expect(state.bookings[0]).toMatchObject({ subtotal: 400, serviceFee: 0, damageDeposit: 50, totalPrice: 450 })
    }
  })

  it('tells a guest where an unpaid booking stands', () => {
    const base = { status: 'CONFIRMED', paymentStatus: 'UNPAID', payBy: ahead(HOUR) }
    expect(payState(base, NOW)).toBe('AWAITING_PAYMENT')
    expect(payState({ ...base, payBy: null }, NOW)).toBe('AWAITING_PAYMENT')
    expect(payState({ ...base, payBy: ago(MIN) }, NOW)).toBe('PAY_WINDOW_PASSED')
    expect(payState({ ...base, status: 'PENDING', payBy: null }, NOW)).toBe('AWAITING_HOST')
    expect(payState({ ...base, paymentStatus: 'PAID' }, NOW)).toBeNull()
    expect(payState({ status: 'CANCELLED', paymentStatus: 'UNPAID', cancelledBy: 'SYSTEM', cancelReason: 'UNPAID_EXPIRED' }, NOW)).toBe('EXPIRED_UNPAID')
    expect(payState({ status: 'CANCELLED', paymentStatus: 'UNPAID', cancelledBy: 'SYSTEM', cancelReason: 'NO_HOST_RESPONSE' }, NOW)).toBe('EXPIRED_UNANSWERED')
    expect(payState({ status: 'CANCELLED', paymentStatus: 'UNPAID', cancelledBy: 'GUEST' }, NOW)).toBeNull()
  })

  it('writes a deadline as a time today or a day and a time, in the reader\'s time zone', () => {
    expect(formatPayBy(ahead(45 * MIN), NOW, 'Africa/Accra')).toBe('10:45 am today')
    expect(formatPayBy(ahead(24 * HOUR), NOW, 'Africa/Accra')).toBe('Tue 2 Mar, 10:00 am')
    // The same moment is still today in London and already tomorrow in Dubai
    expect(formatPayBy(new Date('2027-03-01T23:30:00Z'), NOW, 'Europe/London')).toBe('11:30 pm today')
    expect(formatPayBy(new Date('2027-03-01T23:30:00Z'), NOW, 'Asia/Dubai')).toBe('Tue 2 Mar, 3:30 am')
  })
})

// ─── Expiry ─────────────────────────────────────────────────────────────────

describe('the expiry job', () => {
  /** An unpaid booking whose time to pay ran out an hour ago, with its nights blocked. */
  function overdue(over: Row = {}, payments: Row | false = false) {
    unpaid({ payBy: ago(1 * HOUR), createdAt: ago(2 * HOUR), ...over }, payments)
    state.blockedDates.push(
      { listingId: 'listing_1', date: new Date('2027-03-10T12:00:00Z'), reason: 'BOOKED' },
      { listingId: 'listing_1', date: new Date('2027-03-11T12:00:00Z'), reason: 'BOOKED' },
      // A night inside the stay that the host blocked themselves
      { listingId: 'listing_1', date: new Date('2027-03-11T12:00:00Z'), reason: 'HOST' },
      { listingId: 'listing_2', date: new Date('2027-03-10T12:00:00Z'), reason: 'BOOKED' },
    )
  }

  describe('while switched off', () => {
    it.each(['', '1', 'TRUE', 'yes'])('only reports with BOOKING_EXPIRY_ENABLED=%j', async (value) => {
      vi.stubEnv('BOOKING_EXPIRY_ENABLED', value)
      overdue({}, {})
      const run = await runExpiry()
      expect(run).toMatchObject({ mode: 'dry-run', reason: 'BOOKING_EXPIRY_ENABLED is not set to true', checked: 1 })
      expect(run.results).toEqual([{ bookingId: 'booking_1', kind: 'UNPAID', action: 'would-expire', openPayments: 1 }])
      expect(state.writes).toBe(0)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(booking().status).toBe('CONFIRMED')
    })

    it.each(['', 'soon', '2027-02-31'])('stays in dry run without a real BOOKING_EXPIRY_NOT_BEFORE (%j)', async (value) => {
      vi.stubEnv('BOOKING_EXPIRY_NOT_BEFORE', value)
      overdue()
      const run = await runExpiry()
      expect(run).toMatchObject({ mode: 'dry-run', reason: 'BOOKING_EXPIRY_NOT_BEFORE is not set to a date (YYYY-MM-DD)' })
      expect(state.writes).toBe(0)
    })

    it('stays in dry run when ?dryRun=1 is passed, even switched on', async () => {
      overdue({}, {})
      const res = await cron('?dryRun=1')
      expect(await res.json()).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested', results: [{ action: 'would-expire' }] })
      expect(state.writes).toBe(0)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('is refused without the cron secret', async () => {
    overdue()
    expect((await cron('', null)).status).toBe(401)
    expect((await cron('', 'wrong')).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await cron('', '')).status).toBe(401)
    expect(state.writes).toBe(0)
  })

  it('ends an unpaid booking and releases only the nights it held', async () => {
    overdue()
    const res = await cron()
    expect(await res.json()).toMatchObject({ mode: 'live', checked: 1, results: [{ bookingId: 'booking_1', kind: 'UNPAID', action: 'expired' }] })
    expect(booking()).toMatchObject({
      status: 'CANCELLED', paymentStatus: 'UNPAID', cancelledBy: 'SYSTEM', cancelReason: 'UNPAID_EXPIRED', cancelledAt: NOW,
    })
    // The host's own block, and another listing's nights, are left alone
    expect(state.blockedDates).toEqual([
      expect.objectContaining({ listingId: 'listing_1', reason: 'HOST' }),
      expect.objectContaining({ listingId: 'listing_2', reason: 'BOOKED' }),
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits out the 15-minute grace after the deadline', async () => {
    overdue({ payBy: ago(14 * MIN) })
    expect((await runExpiry()).checked).toBe(0)
    booking().payBy = ago(15 * MIN)
    expect((await runExpiry()).results[0]).toMatchObject({ action: 'expired' })
  })

  it('never ends a booking with no deadline, or one made before BOOKING_EXPIRY_NOT_BEFORE', async () => {
    overdue({ payBy: null, createdAt: ago(90 * 24 * HOUR) })
    expect((await runExpiry()).checked).toBe(0)
    booking().payBy = ago(1 * HOUR)
    vi.stubEnv('BOOKING_EXPIRY_NOT_BEFORE', '2027-03-02')
    expect((await runExpiry()).checked).toBe(0)
    expect(booking().status).toBe('CONFIRMED')
  })

  it('leaves paid, pending and already cancelled bookings alone', async () => {
    overdue({ paymentStatus: 'PAID' })
    expect((await runExpiry()).checked).toBe(0)
    Object.assign(booking(), { paymentStatus: 'UNPAID', status: 'CANCELLED' })
    expect((await runExpiry()).checked).toBe(0)
  })

  describe('settles before it expires', () => {
    it('confirms a booking whose payment went through, instead of releasing it', async () => {
      overdue({}, {})
      paystackSays('success')
      const run = await runExpiry()
      expect(run.results).toEqual([{ bookingId: 'booking_1', kind: 'UNPAID', action: 'paid', openPayments: 1 }])
      expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', cancelledBy: null })
      expect(payment().status).toBe('SUCCESS')
      expect(state.blockedDates).toHaveLength(4)
      // Read-only: one lookup, nothing posted
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(`https://api.paystack.co/transaction/verify/${REF}`)
      expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
    })

    it('ends the booking once Paystack says the payment was abandoned', async () => {
      overdue({}, {})
      paystackSays('abandoned')
      expect((await runExpiry()).results[0]).toMatchObject({ action: 'expired' })
      expect(payment().status).toBe('FAILED')
      expect(booking()).toMatchObject({ status: 'CANCELLED', cancelReason: 'UNPAID_EXPIRED' })
    })

    it.each([
      ['Paystack cannot be reached', async () => { throw new Error('ECONNRESET') }, /Network error/],
      ['Paystack answers with an error', async () => json({ status: false, message: 'Internal error' }, 500), /HTTP 500/],
      ['the payment is still in progress', async () => json({ status: true, data: { status: 'ongoing', amount: 771_900, currency: 'GHS' } }), /still in progress/],
    ])('leaves the booking for the next run when %s', async (_name, answer, why) => {
      overdue({}, {})
      fetchMock.mockImplementation(answer)
      const run = await runExpiry()
      expect(run.results[0]).toMatchObject({ action: 'waiting', detail: expect.stringMatching(why) })
      expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID' })
      expect(payment().status).toBe('PENDING')
      expect(state.writes).toBe(0)
    })

    it('checks every open payment, and stops ending the booking if any of them paid', async () => {
      overdue({}, { gatewayReference: 'FIE-booking_1-0' })
      started({ id: 'payment_2' })
      fetchMock.mockImplementation(async (url: string) => json({ status: true, data: { status: url.endsWith('-0') ? 'abandoned' : 'success', amount: 771_900, currency: 'GHS' } }))
      expect((await runExpiry()).results[0]).toMatchObject({ action: 'paid', openPayments: 2 })
      expect(payment('payment_1').status).toBe('FAILED')
      expect(payment('payment_2').status).toBe('SUCCESS')
      expect(booking().paymentStatus).toBe('PAID')
    })

    it('alerts once a day about a booking stuck waiting on Paystack for a day', async () => {
      overdue({ payBy: ago(26 * HOUR) }, {})
      fetchMock.mockImplementation(async () => { throw new Error('ECONNRESET') })
      expect((await runExpiry({ now: new Date('2027-03-01T10:00:00Z') })).stuckAlerts).toBe(0)
      expect((await runExpiry({ now: new Date('2027-03-02T09:00:00Z') })).stuckAlerts).toBe(1)
      expect((await runExpiry({ now: new Date('2027-03-02T09:15:00Z') })).stuckAlerts).toBe(0)
      expect(alerts()).toEqual(['EXPIRY_STUCK'])
    })
  })

  it('refunds a payment that arrives after the booking expired, and does not revive it', async () => {
    overdue({}, {})
    paystackSays('abandoned')
    await runExpiry()
    expect(booking().status).toBe('CANCELLED')
    // The guest went back to Paystack's page and paid after all
    await webhook(charge())
    expect(booking()).toMatchObject({ status: 'CANCELLED', cancelledBy: 'SYSTEM', paymentStatus: 'PAID' })
    expect(state.refunds).toEqual([expect.objectContaining({ reason: 'LATE_PAYMENT', amount: 498, amountPesewas: 771_900 })])
    expect(sendRefund).toHaveBeenCalledTimes(1)
  })

  describe('requests the host has not answered', () => {
    const request = (over: Row = {}) => unpaid({ status: 'PENDING', payBy: null, createdAt: ago(49 * HOUR), ...over }, false)

    it('end after 48 hours', async () => {
      request()
      expect((await runExpiry()).results).toEqual([{ bookingId: 'booking_1', kind: 'UNANSWERED', action: 'expired', openPayments: 0 }])
      expect(booking()).toMatchObject({ status: 'CANCELLED', cancelledBy: 'SYSTEM', cancelReason: 'NO_HOST_RESPONSE' })
    })

    it('are left alone before then', async () => {
      request({ createdAt: ago(47 * HOUR) })
      expect((await runExpiry()).checked).toBe(0)
    })

    it('end with the check-in day when that comes first', async () => {
      // Made 20 hours ago for yesterday; yesterday ended 10 hours ago
      request({ createdAt: ago(20 * HOUR), checkIn: new Date('2027-02-28T12:00:00Z'), checkOut: new Date('2027-03-02T12:00:00Z') })
      expect((await runExpiry()).results[0]).toMatchObject({ kind: 'UNANSWERED', action: 'expired' })
      // Made this morning for today: today has not ended
      Object.assign(booking(), { status: 'PENDING', cancelledBy: null, createdAt: ago(2 * HOUR), checkIn: new Date('2027-03-01T12:00:00Z') })
      expect((await runExpiry()).checked).toBe(0)
    })

    it('are never ended when made before BOOKING_EXPIRY_NOT_BEFORE', async () => {
      request({ createdAt: new Date('2026-12-31T23:00:00Z'), checkIn: new Date('2026-12-31T12:00:00Z') })
      expect((await runExpiry()).checked).toBe(0)
    })

    it('are not ended once accepted', async () => {
      request({ status: 'CONFIRMED', payBy: ahead(HOUR) })
      expect((await runExpiry()).checked).toBe(0)
    })
  })
})

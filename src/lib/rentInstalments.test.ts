import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Rent instalments end to end: the real route handlers and jobs, run against
// an in-memory stand-in for the database and a mocked fetch. No test may reach
// Paystack or a real database, and none sends a message: notify() is a spy.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  bookings: [] as Row[], instalments: [] as Row[], payments: [] as Row[], payouts: [] as Row[],
  refunds: [] as Row[], blockedDates: [] as Row[], users: [] as Row[], listings: [] as Row[],
  user: null as { id: string; role: string; email: string | null } | null, writes: 0,
}))
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(), captureMessage: vi.fn(),
  withMonitor: vi.fn((_name: string, fn: () => unknown) => fn()),
}))
const sendRefund = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => sentry)
vi.mock('@/lib/messaging/notify', () => ({ notify }))
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
        const c = cond as { in?: unknown[]; not?: unknown; lte?: Date | number; gte?: Date | number; lt?: Date | number; gt?: Date | number }
        const n = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number))
        if ('in' in c && !c.in!.includes(value)) return false
        if ('not' in c && value === c.not) return false
        if ('lte' in c && !(value !== null && n(value) <= n(c.lte))) return false
        if ('gte' in c && !(value !== null && n(value) >= n(c.gte))) return false
        if ('lt' in c && !(value !== null && n(value) < n(c.lt))) return false
        if ('gt' in c && !(value !== null && n(value) > n(c.gt))) return false
        return true
      }
      return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond
    })
  const apply = (row: Row, data: Row) => {
    for (const [key, v] of Object.entries(data)) {
      row[key] = v !== null && typeof v === 'object' && !(v instanceof Date) && 'increment' in v
        ? (row[key] as number) + (v as { increment: number }).increment : v
    }
  }
  const write = (rows: Row[], data: Row) => { rows.forEach((r) => apply(r, data)); state.writes += rows.length }

  const refundOf = (b: Row) => state.refunds.find((r) => r.bookingId === b.id) ?? null
  const openGuestDispute = (b: Row) => ((b.disputes as Row[]) ?? []).some((d) => d.raisedByRole === 'GUEST' && ['OPEN', 'UNDER_REVIEW'].includes(d.status as string))

  /** A booking filter, with the relation clauses the payout queries use. */
  const bookingMatches = (b: Row, where: Row = {}): boolean => {
    const { payouts, disputes, OR, ...rest } = where as { payouts?: unknown; disputes?: unknown; OR?: { refund?: { is: null | { reason: { in: string[] } } } }[] } & Row
    if (payouts && state.payouts.some((p) => p.bookingId === b.id)) return false
    if (disputes && openGuestDispute(b)) return false
    if (OR && OR.every((c) => 'refund' in c)) {
      const refund = refundOf(b)
      if (!OR.some((c) => (c.refund!.is === null ? !refund : !!refund && c.refund!.is.reason.in.includes(refund.reason as string)))) return false
    } else if (OR && !OR.some((c) => matches(b, c as Row))) return false
    return matches(b, rest)
  }
  const instalmentMatches = (i: Row, where: Row = {}): boolean => {
    const { booking, payouts, ...rest } = where as { booking?: Row; payouts?: unknown } & Row
    if (payouts && state.payouts.some((p) => p.instalmentId === i.id)) return false
    if (booking && !bookingMatches(state.bookings.find((b) => b.id === i.bookingId)!, booking)) return false
    return matches(i, rest)
  }

  const bySeq = (a: Row, b: Row) => (a.sequence as number) - (b.sequence as number)
  const hostOf = (b: Row) => ({ ...(state.users.find((u) => u.id === b.hostId) ?? { id: b.hostId }) })
  const bookingView = (b: Row, shape: Row = {}) => {
    const paymentsWhere = (shape.payments as { where?: Row } | undefined)?.where
    return {
      ...b,
      listing: { ...(state.listings.find((l) => l.id === b.listingId) ?? {}) },
      guest: { id: b.guestId, email: 'guest@example.test', name: 'Ama' },
      host: hostOf(b),
      payments: state.payments.filter((p) => p.bookingId === b.id && matches(p, paymentsWhere)).map((p) => ({ ...p })),
      refund: refundOf(b),
      // The payout code asks only for the guest's open disputes
      disputes: ((b.disputes as Row[]) ?? []).filter((d) => d.raisedByRole === 'GUEST' && ['OPEN', 'UNDER_REVIEW'].includes(d.status as string)),
      instalments: state.instalments.filter((i) => i.bookingId === b.id).sort(bySeq).map((i) => ({ ...i })),
    }
  }
  const instalmentView = (i: Row, shape: Row = {}) => {
    const paymentsWhere = (shape.payments as { where?: Row } | undefined)?.where
    return {
      ...i,
      payments: state.payments.filter((p) => p.instalmentId === i.id && matches(p, paymentsWhere)).map((p) => ({ ...p })),
      booking: bookingView(state.bookings.find((b) => b.id === i.bookingId)!),
    }
  }

  const db = {
    payment: {
      findUnique: async ({ where }: { where: Row }) => {
        await tick()
        const row = state.payments.find((p) => matches(p, where))
        if (!row) return null
        const instalment = state.instalments.find((i) => i.id === row.instalmentId)
        return { ...row, booking: bookingView(state.bookings.find((b) => b.id === row.bookingId)!), instalment: instalment ? { ...instalment } : null }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.payments.filter((p) => matches(p, where))
        write(rows, data)
        // A yield after the claim, so a second caller really can read the
        // instalment as still owed while the first is part way through
        await tick()
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
      findUnique: async ({ where, include, select }: { where: Row; include?: Row; select?: Row }) => {
        const row = state.bookings.find((b) => b.id === where.id)
        return row ? bookingView(row, include ?? select) : null
      },
      findFirst: async () => null,
      findMany: async ({ where, select }: { where: Row; select?: Row }) => {
        await tick()
        return state.bookings.filter((b) => bookingMatches(b, where)).map((b) => bookingView(b, select))
      },
      count: async ({ where }: { where: Row }) => state.bookings.filter((b) => bookingMatches(b, where)).length,
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
    instalment: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const d of data) {
          if (state.instalments.some((i) => i.bookingId === d.bookingId && i.sequence === d.sequence)) throw known('P2002')
          state.instalments.push({ id: `inst_${d.sequence}`, status: 'PENDING', paidAt: null, coveredFromDeposit: 0, coveredById: null, coveredAt: null, ...d })
        }
        state.writes += data.length
        return { count: data.length }
      },
      findUnique: async ({ where, include, select }: { where: Row; include?: Row; select?: Row }) => {
        const row = state.instalments.find((i) => i.id === where.id)
        return row ? instalmentView(row, include ?? select) : null
      },
      findMany: async ({ where, select, include }: { where: Row; select?: Row; include?: Row }) => {
        await tick()
        return state.instalments.filter((i) => instalmentMatches(i, where))
          .sort((a, b) => (a.dueDate as Date).getTime() - (b.dueDate as Date).getTime() || bySeq(a, b))
          .map((i) => instalmentView(i, include ?? select))
      },
      count: async ({ where }: { where: Row }) => state.instalments.filter((i) => instalmentMatches(i, where)).length,
      aggregate: async ({ where }: { where: Row }) => ({
        _sum: { coveredFromDeposit: state.instalments.filter((i) => matches(i, where)).reduce((s, i) => s + (i.coveredFromDeposit as number), 0) },
      }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.instalments.filter((i) => matches(i, where))
        write(rows, data)
        return { count: rows.length }
      },
    },
    payout: {
      findFirst: async ({ where }: { where: Row }) => {
        await tick()
        const row = state.payouts.find((p) => matches(p, where))
        return row ? { ...row } : null
      },
      findMany: async ({ where }: { where: Row }) => state.payouts.filter((p) => matches(p, where)).map((p) => ({ ...p })),
      create: async ({ data }: { data: Row }) => {
        await tick()
        // The real table has a unique index on (bookingId, instalmentSeq), and instalmentSeq is 0 unless set
        const seq = data.instalmentSeq ?? 0
        if (state.payouts.some((p) => p.bookingId === data.bookingId && p.instalmentSeq === seq)) throw known('P2002')
        const row = {
          id: `payout_${state.payouts.length + 1}`, retryCount: 0, lastFailedAt: null, alertedAt: null, paystackTransferCode: null,
          failureReason: null, initiatedAt: null, completedAt: null, createdAt: new Date(), instalmentId: null, ...data, instalmentSeq: seq,
        }
        state.payouts.push(row)
        state.writes++
        return { ...row }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.payouts.find((p) => p.id === where.id)!
        write([row], data)
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.payouts.filter((p) => matches(p, where))
        write(rows, data)
        return { count: rows.length }
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
    listing: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = state.listings.find((l) => l.id === where.id)
        return row ? { ...row, host: { id: row.hostId } } : null
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `listing_${state.listings.length + 1}`, moderationHold: false, ...data }
        state.listings.push(row)
        state.writes++
        return { ...row }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.listings.find((l) => l.id === where.id)!
        write([row], data)
        return { ...row }
      },
    },
    exchangeRate: { findFirst: async () => ({ usdToGhs: 15 }) },
    user: {
      findUnique: async ({ where }: { where: Row }) => state.users.find((u) => u.id === where.id) ?? null,
      findMany: async () => [],
    },
    notification: { createMany: async () => ({ count: 0 }) },
  }

  // One transaction at a time, and a thrown error puts everything back: what
  // row locks and a rollback give the real database
  let queue: Promise<unknown> = Promise.resolve()
  const tables = ['payments', 'bookings', 'instalments', 'refunds', 'blockedDates', 'payouts'] as const
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
import { runPayouts } from '@/lib/cronRuns'
import { initiateHostPayout } from '@/lib/payouts'
import { runRentReminders } from '@/lib/rentReminders'
import { coverFromDeposit } from '@/lib/depositCover'
import { payoutLimitPesewas, rentDepositCoverEnabled, rentRemindersEnabled } from '@/lib/payoutSwitches'
import { buildSchedule, RENT_AFTER_MOVE_IN, RENT_ALREADY_SETTLED, RENT_PAY_IN_ORDER } from '@/lib/rentRules'
import { hostShare } from '@/lib/disputes'
import { PLATFORM_COMMISSION } from '@/lib/utils'
import { POST as paystackWebhook } from '@/app/api/webhooks/paystack/route'
import { GET as verifyRoute } from '@/app/api/payments/verify/route'
import { POST as startPayment } from '@/app/api/payments/route'
import { POST as createBooking } from '@/app/api/bookings/route'
import { PATCH as updateBooking } from '@/app/api/bookings/[id]/route'
import { GET as previewCancel } from '@/app/api/bookings/[id]/cancellation/route'
import { POST as createListing } from '@/app/api/listings/route'
import { PATCH as editListing } from '@/app/api/listings/[id]/route'
import * as adminRent from '@/app/api/admin/rent/route'
import * as reminderCron from '@/app/api/cron/rent-reminders/route'

// ─── Helpers ────────────────────────────────────────────────────────────────

const SECRET = 'sk_test_rent'
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const fetchMock = vi.fn()
const day = (key: string) => new Date(`${key}T12:00:00.000Z`)
const at = (iso: string) => { vi.setSystemTime(new Date(iso)) }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const booking = () => state.bookings[0]
const inst = (seq: number) => state.instalments.find((i) => i.sequence === seq)!
const payment = (id: string) => state.payments.find((p) => p.id === id)!
const statuses = () => state.instalments.map((i) => i.status)
const notified = (event: string) => notify.mock.calls.filter(([e]) => e === event).map(([, ids]) => ids)
const sentryIssues = () => sentry.captureMessage.mock.calls.map(([, options]) => options.tags.payment_issue ?? options.tags.payout_failure)

/**
 * A one-year tenancy from 15 Jan 2027: $12,000 a year, $500 deposit, three
 * months up front. Booked on 2 Jan and confirmed. With `paid` (the default)
 * the first payment of $3,500 has been made, so nine payments of $1,000 follow
 * from 15 April.
 */
function tenancy({ paid = true, over = {}, advance = 3 as number | null }: { paid?: boolean; over?: Row; advance?: number | null } = {}) {
  state.bookings.push({
    id: 'booking_1', listingId: 'listing_1', guestId: 'guest_1', hostId: 'host_1',
    status: 'CONFIRMED', paymentStatus: paid ? 'PAID' : 'UNPAID', rentalMode: 'PERMANENT',
    checkIn: day('2027-01-15'), checkOut: day('2028-01-15'), nightsOrMonths: 1,
    pricePerUnit: 12_000, subtotal: 12_000, serviceFee: 0, damageDeposit: 500, totalPrice: 12_500,
    cancellationPolicy: 'MODERATE', payBy: new Date('2027-01-03T10:00:00Z'), createdAt: new Date('2027-01-02T10:00:00Z'),
    cancelledBy: null, cancelReason: null, cancelledAt: null, originalCheckOut: null, endedEarlyBy: null, endedEarlyAt: null,
    disputes: [],
    ...over,
  })
  for (const row of buildSchedule({ rentalMode: 'PERMANENT', checkIn: day('2027-01-15'), units: 1, subtotal: 12_000, damageDeposit: 500, advanceMonthsRequired: advance })) {
    state.instalments.push({
      id: `inst_${row.sequence}`, bookingId: 'booking_1', ...row,
      status: paid && row.sequence === 1 ? 'PAID' : 'PENDING', paidAt: paid && row.sequence === 1 ? new Date('2027-01-02T11:00:00Z') : null,
      coveredFromDeposit: 0, coveredById: null, coveredAt: null,
    })
  }
  if (paid) {
    state.payments.push({
      id: 'payment_first', bookingId: 'booking_1', instalmentId: 'inst_1', amount: 3500, currency: 'USD', method: 'CARD',
      amountPesewas: 5_250_000, usdToGhs: 15, gatewayReference: 'FIE-first', status: 'SUCCESS', createdAt: new Date('2027-01-02T11:00:00Z'),
    })
  }
}
/** Marks instalments 2..n paid, each on its due date. */
function paidThrough(n: number) {
  for (const i of state.instalments) if ((i.sequence as number) <= n && i.status !== 'PAID') Object.assign(i, { status: 'PAID', paidAt: i.dueDate })
}
/** A payment started on an instalment, as POST /api/payments would have left it. */
function started(seq: number, over: Row = {}) {
  const i = inst(seq)
  const amount = (i.amount as number) + (i.depositAmount as number) - (i.coveredFromDeposit as number)
  const row = {
    id: `payment_${state.payments.length + 1}`, bookingId: 'booking_1', instalmentId: i.id, amount, currency: 'USD', method: 'MOMO',
    amountPesewas: Math.round(amount * 15 * 100), usdToGhs: 15, gatewayReference: `FIE-rent-${seq}-${state.payments.length}`,
    status: 'PENDING', createdAt: new Date(), ...over,
  }
  state.payments.push(row)
  return row
}
const charge = (p: Row, over: Row = {}) => ({ reference: p.gatewayReference as string, status: 'success', amount: p.amountPesewas, currency: 'GHS', ...over })
/** What Paystack says when asked about any transaction. */
function paystackSays(status: string, over: Row = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    const reference = decodeURIComponent(String(url).split('/').pop()!)
    const p = state.payments.find((x) => x.gatewayReference === reference)
    return json({ status: true, data: { status, amount: p?.amountPesewas, currency: 'GHS', reference, ...over } })
  })
}

const as = (id: string, role: string) => { state.user = { id, role, email: `${id}@example.test` } }
const pay = (body: Row = {}) => startPayment(new Request('http://x/api/payments', { method: 'POST', body: JSON.stringify({ bookingId: 'booking_1', method: 'MOMO', ...body }) }))
const patch = (body: Row) => updateBooking(
  new Request('http://x/api/bookings/booking_1', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 'booking_1' }) },
)
const verify = (reference: string) => verifyRoute(new Request(`http://x/api/payments/verify?reference=${reference}`))
function webhook(data: Row) {
  const body = JSON.stringify({ event: 'charge.success', data })
  return paystackWebhook(new Request('http://x/api/webhooks/paystack', {
    method: 'POST', body, headers: { 'x-paystack-signature': crypto.createHmac('sha512', SECRET).update(body).digest('hex') },
  }))
}
const cover = (body: Row) => adminRent.POST(new Request('http://x/api/admin/rent', { method: 'POST', body: JSON.stringify({ action: 'cover', ...body }) }))
const cron = (query = '', secret: string | null = 'cron_secret', method: 'GET' | 'POST' = 'GET') => reminderCron[method](new Request(`http://x/api/cron/rent-reminders${query}`, {
  method, headers: secret ? { authorization: `Bearer ${secret}` } : {},
}))
const payoutsOn = () => { vi.stubEnv('PAYOUTS_ENABLED', 'true'); vi.stubEnv('PAYOUTS_NOT_BEFORE', '2027-01-01') }
/** Paystack accepts every transfer it is sent. */
const transfersWork = () => fetchMock.mockImplementation(async () => json({ status: true, data: { transfer_code: `TRF_${fetchMock.mock.calls.length}`, status: 'pending' } }))
const transfers = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/transfer'))

beforeEach(() => {
  for (const key of ['bookings', 'instalments', 'payments', 'payouts', 'refunds', 'blockedDates', 'users', 'listings'] as const) state[key].length = 0
  state.listings.push({
    id: 'listing_1', hostId: 'host_1', title: 'A home', cancellationPolicy: 'MODERATE', isActive: true, instantBook: true,
    rentalModes: '["TEMP_STAY","PERMANENT"]', priceNightly: null, priceMonthly: 950, priceAnnual: 12_000, minStayNights: 1,
    damageDeposit: 500, advanceMonthsRequired: 3, moderationHold: false,
  })
  state.users.push({ id: 'host_1', role: 'HOST', paystackRecipientCode: 'RCP_host', payoutMethodVerifiedAt: new Date('2026-12-01T00:00:00Z'), payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: '0240000000' })
  as('guest_1', 'GUEST')
  state.writes = 0
  sentry.captureMessage.mockReset()
  sentry.captureException.mockReset()
  sentry.withMonitor.mockClear()
  notify.mockReset()
  sendRefund.mockReset()
  sendRefund.mockResolvedValue({ sent: false, skipped: 'REFUNDS_ENABLED is not set to true' })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('PAYSTACK_SECRET_KEY', SECRET)
  vi.stubEnv('NEXTAUTH_URL', 'http://x')
  vi.stubEnv('CRON_SECRET', 'cron_secret')
  vi.stubEnv('PAYMENT_WEBHOOK_ENABLED', 'true')
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2027-01-02T10:00:00Z')
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

// ─── Making the booking ─────────────────────────────────────────────────────

describe('booking a long stay', () => {
  const book = (body: Row) => createBooking(new Request('http://x/api/bookings', { method: 'POST', body: JSON.stringify({ listingId: 'listing_1', ...body }) }))

  it('writes the whole schedule with the booking, from the listing and not the request', async () => {
    const res = await book({ rentalMode: 'PERMANENT', checkIn: '2027-01-15', checkOut: '2028-01-15', advanceMonths: 1, advanceMonthsRequired: 1, instalments: [] })
    expect(res.status).toBe(201)
    expect(booking()).toMatchObject({ subtotal: 12_000, serviceFee: 0, damageDeposit: 500, totalPrice: 12_500, paymentStatus: 'UNPAID' })
    // Three months up front, as the listing says, whatever the request carried
    expect(state.instalments).toHaveLength(10)
    expect(inst(1)).toMatchObject({ bookingId: 'booking_1', amount: 3000, depositAmount: 500, status: 'PENDING' })
    expect(inst(2)).toMatchObject({ amount: 1000, depositAmount: 0, dueDate: day('2027-04-15') })
    expect(state.instalments.reduce((s, i) => s + (i.amount as number), 0)).toBe(12_000)
  })

  it('holds a listing to six months even if a larger number is stored on it', async () => {
    state.listings[0].advanceMonthsRequired = 12
    await book({ rentalMode: 'PERMANENT', checkIn: '2027-01-15', checkOut: '2028-01-15' })
    expect(inst(1).amount).toBe(6000)
    expect(state.instalments).toHaveLength(7)
  })

  it('uses three months when the listing has not chosen', async () => {
    state.listings[0].advanceMonthsRequired = null
    await book({ rentalMode: 'PERMANENT', checkIn: '2027-01-15', checkOut: '2028-01-15' })
    expect(inst(1).amount).toBe(3000)
  })

  it('asks a monthly booking for one month up front, whatever the listing says', async () => {
    state.listings[0].advanceMonthsRequired = 6
    await book({ rentalMode: 'TEMP_STAY', checkIn: '2027-01-15', checkOut: '2027-05-15' })
    expect(state.instalments.map((i) => [i.sequence, i.amount, i.depositAmount])).toEqual([[1, 950, 500], [2, 950, 0], [3, 950, 0], [4, 950, 0]])
  })

  it('writes no instalments for a short stay', async () => {
    Object.assign(state.listings[0], { rentalModes: '["SHORT_STAY"]', priceNightly: 100 })
    const res = await book({ rentalMode: 'SHORT_STAY', checkIn: '2027-01-15', checkOut: '2027-01-18' })
    expect(res.status).toBe(201)
    expect(state.instalments).toHaveLength(0)
  })
})

describe('the advance a host sets', () => {
  const listingBody = { title: 'A home', region: 'Greater Accra', city: 'Accra', propertyType: 'Apartment', bedrooms: 2, rentalModes: ['PERMANENT'], priceAnnual: 12_000 }
  const create = (advanceMonthsRequired: unknown) => createListing(new Request('http://x/api/listings', { method: 'POST', body: JSON.stringify({ ...listingBody, advanceMonthsRequired }) }))
  const edit = (advanceMonthsRequired: unknown) => editListing(
    new Request('http://x/api/listings/listing_1', { method: 'PATCH', body: JSON.stringify({ advanceMonthsRequired }) }),
    { params: Promise.resolve({ id: 'listing_1' }) },
  )
  beforeEach(() => as('host_1', 'HOST'))

  it('is refused on the server outside 1 to 6, on a new listing and on an edit, and nothing is written', async () => {
    for (const bad of [0, 7, 12, '12', -1, 2.5, 'six']) {
      expect((await create(bad)).status, `create ${bad}`).toBe(400)
      expect((await edit(bad)).status, `edit ${bad}`).toBe(400)
    }
    expect(state.writes).toBe(0)
    expect(state.listings).toHaveLength(1)
    expect(state.listings[0].advanceMonthsRequired).toBe(3)
  })

  it('is stored as a number from 1 to 6, or as nothing for the default', async () => {
    expect((await create('6')).status).toBe(201)
    expect(state.listings[1].advanceMonthsRequired).toBe(6)
    expect((await edit(1)).status).toBe(200)
    expect(state.listings[0].advanceMonthsRequired).toBe(1)
    expect((await edit('')).status).toBe(200)
    expect(state.listings[0].advanceMonthsRequired).toBeNull()
  })
})

// ─── Paying ─────────────────────────────────────────────────────────────────

describe('the first payment', () => {
  it('charges the advance and the deposit, not the whole tenancy, and no service fee', async () => {
    tenancy({ paid: false, over: { payBy: new Date('2027-01-03T10:00:00Z') } })
    fetchMock.mockResolvedValue(json({ status: true, data: { authorization_url: 'https://paystack.test/pay', reference: 'r' } }))
    const res = await pay()
    expect(res.status).toBe(200)
    expect(state.payments[0]).toMatchObject({ instalmentId: 'inst_1', amount: 3500, amountPesewas: 5_250_000, status: 'PENDING' })
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.amount).toBe(5_250_000)
  })

  it('confirms the booking and marks the first instalment paid, in one step', async () => {
    tenancy({ paid: false })
    const p = started(1)
    const result = await settlePayment(charge(p))
    expect(result).toMatchObject({ outcome: 'confirmed', changed: true })
    expect(booking().paymentStatus).toBe('PAID')
    expect(inst(1)).toMatchObject({ status: 'PAID' })
    expect(inst(1).paidAt).toBeInstanceOf(Date)
    expect(statuses().slice(1).every((s) => s === 'PENDING')).toBe(true)
    expect(notified('booking.confirmed')).toEqual([{ bookingId: 'booking_1' }])
    expect(notified('rent.paid')).toEqual([])
  })

  it('is refunded in full, and confirms nothing, when the booking was cancelled first', async () => {
    tenancy({ paid: false, over: { status: 'CANCELLED' } })
    for (const i of state.instalments) i.status = 'CANCELLED'
    const p = started(1)
    expect((await settlePayment(charge(p))).outcome).toBe('refunded')
    expect(state.refunds[0]).toMatchObject({ reason: 'LATE_PAYMENT', amount: 3500, stayRefund: 3000, depositRefund: 500, serviceFeeRefund: 0 })
    expect(inst(1).status).toBe('CANCELLED')
  })
})

describe('starting a later rent payment', () => {
  beforeEach(() => {
    tenancy()
    fetchMock.mockResolvedValue(json({ status: true, data: { authorization_url: 'https://paystack.test/pay', reference: 'r' } }))
  })

  it('is refused before the move-in day, before anything is written or sent', async () => {
    at('2027-01-14T23:59:00Z')
    const res = await pay({ instalmentId: 'inst_2' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(RENT_AFTER_MOVE_IN)
    expect(state.payments).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is allowed from the move-in day, for exactly the instalment and at the stored amount', async () => {
    at('2027-01-15T00:05:00Z')
    const res = await pay({ instalmentId: 'inst_2', amount: 1, amountUsd: 1 })
    expect(res.status).toBe(200)
    expect(state.payments[1]).toMatchObject({ instalmentId: 'inst_2', amount: 1000, amountPesewas: 1_500_000 })
    // The booking's own reference, from its first payment, is left alone
    expect(booking().paymentReference).toBeUndefined()
  })

  it('takes the next one owed when none is named', async () => {
    at('2027-02-01T09:00:00Z')
    expect((await pay()).status).toBe(200)
    expect(state.payments[1].instalmentId).toBe('inst_2')
  })

  it('refuses to skip ahead: one at a time, in order', async () => {
    at('2027-02-01T09:00:00Z')
    const res = await pay({ instalmentId: 'inst_3' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(RENT_PAY_IN_ORDER)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses one already paid, one that is another booking\'s, and a tenancy that is cancelled', async () => {
    at('2027-02-01T09:00:00Z')
    paidThrough(2)
    expect((await (await pay({ instalmentId: 'inst_2' })).json()).error).toBe(RENT_ALREADY_SETTLED)
    expect((await pay({ instalmentId: 'inst_of_someone_else' })).status).toBe(404)
    booking().status = 'CANCELLED'
    expect((await pay({ instalmentId: 'inst_3' })).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is only for the guest on the booking', async () => {
    at('2027-02-01T09:00:00Z')
    as('someone_else', 'GUEST')
    expect((await pay({ instalmentId: 'inst_2' })).status).toBe(403)
    as('host_1', 'HOST')
    expect((await pay({ instalmentId: 'inst_2' })).status).toBe(403)
    state.user = null
    expect((await pay({ instalmentId: 'inst_2' })).status).toBe(401)
  })

  it('charges only what is still owed on one part covered from the deposit', async () => {
    at('2027-04-20T09:00:00Z')
    Object.assign(inst(2), { status: 'PART_COVERED', coveredFromDeposit: 500 })
    expect((await pay({ instalmentId: 'inst_2' })).status).toBe(200)
    expect(state.payments[1]).toMatchObject({ amount: 500, amountPesewas: 750_000 })
  })

  it('refuses an instalment on a booking that has none', async () => {
    state.instalments.length = 0
    Object.assign(booking(), { paymentStatus: 'UNPAID', payBy: null })
    expect((await pay({ instalmentId: 'inst_2' })).status).toBe(400)
  })
})

describe('settling a later rent payment', () => {
  beforeEach(() => { tenancy(); at('2027-04-15T09:00:00Z') })

  it('marks that instalment paid and leaves the booking and the others as they were', async () => {
    const p = started(2)
    const result = await settlePayment(charge(p))
    expect(result).toMatchObject({ outcome: 'confirmed', changed: true, paymentId: p.id })
    expect(inst(2)).toMatchObject({ status: 'PAID', paidAt: new Date('2027-04-15T09:00:00Z') })
    expect(payment(p.id).status).toBe('SUCCESS')
    expect(booking()).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    expect(statuses()).toEqual(['PAID', 'PAID', ...Array(8).fill('PENDING')])
    expect(notified('rent.paid')).toEqual([{ instalmentId: 'inst_2' }])
    expect(notified('booking.confirmed')).toEqual([])
    expect(state.refunds).toHaveLength(0)
  })

  it('changes nothing the second time, from any caller', async () => {
    const p = started(2)
    await settlePayment(charge(p))
    const writes = state.writes
    expect(await settlePayment(charge(p))).toMatchObject({ outcome: 'confirmed', changed: false })
    expect((await webhook({ reference: p.gatewayReference, status: 'success', amount: p.amountPesewas, currency: 'GHS' })).status).toBe(200)
    expect(state.writes).toBe(writes)
    expect(notified('rent.paid')).toHaveLength(1)
  })

  it('is settled once when the browser and the webhook arrive together', async () => {
    const p = started(2)
    paystackSays('success')
    const [back, hook] = await Promise.all([
      verify(p.gatewayReference as string),
      webhook({ reference: p.gatewayReference, status: 'success', amount: p.amountPesewas, currency: 'GHS' }),
    ])
    expect(hook.status).toBe(200)
    // Back to that instalment's own page
    const landed = new URL(back.headers.get('location')!)
    expect(landed.pathname).toBe('/checkout/booking_1')
    expect(landed.searchParams.get('instalment')).toBe('inst_2')
    expect(landed.searchParams.get('payment')).toBe('success')
    expect(inst(2).status).toBe('PAID')
    expect(notified('rent.paid')).toHaveLength(1)
    expect(state.payments.filter((x) => x.status === 'SUCCESS')).toHaveLength(2)
  })

  it('refuses money that is not the amount or the currency asked for', async () => {
    const p = started(2)
    expect((await settlePayment(charge(p, { amount: 1_499_999 }))).outcome).toBe('mismatch')
    expect(payment(p.id).status).toBe('MISMATCH')
    expect(inst(2).status).toBe('PENDING')
    expect(sentryIssues()).toEqual(['MISMATCH'])
    const q = started(2)
    expect((await settlePayment(charge(q, { currency: 'USD' }))).outcome).toBe('mismatch')
    expect(inst(2).status).toBe('PENDING')
  })

  it('records a second payment on the same instalment as a duplicate, for a person to refund', async () => {
    const first = started(2)
    const second = started(2)
    await settlePayment(charge(first))
    expect((await settlePayment(charge(second))).outcome).toBe('duplicate')
    expect(payment(second.id as string).status).toBe('DUPLICATE')
    expect(sentryIssues()).toEqual(['DUPLICATE'])
    expect(notified('rent.paid')).toHaveLength(1)
  })

  it('pays one instalment once when two payments on it succeed at the same moment', async () => {
    const first = started(2)
    const second = started(2)
    const results = await Promise.all([settlePayment(charge(first)), settlePayment(charge(second))])
    expect(results.map((r) => r.outcome).sort()).toEqual(['confirmed', 'duplicate'])
    expect(inst(2).status).toBe('PAID')
  })

  it('leaves a failed or unfinished payment unpaid', async () => {
    const p = started(2)
    expect((await settlePayment(charge(p, { status: 'ongoing' }))).outcome).toBe('pending')
    expect((await settlePayment(charge(p, { status: 'failed' }))).outcome).toBe('failed')
    expect(inst(2).status).toBe('PENDING')
    // Success still wins if Paystack later says it went through
    expect((await settlePayment(charge(p))).outcome).toBe('confirmed')
    expect(inst(2).status).toBe('PAID')
  })

  it('refunds rent that arrives after the tenancy was ended, and does not bring the month back', async () => {
    const p = started(2)
    inst(2).status = 'CANCELLED'
    const result = await settlePayment(charge(p))
    expect(result.outcome).toBe('refunded')
    expect(state.refunds[0]).toMatchObject({ reason: 'LATE_PAYMENT', paymentId: p.id, amount: 1000, stayRefund: 1000, depositRefund: 0, serviceFeeRefund: 0 })
    expect(inst(2).status).toBe('CANCELLED')
    // The booking was paid for and lived in: its own payment status is untouched
    expect(booking().paymentStatus).toBe('PAID')
    expect(sendRefund).toHaveBeenCalledWith('refund_1')
    expect(notified('payment.late_refund')).toEqual([{ bookingId: 'booking_1' }])
  })

  it('refunds rent that arrives on a cancelled booking', async () => {
    const p = started(2)
    booking().status = 'CANCELLED'
    expect((await settlePayment(charge(p))).outcome).toBe('refunded')
    expect(inst(2).status).toBe('PENDING')
  })

  it('hands a second refund on the same booking to a person', async () => {
    state.refunds.push({ id: 'refund_0', bookingId: 'booking_1', paymentId: 'payment_first', reason: 'DISPUTE_PARTIAL', amount: 100 })
    const p = started(2)
    inst(2).status = 'CANCELLED'
    expect((await settlePayment(charge(p))).outcome).toBe('duplicate')
    expect(payment(p.id as string).status).toBe('DUPLICATE')
    expect(state.refunds).toHaveLength(1)
    expect(sentryIssues()).toEqual(['DUPLICATE'])
  })

  it('settles the shortfall on one part covered from the deposit', async () => {
    Object.assign(inst(2), { status: 'PART_COVERED', coveredFromDeposit: 500 })
    const p = started(2)
    expect(p.amount).toBe(500)
    expect((await settlePayment(charge(p))).outcome).toBe('confirmed')
    expect(inst(2)).toMatchObject({ status: 'PAID', coveredFromDeposit: 500 })
  })

  it('reports and writes nothing on a dry run', async () => {
    const p = started(2)
    const writes = state.writes
    expect(await settlePayment(charge(p), { dryRun: true })).toMatchObject({ outcome: 'confirmed', changed: false, dryRun: true })
    expect(state.writes).toBe(writes)
    expect(inst(2).status).toBe('PENDING')
  })
})

// ─── Cancelling, expiry, ending early ───────────────────────────────────────

describe('cancelling before move-in', () => {
  const preview = async () => (await (await previewCancel(new Request('http://x'), { params: Promise.resolve({ id: 'booking_1' }) })).json()).preview

  it('refunds from the first payment, never the rent for the whole tenancy', async () => {
    tenancy()
    at('2027-01-03T09:00:00Z')   // 12 days before move-in: Moderate, long-term gives nothing back of the rent, capped at a month kept
    const p = await preview()
    expect(p.canCancel).toBe(true)
    // One month's rent is the most that is kept: $2,000 of the $3,000 comes back, with the deposit
    expect(p.quote).toMatchObject({ stayRefund: 2000, depositRefund: 500, total: 2500, kept: 1000 })
    expect(p.paidAmount).toBe(3500)
  })

  it('cancels every instalment still owed and records one refund against the first payment', async () => {
    tenancy()
    at('2027-01-03T09:00:00Z')
    const res = await patch({ action: 'cancel', expectedRefund: 2500 })
    expect(res.status).toBe(200)
    expect(booking().status).toBe('CANCELLED')
    expect(statuses()).toEqual(['PAID', ...Array(9).fill('CANCELLED')])
    expect(state.refunds).toHaveLength(1)
    expect(state.refunds[0]).toMatchObject({ paymentId: 'payment_first', reason: 'GUEST_CANCELLED', amount: 2500, stayRefund: 2000, depositRefund: 500 })
  })

  it('gives everything in the first payment back when the host cancels', async () => {
    tenancy()
    at('2027-01-03T09:00:00Z')
    as('host_1', 'HOST')
    const res = await patch({ action: 'host-cancel', reason: 'EMERGENCY', expectedRefund: 3500 })
    expect(res.status).toBe(200)
    expect(state.refunds[0]).toMatchObject({ reason: 'HOST_CANCELLED', amount: 3500, stayRefund: 3000, depositRefund: 500 })
    expect(statuses().slice(1).every((s) => s === 'CANCELLED')).toBe(true)
  })

  it('cannot be done online once the tenant has moved in, and nothing is refunded', async () => {
    tenancy()
    at('2027-03-01T09:00:00Z')
    const res = await patch({ action: 'cancel', expectedRefund: 0 })
    expect(res.status).toBe(409)
    expect(state.refunds).toHaveLength(0)
    expect(booking().status).toBe('CONFIRMED')
    expect(statuses().slice(1).every((s) => s === 'PENDING')).toBe(true)
  })
})

describe('an unpaid long stay that expires', () => {
  it('ends with its instalments no longer owed', async () => {
    vi.stubEnv('BOOKING_EXPIRY_ENABLED', 'true')
    vi.stubEnv('BOOKING_EXPIRY_NOT_BEFORE', '2027-01-01')
    tenancy({ paid: false, over: { payBy: new Date('2027-01-02T11:00:00Z') } })
    at('2027-01-02T12:00:00Z')
    const run = await runExpiry()
    expect(run.results).toMatchObject([{ bookingId: 'booking_1', action: 'expired' }])
    expect(booking()).toMatchObject({ status: 'CANCELLED', cancelledBy: 'SYSTEM' })
    expect(statuses().every((s) => s === 'CANCELLED')).toBe(true)
  })
})

describe('ending a tenancy early', () => {
  beforeEach(() => {
    tenancy()
    paidThrough(3)            // paid to 15 June
    at('2027-06-20T09:00:00Z')
    as('host_1', 'HOST')
    // The nights an instant booking blocked, and one of the host's own after the new end
    for (let t = day('2027-01-15').getTime(); t < day('2028-01-15').getTime(); t += DAY) state.blockedDates.push({ listingId: 'listing_1', date: new Date(t), reason: 'BOOKED' })
    state.blockedDates.push({ listingId: 'listing_1', date: day('2027-08-01'), reason: 'HOST' })
  })

  it('shows the end date first and changes nothing', async () => {
    const writes = state.writes
    const res = await patch({ action: 'end-tenancy', preview: true })
    expect(await res.json()).toEqual({ preview: { endsOn: '2027-06-15' } })
    expect(state.writes).toBe(writes)
    expect(booking().endedEarlyAt).toBeNull()
  })

  it('ends at the end of the last month paid for, keeps the agreed date, and refunds nothing', async () => {
    const res = await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })
    expect(res.status).toBe(200)
    expect(booking()).toMatchObject({
      status: 'CONFIRMED', paymentStatus: 'PAID', checkOut: day('2027-06-15'), originalCheckOut: day('2028-01-15'), endedEarlyBy: 'HOST',
    })
    expect(booking().endedEarlyAt).toBeInstanceOf(Date)
    // The months paid for stay paid; the rest are no longer owed
    expect(statuses()).toEqual(['PAID', 'PAID', 'PAID', ...Array(7).fill('CANCELLED')])
    expect(state.refunds).toHaveLength(0)
    expect(sendRefund).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(notified('tenancy.ended_early')).toEqual([{ bookingId: 'booking_1' }])
  })

  it('opens the nights after the new end and keeps the host\'s own blocks', async () => {
    await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })
    const booked = state.blockedDates.filter((d) => d.reason === 'BOOKED').map((d) => (d.date as Date).getTime())
    expect(Math.max(...booked)).toBe(day('2027-06-14').getTime())
    expect(Math.min(...booked)).toBe(day('2027-01-15').getTime())
    expect(state.blockedDates.filter((d) => d.reason === 'HOST')).toHaveLength(1)
  })

  it('is refused if the date the host was shown is no longer the date it would end', async () => {
    const res = await patch({ action: 'end-tenancy', expectedEnd: '2027-05-15' })
    expect(res.status).toBe(409)
    expect((await res.json()).preview).toEqual({ endsOn: '2027-06-15' })
    expect(booking().endedEarlyAt).toBeNull()
    expect((await patch({ action: 'end-tenancy' })).status).toBe(409)
  })

  it('can be done by an admin, and says so', async () => {
    as('admin_1', 'ADMIN')
    expect((await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })).status).toBe(200)
    expect(booking().endedEarlyBy).toBe('ADMIN')
  })

  it('cannot be done by the tenant, another host, or anyone signed out', async () => {
    for (const [id, role] of [['guest_1', 'GUEST'], ['host_2', 'HOST'], ['someone', 'GUEST']] as const) {
      as(id, role)
      expect((await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })).status, `${id}`).toBe(403)
    }
    // The host's own account, once it is no longer a host
    as('host_1', 'GUEST')
    expect((await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })).status).toBe(403)
    state.user = null
    expect((await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })).status).toBe(401)
    expect(booking().endedEarlyAt).toBeNull()
    expect(statuses().slice(3).every((s) => s === 'PENDING')).toBe(true)
  })

  it('cannot be done twice, or before move-in, or on a stay with no instalments', async () => {
    expect((await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })).status).toBe(200)
    expect((await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })).status).toBe(409)
    Object.assign(booking(), { endedEarlyAt: null, checkOut: day('2028-01-15') })
    at('2027-01-10T09:00:00Z')
    expect((await patch({ action: 'end-tenancy', preview: true })).status).toBe(409)
    state.instalments.length = 0
    at('2027-06-20T09:00:00Z')
    expect((await patch({ action: 'end-tenancy', preview: true })).status).toBe(409)
  })

  it('ends once when the host clicks twice at the same moment', async () => {
    const results = await Promise.all([patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' }), patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(notified('tenancy.ended_early')).toHaveLength(1)
  })

  it('no longer accepts rent for the months that were cut, and no longer reminds about them', async () => {
    await patch({ action: 'end-tenancy', expectedEnd: '2027-06-15' })
    as('guest_1', 'GUEST')
    fetchMock.mockResolvedValue(json({ status: true, data: { authorization_url: 'u', reference: 'r' } }))
    expect((await pay({ instalmentId: 'inst_4' })).status).toBe(409)
    vi.stubEnv('RENT_REMINDERS_ENABLED', 'true')
    expect((await runRentReminders()).results).toEqual([])
  })
})

// ─── Payouts ────────────────────────────────────────────────────────────────

describe('paying the host for rent', () => {
  beforeEach(() => { tenancy(); payoutsOn(); transfersWork() })
  const paid = (run: Awaited<ReturnType<typeof runPayouts>>) => run.results.filter((r) => r.action === 'paid').map((r) => [r.instalmentSeq, r.amount])

  it('takes the commission from the rent through hostShare, and never pays out the deposit', async () => {
    at('2027-01-17T13:00:00Z')
    const run = await runPayouts()
    expect(paid(run)).toEqual([[1, hostShare(3000)]])
    expect(run.results[0].amount).toBeCloseTo(3000 * (1 - PLATFORM_COMMISSION), 6)
    expect(state.payouts[0]).toMatchObject({ bookingId: 'booking_1', instalmentId: 'inst_1', instalmentSeq: 1, status: 'PROCESSING' })
    // $2,700 at 15 cedis: the deposit of $500 is not in it
    expect(JSON.parse(transfers()[0][1].body).amount).toBe(4_050_000)
  })

  it('sends the first payout 48 hours after move-in and not a minute before, however early the rent was paid', async () => {
    at('2027-01-17T11:59:00Z')
    expect((await runPayouts()).results).toEqual([])
    at('2027-01-17T12:00:00Z')
    expect(paid(await runPayouts())).toEqual([[1, 2700]])
  })

  it('holds a later month paid early until the day it falls due', async () => {
    Object.assign(inst(2), { status: 'PAID', paidAt: new Date('2027-01-20T09:00:00Z') })
    at('2027-04-15T11:00:00Z')
    expect(paid(await runPayouts())).toEqual([[1, 2700]])
    at('2027-04-15T12:00:00Z')
    expect(paid(await runPayouts())).toEqual([[2, 900]])
  })

  it('sends a later month paid late on the day it was paid', async () => {
    state.payouts.push({ id: 'payout_0', bookingId: 'booking_1', hostId: 'host_1', instalmentId: 'inst_1', instalmentSeq: 1, status: 'COMPLETED', amount: 2700, paystackTransferCode: 'TRF_0' })
    at('2027-04-22T16:00:00Z')
    expect((await runPayouts()).results).toEqual([])       // still unpaid: nothing to pay out
    Object.assign(inst(2), { status: 'PAID', paidAt: new Date('2027-04-22T16:30:00Z') })
    at('2027-04-22T17:00:00Z')
    expect(paid(await runPayouts())).toEqual([[2, 900]])
  })

  it('never pays for rent that has not been paid or covered in full', async () => {
    Object.assign(inst(2), { status: 'PART_COVERED', coveredFromDeposit: 500 })
    at('2027-06-01T12:00:00Z')
    expect(paid(await runPayouts())).toEqual([[1, 2700]])
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 900, instalmentId: 'inst_2' })).rejects.toThrow(/not settled/)
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 900, instalmentId: 'inst_3' })).rejects.toThrow(/not settled/)
    expect(state.payouts).toHaveLength(1)
  })

  it('pays for a month covered in full from the deposit', async () => {
    Object.assign(inst(2), { status: 'COVERED', coveredFromDeposit: 1000, paidAt: new Date('2027-04-20T09:00:00Z') })
    at('2027-04-20T10:00:00Z')
    expect(paid(await runPayouts())).toEqual([[1, 2700], [2, 900]])
  })

  it('makes one payout per instalment, however many runs overlap', async () => {
    paidThrough(3)
    at('2027-06-01T12:00:00Z')
    const runs = await Promise.all([runPayouts(), runPayouts(), runPayouts()])
    expect(state.payouts.map((p) => p.instalmentSeq).sort()).toEqual([1, 2, 3])
    expect(transfers()).toHaveLength(3)
    expect(runs.flatMap((r) => r.results).every((r) => r.action === 'paid')).toBe(true)
    // And nothing more on the next run
    expect((await runPayouts()).results).toEqual([])
    expect(transfers()).toHaveLength(3)
  })

  it('refuses more than the host\'s share of that instalment', async () => {
    at('2027-01-17T13:00:00Z')
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 3000, instalmentId: 'inst_1' })).rejects.toThrow(/more than the host's share/)
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 900, instalmentId: 'inst_of_another_booking' })).rejects.toThrow(/not found on booking/)
    expect(transfers()).toHaveLength(0)
  })

  it('is a dry run, with no writes and no calls, until payouts are switched on', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('PAYSTACK_SECRET_KEY', SECRET)
    at('2027-01-17T13:00:00Z')
    const off = await runPayouts()
    expect(off).toMatchObject({ mode: 'dry-run', reason: 'PAYOUTS_ENABLED is not set to true' })
    expect(off.results).toMatchObject([{ action: 'would-pay', instalmentSeq: 1, amount: 2700 }])
    vi.stubEnv('PAYOUTS_ENABLED', 'true')
    expect(await runPayouts()).toMatchObject({ mode: 'dry-run', reason: 'PAYOUTS_NOT_BEFORE is not set to a date (YYYY-MM-DD)' })
    vi.stubEnv('PAYOUTS_NOT_BEFORE', '2027-01-01')
    expect((await runPayouts({ dryRun: true })).results).toMatchObject([{ action: 'would-pay' }])
    expect(state.writes).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect((async () => { vi.stubEnv('PAYOUTS_ENABLED', 'TRUE'); return initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 2700, instalmentId: 'inst_1' }) })()).rejects.toThrow(/switched off/)
  })

  it('never pays a tenancy booked before PAYOUTS_NOT_BEFORE', async () => {
    vi.stubEnv('PAYOUTS_NOT_BEFORE', '2027-01-03')
    at('2027-01-17T13:00:00Z')
    expect((await runPayouts()).results).toEqual([])
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 2700, instalmentId: 'inst_1' })).rejects.toThrow(/PAYOUTS_NOT_BEFORE/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits while a guest\'s dispute is open, on a cancelled tenancy, or after a full refund', async () => {
    at('2027-01-17T13:00:00Z')
    booking().disputes = [{ raisedByRole: 'GUEST', status: 'OPEN' }]
    expect((await runPayouts()).results).toEqual([])
    booking().disputes = []
    state.refunds.push({ id: 'refund_1', bookingId: 'booking_1', reason: 'DISPUTE_FULL', stayRefund: 3000 })
    expect((await runPayouts()).results).toEqual([])
    state.refunds.length = 0
    booking().status = 'CANCELLED'
    expect((await runPayouts()).results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('takes a dispute\'s part refund off the first payout only', async () => {
    paidThrough(2)
    state.refunds.push({ id: 'refund_1', bookingId: 'booking_1', reason: 'DISPUTE_PARTIAL', stayRefund: 600 })
    at('2027-04-16T12:00:00Z')
    expect(paid(await runPayouts())).toEqual([[1, hostShare(3000, 600)], [2, hostShare(1000)]])
  })

  it('waits for a host with no payout method, and says so once per instalment', async () => {
    Object.assign(state.users[0], { paystackRecipientCode: null, payoutMethodVerifiedAt: null })
    at('2027-01-17T13:00:00Z')
    expect((await runPayouts()).results).toMatchObject([{ action: 'waiting-for-payout-method', instalmentSeq: 1 }])
    expect(notified('payout.waiting')).toEqual([{ bookingId: 'booking_1', instalmentId: 'inst_1' }])
    expect(state.payouts).toHaveLength(0)
  })

  it('still allows only one payout for a stay paid in one go', async () => {
    state.instalments.length = 0
    Object.assign(booking(), { rentalMode: 'SHORT_STAY', subtotal: 300, checkIn: day('2027-01-15'), checkOut: day('2027-01-18') })
    at('2027-01-17T13:00:00Z')
    await Promise.all([runPayouts(), runPayouts()])
    expect(state.payouts).toHaveLength(1)
    expect(state.payouts[0]).toMatchObject({ instalmentSeq: 0, instalmentId: null })
    expect(transfers()).toHaveLength(1)
    expect((await runPayouts()).results).toEqual([])
  })

  describe('over the transfer limit', () => {
    it('is held, alerted once and never sent, split or retried', async () => {
      vi.stubEnv('PAYOUT_LIMIT_GHS', '40000')   // the payout is 40,500 cedis
      at('2027-01-17T13:00:00Z')
      const run = await runPayouts()
      expect(run.results).toMatchObject([{ action: 'failed', instalmentSeq: 1, status: 'HELD' }])
      expect(state.payouts).toHaveLength(1)
      expect(state.payouts[0]).toMatchObject({ status: 'HELD', amount: 2700, paystackTransferCode: null })
      expect(state.payouts[0].failureReason).toMatch(/Over the transfer limit/)
      expect(transfers()).toHaveLength(0)
      expect(sentryIssues()).toEqual(['OVER_LIMIT'])
      expect(notified('payout.held')).toEqual([{ payoutId: 'payout_1' }])

      // Every later run leaves it exactly as it is
      at('2027-01-18T13:00:00Z')
      const again = await runPayouts()
      expect(again.results).toEqual([])
      expect(again.resumed).toEqual([])
      expect(again.retried).toEqual([])
      expect(state.payouts).toHaveLength(1)
      expect(transfers()).toHaveLength(0)
      expect(sentryIssues()).toEqual(['OVER_LIMIT'])
      expect(notified('payout.held')).toHaveLength(1)
      expect((await initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 2700, instalmentId: 'inst_1' })).ok).toBe(false)
      expect(transfers()).toHaveLength(0)
    })

    it('is sent when it is exactly the limit', async () => {
      vi.stubEnv('PAYOUT_LIMIT_GHS', '40500')
      at('2027-01-17T13:00:00Z')
      expect(paid(await runPayouts())).toEqual([[1, 2700]])
      expect(transfers()).toHaveLength(1)
    })

    it('holds nothing while no limit is set, or the setting is not a number', () => {
      expect(payoutLimitPesewas()).toBeNull()
      for (const bad of ['', '0', '-5', 'abc', '40,000', '4e4', 'true']) {
        vi.stubEnv('PAYOUT_LIMIT_GHS', bad)
        expect(payoutLimitPesewas(), bad).toBeNull()
      }
      vi.stubEnv('PAYOUT_LIMIT_GHS', ' 40000.50 ')
      expect(payoutLimitPesewas()).toBe(4_000_050)
    })
  })
})

// ─── Reminders ──────────────────────────────────────────────────────────────

describe('rent reminders', () => {
  beforeEach(() => tenancy())
  const on = () => vi.stubEnv('RENT_REMINDERS_ENABLED', 'true')
  const kinds = (run: Awaited<ReturnType<typeof runRentReminders>>) => run.results.map((r) => [r.sequence, r.kind, r.action])

  it('is off unless the switch is exactly "true"', () => {
    for (const value of [undefined, '', '1', 'TRUE', 'True', 'yes', 'true ']) {
      if (value === undefined) vi.unstubAllEnvs(); else vi.stubEnv('RENT_REMINDERS_ENABLED', value)
      expect(rentRemindersEnabled(), String(value)).toBe(false)
    }
    vi.stubEnv('RENT_REMINDERS_ENABLED', 'true')
    expect(rentRemindersEnabled()).toBe(true)
  })

  it('only reports while switched off: nothing written, nothing sent, Paystack never asked', async () => {
    started(2)
    at('2027-04-20T08:00:00Z')
    const run = await runRentReminders()
    expect(run).toMatchObject({ mode: 'dry-run', reason: 'RENT_REMINDERS_ENABLED is not set to true' })
    expect(kinds(run)).toEqual([[2, 'OVERDUE', 'would-remind']])
    expect(notify).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('only reports on a dry run, even switched on', async () => {
    on()
    at('2027-04-20T08:00:00Z')
    expect(await runRentReminders({ dryRun: true })).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('reminds three days before, on the day, and not in between or on the grace day', async () => {
    on()
    const sent: Record<string, string[]> = {}
    for (const key of ['2027-04-11', '2027-04-12', '2027-04-13', '2027-04-14', '2027-04-15', '2027-04-16']) {
      notify.mockClear()
      at(`${key}T08:00:00Z`)
      await runRentReminders()
      sent[key] = notify.mock.calls.map(([event]) => event)
    }
    expect(sent).toEqual({
      '2027-04-11': [], '2027-04-12': ['rent.due_soon'], '2027-04-13': [], '2027-04-14': [], '2027-04-15': ['rent.due_today'], '2027-04-16': [],
    })
  })

  it('reminds daily from the day after the grace day to 14 days after the due date, then stops and tells the admins', async () => {
    on()
    const days: string[] = []
    for (let d = 16; d <= 31; d++) {
      notify.mockClear()
      const now = new Date(day('2027-04-15').getTime() + (d - 15) * DAY - 4 * HOUR)
      vi.setSystemTime(now)
      await runRentReminders()
      const events = notify.mock.calls.map(([event]) => event).join('+')
      days.push(`${d - 15}:${events}`)
    }
    expect(days).toEqual([
      '1:',
      ...Array.from({ length: 13 }, (_, i) => `${i + 2}:rent.overdue+rent.overdue_notice`),
      '15:rent.reminders_stopped', '16:rent.reminders_stopped',
    ])
  })

  it('keys the daily reminder on the day, and the one-off notices on the instalment alone', async () => {
    on()
    at('2027-04-20T08:00:00Z')
    await runRentReminders()
    expect(notified('rent.overdue')).toEqual([{ instalmentId: 'inst_2', day: '2027-04-20' }])
    expect(notified('rent.overdue_notice')).toEqual([{ instalmentId: 'inst_2' }])
    at('2027-05-02T08:00:00Z')
    notify.mockClear()
    await runRentReminders()
    expect(notified('rent.reminders_stopped')).toEqual([{ instalmentId: 'inst_2' }])
  })

  it('says nothing about rent that is paid, covered, cancelled, on the first payment, or on a tenancy that does not stand', async () => {
    on()
    at('2027-04-20T08:00:00Z')
    for (const status of ['PAID', 'COVERED', 'CANCELLED']) {
      inst(2).status = status
      expect((await runRentReminders()).results, status).toEqual([])
    }
    inst(2).status = 'PENDING'
    for (const over of [{ status: 'CANCELLED' }, { paymentStatus: 'REFUNDED' }, { paymentStatus: 'UNPAID' }]) {
      const before = { status: booking().status, paymentStatus: booking().paymentStatus }
      Object.assign(booking(), over)
      expect((await runRentReminders()).results).toEqual([])
      Object.assign(booking(), before)
    }
    // The first payment is the booking's own, with its own deadline
    Object.assign(booking(), { paymentStatus: 'PAID' })
    Object.assign(inst(1), { status: 'PENDING', dueDate: day('2027-04-18') })
    inst(2).status = 'PAID'
    expect((await runRentReminders()).results).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it('still reminds about one part covered from the deposit', async () => {
    on()
    Object.assign(inst(2), { status: 'PART_COVERED', coveredFromDeposit: 500 })
    at('2027-04-20T08:00:00Z')
    expect(kinds(await runRentReminders())).toEqual([[2, 'OVERDUE', 'reminded']])
  })

  it('settles a payment the tenant made before chasing them, and then says nothing', async () => {
    on()
    const p = started(2)
    paystackSays('success')
    at('2027-04-20T08:00:00Z')
    expect(kinds(await runRentReminders())).toEqual([[2, 'OVERDUE', 'paid']])
    expect(inst(2).status).toBe('PAID')
    expect(payment(p.id as string).status).toBe('SUCCESS')
    expect(notified('rent.overdue')).toEqual([])
    expect(notified('rent.paid')).toEqual([{ instalmentId: 'inst_2' }])
  })

  it('waits, without chasing, while Paystack cannot be reached or a payment is still in progress', async () => {
    on()
    started(2)
    at('2027-04-20T08:00:00Z')
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(kinds(await runRentReminders())).toEqual([[2, 'OVERDUE', 'waiting']])
    paystackSays('ongoing')
    expect(kinds(await runRentReminders())).toEqual([[2, 'OVERDUE', 'waiting']])
    expect(notify).not.toHaveBeenCalled()
    // Abandoned: the payment failed, so the reminder goes out
    paystackSays('abandoned')
    expect(kinds(await runRentReminders())).toEqual([[2, 'OVERDUE', 'reminded']])
  })

  it('never charges anyone: the only calls it can make are read-only lookups', async () => {
    on()
    started(2)
    paystackSays('abandoned')
    at('2027-04-20T08:00:00Z')
    await runRentReminders()
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/\/transaction\/verify\//)
      expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET')
    }
  })

  describe('the cron route', () => {
    it('needs the cron secret, on GET and on POST', async () => {
      expect((await cron('', null)).status).toBe(401)
      expect((await cron('', 'wrong')).status).toBe(401)
      expect((await cron('', null, 'POST')).status).toBe(401)
      vi.stubEnv('CRON_SECRET', '')
      expect((await cron('', '')).status).toBe(401)
      expect(sentry.withMonitor).not.toHaveBeenCalled()
    })

    it('runs under a Sentry monitor on the schedule vercel.json gives it', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const res = await cron()
      expect(res.status).toBe(200)
      expect(sentry.withMonitor).toHaveBeenCalledWith('rent-reminders-cron', expect.any(Function), expect.objectContaining({ schedule: { type: 'crontab', value: '0 8 * * *' }, timezone: 'UTC' }))
      const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8'))
      expect(vercel.crons).toContainEqual({ path: '/api/cron/rent-reminders', schedule: '0 8 * * *' })
    })

    it('honours ?dryRun=1 whatever the switch says', async () => {
      on()
      at('2027-04-20T08:00:00Z')
      expect(await (await cron('?dryRun=1')).json()).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested', results: [{ action: 'would-remind' }] })
      expect(notify).not.toHaveBeenCalled()
      expect(await (await cron('', 'cron_secret', 'POST')).json()).toMatchObject({ mode: 'live', results: [{ action: 'reminded' }] })
    })
  })
})

// ─── Covering from the deposit ──────────────────────────────────────────────

describe('covering a missed payment from the deposit', () => {
  beforeEach(() => { tenancy(); at('2027-04-20T09:00:00Z'); as('admin_1', 'ADMIN') })
  const on = () => vi.stubEnv('RENT_DEPOSIT_COVER_ENABLED', 'true')

  it('is off unless the switch is exactly "true"', () => {
    for (const value of ['', '1', 'TRUE', 'yes']) {
      vi.stubEnv('RENT_DEPOSIT_COVER_ENABLED', value)
      expect(rentDepositCoverEnabled(), value).toBe(false)
    }
    on()
    expect(rentDepositCoverEnabled()).toBe(true)
  })

  it('only reports what it would do while switched off, and writes nothing', async () => {
    const res = await cover({ instalmentId: 'inst_2' })
    expect(await res.json()).toEqual({
      ok: true, mode: 'dry-run', reason: 'RENT_DEPOSIT_COVER_ENABLED is not set to true',
      quote: { ok: true, cover: 500, shortfall: 500, depositLeftAfter: 0, status: 'PART_COVERED' },
    })
    expect(state.writes).toBe(0)
    expect(inst(2)).toMatchObject({ status: 'PENDING', coveredFromDeposit: 0, coveredById: null })
    expect(notify).not.toHaveBeenCalled()
  })

  it('only reports on a dry run, even switched on', async () => {
    on()
    expect(await (await cover({ instalmentId: 'inst_2', dryRun: true })).json()).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested' })
    expect(state.writes).toBe(0)
  })

  it('takes what the deposit has, leaves the shortfall owed, and records who did it and when', async () => {
    on()
    const res = await cover({ instalmentId: 'inst_2' })
    expect(await res.json()).toMatchObject({ mode: 'applied', quote: { cover: 500, shortfall: 500, status: 'PART_COVERED' } })
    expect(inst(2)).toMatchObject({ status: 'PART_COVERED', coveredFromDeposit: 500, coveredById: 'admin_1', coveredAt: new Date('2027-04-20T09:00:00Z'), paidAt: null })
    expect(notified('rent.covered_from_deposit')).toEqual([{ instalmentId: 'inst_2' }])
    // No money moves through Paystack: the deposit is already held
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.refunds).toHaveLength(0)
  })

  it('settles the payment when the deposit covers all of it', async () => {
    on()
    booking().damageDeposit = 1800
    await cover({ instalmentId: 'inst_2' })
    expect(inst(2)).toMatchObject({ status: 'COVERED', coveredFromDeposit: 1000, paidAt: new Date('2027-04-20T09:00:00Z'), coveredById: 'admin_1' })
  })

  it('does nothing on a second click', async () => {
    on()
    // Plenty of deposit, so it is the click itself that is refused and not the deposit running out
    booking().damageDeposit = 5000
    const results = await Promise.all([cover({ instalmentId: 'inst_2' }), cover({ instalmentId: 'inst_2' })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(inst(2).coveredFromDeposit).toBe(1000)
    expect((await cover({ instalmentId: 'inst_2' })).status).toBe(400)
    expect(inst(2).coveredFromDeposit).toBe(1000)
    expect(notified('rent.covered_from_deposit')).toHaveLength(1)
  })

  it('never takes more out of the deposit than was paid into it, across instalments', async () => {
    on()
    booking().damageDeposit = 1500
    at('2027-05-20T09:00:00Z')
    await Promise.all([cover({ instalmentId: 'inst_2' }), cover({ instalmentId: 'inst_3' })])
    await cover({ instalmentId: 'inst_3' })
    const used = state.instalments.reduce((s, i) => s + (i.coveredFromDeposit as number), 0)
    expect(used).toBe(1500)
    expect(inst(2)).toMatchObject({ status: 'COVERED', coveredFromDeposit: 1000 })
    expect(inst(3)).toMatchObject({ status: 'PART_COVERED', coveredFromDeposit: 500 })
    expect((await cover({ instalmentId: 'inst_4' })).status).toBe(400)
  })

  it('is refused for a payment that is not late, is the first, is settled, or has a payment in progress', async () => {
    on()
    const refused = async (id: string) => { const res = await cover({ instalmentId: id }); return res.status === 400 ? (await res.json()).error : res.status }
    expect(await refused('inst_1')).toMatch(/first payment/)
    expect(await refused('inst_3')).toMatch(/Only a late payment/)
    expect(await refused('inst_missing')).toBe(404)
    started(2)
    expect(await refused('inst_2')).toMatch(/payment in progress/)
    state.payments.pop()
    at('2027-04-16T09:00:00Z')    // the grace day
    expect(await refused('inst_2')).toMatch(/Only a late payment/)
    expect(state.writes).toBe(0)
  })

  it('is for admins only', async () => {
    on()
    for (const [id, role] of [['host_1', 'HOST'], ['guest_1', 'GUEST']] as const) {
      as(id, role)
      expect((await cover({ instalmentId: 'inst_2' })).status, role).toBe(403)
      expect((await adminRent.GET()).status, role).toBe(403)
    }
    state.user = null
    expect((await cover({ instalmentId: 'inst_2' })).status).toBe(401)
    expect((await adminRent.GET()).status).toBe(401)
    expect(inst(2)).toMatchObject({ status: 'PENDING', coveredFromDeposit: 0 })
    expect(state.writes).toBe(0)
  })

  it('records the admin who is signed in, never one named in the request', async () => {
    on()
    await cover({ instalmentId: 'inst_2', adminId: 'someone_else', coveredById: 'someone_else', cover: 99_999 })
    expect(inst(2)).toMatchObject({ coveredById: 'admin_1', coveredFromDeposit: 500 })
    expect((await coverFromDeposit({ instalmentId: 'inst_3', adminId: 'admin_1' })).ok).toBe(false)
  })

  it('shows the admin what is late, what covering would do, and what is held', async () => {
    state.payouts.push({ id: 'payout_h', status: 'HELD', amount: 2700, bookingId: 'booking_1', hostId: 'host_1', instalmentSeq: 1 })
    const data = await (await adminRent.GET()).json()
    expect(data.coverEnabled).toBe(false)
    expect(data.instalments).toHaveLength(1)
    expect(data.instalments[0]).toMatchObject({
      id: 'inst_2', overdue: true, daysPastDue: 5, outstanding: 1000, depositLeft: 500,
      cover: { ok: true, cover: 500, shortfall: 500 }, endsOn: '2027-04-15T12:00:00.000Z',
    })
  })
})

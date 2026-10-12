import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './security/harness'

// Money on a booking that is off: the cancel that lands with a payment, and
// the safety net for a cancelled booking that holds a payment with no refund.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
const hook = vi.hoisted(() => ({ betweenReadAndWrite: null as null | (() => void) }))
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))
vi.mock('@/lib/session', async (original) => ({ ...(await original<typeof import('@/lib/session')>()), getSessionUser: async () => (state.user ? { ...state.user } : null) }))
// The fake database, with one seam: something can happen between the route reading the booking and writing to it
vi.mock('@/lib/db', async () => {
  const base = (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) as Record<string, Record<string, (...args: unknown[]) => unknown>>
  return {
    db: new Proxy(base, {
      get(target, prop: string) {
        if (prop !== 'payout') return target[prop]
        return { ...target.payout, findFirst: async (args: unknown) => { hook.betweenReadAndWrite?.(); hook.betweenReadAndWrite = null; return target.payout.findFirst(args) } }
      },
    }),
  }
})

import { NOW, as, home, json, params, person, reset, stay } from './security/harness'
import { recordUnrefundedPayments } from '@/lib/unrefunded'
import { PATCH as changeBooking } from '@/app/api/bookings/[id]/route'

const DAY = 86_400_000
const rows = (table: string) => (state.tables[table] ??= [])
const booking = (id: string) => rows('booking').find((b) => b.id === id)!
const paid = (bookingId: string, over: Record<string, unknown> = {}) => rows('payment').push({ id: `pay_${bookingId}`, bookingId, amount: 300, amountPesewas: 465000, usdToGhs: 15.5, status: 'SUCCESS', method: 'CARD', instalmentId: null, createdAt: NOW, ...over })

beforeEach(() => {
  reset(state)
  hook.betweenReadAndWrite = null
  sentry.captureMessage.mockReset()
  vi.unstubAllEnvs()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST')
  person(state, 'ama')
  home(state, 'home', 'host')
})

describe('cancelling at the moment the payment lands', () => {
  it('a payment that arrives while the guest is cancelling stops the cancel: nothing is cancelled and they are told to look again', async () => {
    stay(state, 'b1', 'home', 'ama', 'host', { status: 'CONFIRMED', paymentStatus: 'UNPAID', payBy: new Date(NOW.getTime() + 3_600_000) })
    as(state, 'ama')
    // The route has read the booking as unpaid (so: nothing to refund). Before it writes, the payment settles.
    hook.betweenReadAndWrite = () => { booking('b1').paymentStatus = 'PAID'; paid('b1') }
    const res = await changeBooking(json('PATCH', { action: 'cancel' }), params('b1'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'PAYMENT_ARRIVED' })
    // Still standing, still paid, and no blocked date was released
    expect(booking('b1')).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    expect(rows('refund')).toHaveLength(0)
    // Asked again, the cancel sees the payment and records the refund it owes
    const again = await changeBooking(json('PATCH', { action: 'cancel', expectedRefund: 300 }), params('b1'))
    expect(again.status).toBe(200)
    expect(booking('b1').status).toBe('CANCELLED')
    expect(rows('refund')).toHaveLength(1)
    expect(rows('refund')[0]).toMatchObject({ bookingId: 'b1', amount: 300, reason: 'GUEST_CANCELLED' })
  })

  it('a cancel with nothing in the way still works', async () => {
    stay(state, 'b1', 'home', 'ama', 'host', { status: 'CONFIRMED', paymentStatus: 'UNPAID' })
    as(state, 'ama')
    expect((await changeBooking(json('PATCH', { action: 'cancel' }), params('b1'))).status).toBe(200)
    expect(booking('b1').status).toBe('CANCELLED')
  })
})

describe('the safety net: a cancelled booking that holds a payment with no refund', () => {
  const orphan = (id: string, over: Record<string, unknown> = {}) => {
    stay(state, id, 'home', 'ama', 'host', { status: 'CANCELLED', paymentStatus: 'PAID', cancelledBy: 'GUEST', cancelledAt: NOW, checkIn: new Date(NOW.getTime() + 30 * DAY), checkOut: new Date(NOW.getTime() + 33 * DAY), ...over })
    paid(id)
  }

  it('records the full refund and raises an alert naming the booking', async () => {
    orphan('b1')
    const found = await recordUnrefundedPayments({ live: true })
    expect(found).toEqual([{ bookingId: 'b1', paymentId: 'pay_b1', amount: 300, action: 'recorded' }])
    expect(rows('refund')).toHaveLength(1)
    expect(rows('refund')[0]).toMatchObject({ bookingId: 'b1', paymentId: 'pay_b1', reason: 'LATE_PAYMENT', amount: 300, amountPesewas: 465000 })
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
    const [message, options] = sentry.captureMessage.mock.calls[0]
    expect(message).toContain('no refund on record')
    expect(options.contexts.refund).toMatchObject({ bookingId: 'b1', paymentId: 'pay_b1', amount: 300 })
    expect(options.fingerprint).toEqual(['refund', 'UNREFUNDED_PAYMENT', 'b1'])
  })

  it('never records a second refund, however many times it runs', async () => {
    orphan('b1')
    await recordUnrefundedPayments({ live: true })
    expect(await recordUnrefundedPayments({ live: true })).toEqual([])
    expect(await recordUnrefundedPayments({ live: true })).toEqual([])
    expect(rows('refund')).toHaveLength(1)
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
  })

  it('leaves a booking that already has a refund alone, whatever its amount', async () => {
    orphan('b1')
    rows('refund').push({ id: 'r1', bookingId: 'b1', paymentId: 'pay_b1', reason: 'GUEST_CANCELLED', amount: 50, status: 'PENDING' })
    expect(await recordUnrefundedPayments({ live: true })).toEqual([])
    expect(rows('refund')).toHaveLength(1)
  })

  it('writes nothing and alerts nobody when the run is not live (refunds switched off, or a dry run)', async () => {
    orphan('b1')
    expect(await recordUnrefundedPayments({ live: false })).toEqual([{ bookingId: 'b1', paymentId: 'pay_b1', amount: 300, action: 'would-record' }])
    expect(rows('refund')).toHaveLength(0)
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('covers a declined request and a booking the system ended', async () => {
    orphan('b1', { status: 'DECLINED', cancelledBy: null, cancelledAt: null })
    orphan('b2', { cancelledBy: 'SYSTEM' })
    expect((await recordUnrefundedPayments({ live: true })).map((f) => f.bookingId).sort()).toEqual(['b1', 'b2'])
  })

  it('leaves a guest\'s own late cancellation under a policy that returns nothing: no refund is owed there', async () => {
    // Strict, cancelled 2 days before check-in, no deposit: the policy returns 0%
    orphan('b1', { cancellationPolicy: 'STRICT', checkIn: new Date(NOW.getTime() + 2 * DAY), checkOut: new Date(NOW.getTime() + 5 * DAY) })
    expect(await recordUnrefundedPayments({ live: true })).toEqual([])
    expect(rows('refund')).toHaveLength(0)
    // The same late cancellation with a deposit is owed the deposit, so having no refund on record is wrong
    orphan('b2', { cancellationPolicy: 'STRICT', damageDeposit: 50, checkIn: new Date(NOW.getTime() + 2 * DAY), checkOut: new Date(NOW.getTime() + 5 * DAY) })
    expect((await recordUnrefundedPayments({ live: true })).map((f) => f.bookingId)).toEqual(['b2'])
  })

  it('leaves standing and unpaid bookings alone', async () => {
    stay(state, 'b1', 'home', 'ama', 'host', { status: 'CONFIRMED', paymentStatus: 'PAID' }); paid('b1')
    stay(state, 'b2', 'home', 'ama', 'host', { status: 'CANCELLED', paymentStatus: 'UNPAID' })
    rows('payment').push({ id: 'pay_failed', bookingId: 'b2', amount: 300, status: 'FAILED', createdAt: NOW })
    expect(await recordUnrefundedPayments({ live: true })).toEqual([])
  })
})

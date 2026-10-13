import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Row } from '@/lib/testing/fakeDb'
import type { State } from './harness'

// What one person can see of another: contact details, a listing that is not
// live, and who is an admin.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

import { NOW, as, home, params, person, reset, stay } from './harness'
import { bookingFor, contactShared, listingVisible, profileVisible } from '@/lib/privacy'
import { GET as getBookings } from '@/app/api/bookings/route'
import { GET as getListing } from '@/app/api/listings/[id]/route'
import { GET as getProfile } from '@/app/api/users/[id]/route'

const one = async (id = 'booking') => (await (await getBookings(new Request(`http://x/api/bookings?id=${id}`))).json()).booking
const list = async (query: string) => (await (await getBookings(new Request(`http://x/api/bookings?${query}`))).json()).bookings as Row[]
const listing = (id = 'home') => getListing(new Request(`http://x/api/listings/${id}`), params(id))
const profile = (id: string) => getProfile(new Request(`http://x/api/users/${id}`), params(id))

beforeEach(() => {
  reset(state)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST', { phone: '+233241111111', email: 'host@example.test' })
  person(state, 'guest', 'GUEST', { phone: '+233242222222', email: 'guest@example.test' })
  person(state, 'admin', 'ADMIN')
  person(state, 'stranger')
  home(state, 'home', 'host')
  ;(state.tables.payment ??= []).push({ id: 'pay_1', bookingId: 'booking', amount: 300, status: 'SUCCESS', method: 'MOMO', gatewayReference: 'FIE-booking-1', authorizationUrl: 'https://checkout.paystack.com/FIE-booking-1', momoNumber: '0242222222', amountPesewas: 450000 })
  ;(state.tables.refund ??= []).push({ id: 'ref_1', bookingId: 'booking', paymentId: 'pay_1', amount: 50, status: 'PROCESSED', paystackRefundId: 'RFD_123', failureReason: null, reason: 'DISPUTE_PARTIAL', stayRefund: 50 })
})

describe('phone numbers and emails on a booking', () => {
  const states: [string, Row, boolean][] = [
    ['a request the host has not answered', { status: 'PENDING', paymentStatus: 'UNPAID' }, false],
    ['an instant booking not paid for', { status: 'CONFIRMED', paymentStatus: 'UNPAID' }, false],
    ['a cancelled booking', { status: 'CANCELLED', paymentStatus: 'UNPAID' }, false],
    ['a declined request', { status: 'DECLINED', paymentStatus: 'UNPAID' }, false],
    ['a cancelled booking that was refunded', { status: 'CANCELLED', paymentStatus: 'REFUNDED' }, false],
    ['a confirmed and paid booking', { status: 'CONFIRMED', paymentStatus: 'PAID' }, true],
    ['a completed stay', { status: 'COMPLETED', paymentStatus: 'PAID' }, true],
    ['a stay with a part refund', { status: 'COMPLETED', paymentStatus: 'PARTIALLY_REFUNDED' }, true],
  ]

  it.each(states)('%s', async (_name, over, shared) => {
    stay(state, 'booking', 'home', 'guest', 'host', over)
    expect(contactShared(over as { status: string; paymentStatus: string })).toBe(shared)

    as(state, 'guest')
    const forGuest = await one()
    expect(forGuest.host.phone).toBe(shared ? '+233241111111' : null)
    // Their own details are always theirs to see
    expect(forGuest.guest).toMatchObject({ phone: '+233242222222', email: 'guest@example.test' })

    as(state, 'host')
    const forHost = await one()
    expect(forHost.guest.phone).toBe(shared ? '+233242222222' : null)
    expect(forHost.guest.email).toBe(shared ? 'guest@example.test' : null)
    expect(forHost.guest.name).toBe('Person guest')
    expect(forHost.host.phone).toBe('+233241111111')

    as(state, 'admin')
    const forAdmin = await one()
    expect(forAdmin.guest).toMatchObject({ phone: '+233242222222', email: 'guest@example.test' })
    expect(forAdmin.host.phone).toBe('+233241111111')
  })

  it('a guest cannot collect a host\'s phone number by booking without paying', async () => {
    stay(state, 'booking', 'home', 'guest', 'host', { status: 'CONFIRMED', paymentStatus: 'UNPAID' })
    as(state, 'guest')
    expect(JSON.stringify(await one())).not.toContain('233241111111')
    expect(JSON.stringify(await list('guestId=guest'))).not.toContain('233241111111')
  })

  it('a host never gets the guest\'s payment references or mobile money number', async () => {
    stay(state, 'booking', 'home', 'guest', 'host', { paymentReference: 'FIE-booking-1' })
    as(state, 'host')
    for (const text of [JSON.stringify(await one()), JSON.stringify(await list('hostId=host'))]) {
      expect(text).not.toContain('FIE-booking-1')
      expect(text).not.toContain('checkout.paystack.com')
      expect(text).not.toContain('0242222222"')
      expect(text).not.toContain('RFD_123')
    }
    const forHost = await one()
    // The booking's own reference is the same value as its first payment's
    expect(forHost.paymentReference).toBeNull()
    expect(forHost.payments[0]).toMatchObject({ id: 'pay_1', amount: 300, status: 'SUCCESS' })
    expect(forHost.refund).toMatchObject({ amount: 50, status: 'PROCESSED' })
    // The guest still sees their own
    as(state, 'guest')
    expect((await one()).payments[0].gatewayReference).toBe('FIE-booking-1')
    expect((await one()).paymentReference).toBe('FIE-booking-1')
  })

  it('leaves a booking no one else may see as it was: a stranger gets nothing', async () => {
    stay(state, 'booking', 'home', 'guest', 'host')
    as(state, 'stranger')
    expect((await getBookings(new Request('http://x/api/bookings?id=booking'))).status).toBe(403)
    expect((await getBookings(new Request('http://x/api/bookings?guestId=guest'))).status).toBe(403)
    expect((await getBookings(new Request('http://x/api/bookings?hostId=host'))).status).toBe(403)
    as(state, null)
    expect((await getBookings(new Request('http://x/api/bookings?id=booking'))).status).toBe(401)
  })

  it('works on a booking with nobody loaded', () => {
    const bare = { guestId: 'guest', hostId: 'host', status: 'PENDING', paymentStatus: 'UNPAID' }
    expect(bookingFor(bare, { id: 'host', role: 'HOST' })).toEqual(bare)
  })
})

describe('a listing that is switched off or on hold', () => {
  it.each([
    ['switched off', { isActive: false }],
    ['on hold', { isActive: false, moderationHold: true }],
    ['on hold but marked active', { isActive: true, moderationHold: true }],
  ])('%s: is not public by its link', async (_name, over) => {
    Object.assign(state.tables.listing[0], over, { description: 'Call me on 0241234567' })
    as(state, null)
    const res = await listing()
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain('0241234567')
    as(state, 'stranger')
    expect((await listing()).status).toBe(404)
    // Its host and an admin can still open it
    as(state, 'host')
    expect((await listing()).status).toBe(200)
    as(state, 'admin')
    expect((await listing()).status).toBe(200)
  })

  it('can still be opened by a guest who has booked it, and by nobody else\'s booking', async () => {
    Object.assign(state.tables.listing[0], { isActive: false })
    stay(state, 'booking', 'home', 'guest', 'host')
    as(state, 'guest')
    expect((await listing()).status).toBe(200)
    as(state, 'stranger')
    expect((await listing()).status).toBe(404)
  })

  it('a live listing is public', async () => {
    as(state, null)
    expect((await listing()).status).toBe(200)
    expect(listingVisible({ hostId: 'host', isActive: true, moderationHold: false }, null, false)).toBe(true)
  })
})

describe('profiles', () => {
  it('a host\'s profile is public', async () => {
    as(state, null)
    const res = await profile('host')
    expect(res.status).toBe(200)
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('host@example.test')
    expect(body).not.toContain('233241111111')
  })

  it('an admin\'s profile is for admins only, so nobody can find out which accounts are admins', async () => {
    for (const who of [null, 'stranger', 'guest', 'host']) {
      as(state, who)
      const res = await profile('admin')
      expect(res.status, String(who)).toBe(404)
      // The same answer as for an account that does not exist
      expect(await res.json()).toEqual(await (await profile('no-such-user')).json())
    }
    as(state, 'admin')
    expect((await profile('admin')).status).toBe(200)
  })

  it('a guest\'s profile is for themselves, admins and a host they have booked with', async () => {
    as(state, null)
    expect((await profile('guest')).status).toBe(404)
    as(state, 'stranger')
    expect((await profile('guest')).status).toBe(404)
    as(state, 'host')
    expect((await profile('guest')).status).toBe(404)
    stay(state, 'booking', 'home', 'guest', 'host', { status: 'PENDING', paymentStatus: 'UNPAID' })
    expect((await profile('guest')).status).toBe(200)
    as(state, 'guest')
    expect((await profile('guest')).status).toBe(200)
    as(state, 'admin')
    expect((await profile('guest')).status).toBe(200)
    expect(profileVisible({ id: 'guest', role: 'GUEST' }, { id: 'stranger', role: 'HOST' }, false)).toBe(false)
  })
})

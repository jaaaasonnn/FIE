import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './security/harness'

// G7: when the answer to Book was lost, pressing Book again must say the dates
// are the guest's own booking, and where it is; never another guest's.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

import { NOW, as, home, json, person, reset } from './security/harness'
import { ownBooking } from '@/lib/ownBooking'
import { POST as book } from '@/app/api/bookings/route'

const DATES = { listingId: 'home', rentalMode: 'SHORT_STAY', checkIn: '2027-03-09', checkOut: '2027-03-11' }
const press = async () => { const res = await book(json('POST', DATES)); return { status: res.status, body: await res.json() } }

beforeEach(() => {
  reset(state)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST')
  person(state, 'guest')
  person(state, 'other')
})

describe('the dates are held by a booking of the guest\'s own', () => {
  it('pressing Book again says so, with the way to pay, instead of "no longer available"', async () => {
    home(state, 'home', 'host', { instantBook: true })
    as(state, 'guest')
    const first = await press()
    expect(first.status).toBe(201)
    const again = await press()
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ code: 'OWN_BOOKING', bookingId: first.body.booking.id, href: `/checkout/${first.body.booking.id}` })
    expect(again.body.error).toMatch(/waiting for payment/)
    expect(state.tables.booking).toHaveLength(1)
  })

  it('a request waiting for the host leads to the request', async () => {
    home(state, 'home', 'host', { instantBook: false })
    as(state, 'guest')
    const first = await press()
    const again = await press()
    expect(again.body).toMatchObject({ code: 'OWN_BOOKING', href: `/bookings/${first.body.booking.id}` })
  })

  it('another guest\'s booking is only "no longer available": nothing of it is given away', async () => {
    home(state, 'home', 'host', { instantBook: true })
    as(state, 'other')
    expect((await press()).status).toBe(201)
    as(state, 'guest')
    const clash = await press()
    expect(clash.status).toBe(409)
    expect(clash.body).toEqual({ error: 'These dates are no longer available. Please choose different dates.', code: 'DATE_CONFLICT' })
  })

  it('names a paid booking as a booking, not as waiting for payment', () => {
    expect(ownBooking({ id: 'b1', guestId: 'g', status: 'CONFIRMED', paymentStatus: 'PAID' }, 'g')).toMatchObject({ href: '/bookings/b1', message: 'You already have a booking for these dates.' })
    expect(ownBooking({ id: 'b1', guestId: 'someone', status: 'CONFIRMED', paymentStatus: 'UNPAID' }, 'g')).toBeNull()
  })
})

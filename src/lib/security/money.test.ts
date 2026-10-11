import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Row } from '@/lib/testing/fakeDb'
import type { State } from './harness'

// Prices and deposits a host sets: a negative or nonsense amount must never
// reach what a guest is charged or what a host is paid.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

import { NOW, as, home, json, params, person, reset } from './harness'
import { MAX_DEPOSIT_USD, MAX_PRICE_USD, depositIsSound, parseListingMoney } from '@/lib/listingInput'
import { parseMoney } from '@/lib/validate'
import { hostShare } from '@/lib/disputes'
import { POST as createListing } from '@/app/api/listings/route'
import { PATCH as editListing } from '@/app/api/listings/[id]/route'
import { POST as book } from '@/app/api/bookings/route'

const NEW = { title: 'Flat by the sea', propertyType: 'Apartment', region: 'Greater Accra', city: 'Accra', bedrooms: 2, rentalModes: ['SHORT_STAY'], priceNightly: 1000 }
const create = (over: Row) => createListing(json('POST', { ...NEW, ...over }))
const edit = (body: Row, id = 'home') => editListing(json('PATCH', body), params(id))
const request = (listingId = 'home') => book(json('POST', { listingId, rentalMode: 'SHORT_STAY', checkIn: '2027-03-09', checkOut: '2027-03-10' }))

beforeEach(() => {
  reset(state)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST')
  person(state, 'guest')
  as(state, 'host')
})

describe('the amounts themselves', () => {
  it('accepts real amounts and nothing else', () => {
    const deposit = { label: 'The damage deposit', max: MAX_DEPOSIT_USD, allowZero: true }
    expect(parseMoney(250, deposit)).toEqual({ ok: true, value: 250 })
    expect(parseMoney('250.50', deposit)).toEqual({ ok: true, value: 250.5 })
    expect(parseMoney(0, deposit)).toEqual({ ok: true, value: 0 })
    expect(parseMoney('', deposit)).toEqual({ ok: true, value: null })
    expect(parseMoney(null, deposit)).toEqual({ ok: true, value: null })
    for (const bad of [-1, -900, '-900', 'abc', '1e9', '12abc', NaN, Infinity, -Infinity, true, [], {}, MAX_DEPOSIT_USD + 1]) {
      expect(parseMoney(bad, deposit).ok, String(bad)).toBe(false)
    }
    // A price must be more than nothing
    expect(parseMoney(0, { label: 'The nightly price', max: MAX_PRICE_USD }).ok).toBe(false)
  })

  it('leaves out what was not sent, and stores no deposit as none', () => {
    expect(parseListingMoney({})).toEqual({ ok: true, value: {} })
    expect(parseListingMoney({ damageDeposit: 0, priceNightly: '80' })).toEqual({ ok: true, value: { damageDeposit: null, priceNightly: 80 } })
    expect(parseListingMoney({ priceMonthly: null })).toEqual({ ok: true, value: { priceMonthly: null } })
  })

  it('knows a stored deposit it can book with', () => {
    for (const fine of [null, undefined, 0, 250]) expect(depositIsSound(fine)).toBe(true)
    for (const bad of [-1, -900, NaN, Infinity, MAX_DEPOSIT_USD + 1]) expect(depositIsSound(bad)).toBe(false)
  })
})

describe('a host setting prices and a deposit', () => {
  it('a new listing with a negative or nonsense deposit is refused', async () => {
    for (const damageDeposit of [-900, '-900', 'lots', MAX_DEPOSIT_USD + 1, true]) {
      const res = await create({ damageDeposit })
      expect(res.status, String(damageDeposit)).toBe(400)
    }
    expect(state.tables.listing ?? []).toHaveLength(0)
    expect((await create({ damageDeposit: 250 })).status).toBe(201)
    expect(state.tables.listing[0]).toMatchObject({ damageDeposit: 250, priceNightly: 1000 })
  })

  it('a new listing with a negative, zero or nonsense price is refused', async () => {
    for (const over of [{ priceNightly: -5 }, { priceNightly: 0 }, { priceNightly: 'free' }, { priceMonthly: -1 }, { priceAnnual: MAX_PRICE_USD + 1 }]) {
      expect((await create(over)).status, JSON.stringify(over)).toBe(400)
    }
    expect(state.tables.listing ?? []).toHaveLength(0)
  })

  it('an edit to a negative or nonsense deposit is refused and changes nothing', async () => {
    home(state, 'home', 'host', { priceNightly: 1000, damageDeposit: 200 })
    for (const damageDeposit of [-900, '-900', 'lots', MAX_DEPOSIT_USD + 1, { gt: 0 }]) {
      const res = await edit({ damageDeposit, title: 'Changed' })
      expect(res.status, String(damageDeposit)).toBe(400)
    }
    expect(state.tables.listing[0]).toMatchObject({ damageDeposit: 200, title: 'Home home' })
    expect((await edit({ damageDeposit: 0 })).status).toBe(200)
    expect(state.tables.listing[0].damageDeposit).toBeNull()
  })

  it('an edit to a negative, zero or nonsense price is refused and changes nothing', async () => {
    home(state, 'home', 'host', { priceNightly: 1000 })
    for (const over of [{ priceNightly: -5 }, { priceNightly: 0 }, { priceNightly: 'free' }, { priceMonthly: -1 }, { priceAnnual: [1] }]) {
      expect((await edit(over)).status, JSON.stringify(over)).toBe(400)
    }
    expect(state.tables.listing[0]).toMatchObject({ priceNightly: 1000, priceMonthly: null })
  })

  it('holds an admin editing a listing to the same rule', async () => {
    home(state, 'home', 'host')
    person(state, 'admin', 'ADMIN')
    as(state, 'admin')
    expect((await edit({ damageDeposit: -900 })).status).toBe(400)
  })
})

describe('booking a home', () => {
  beforeEach(() => as(state, 'guest'))

  it('a listing whose stored deposit is negative cannot be booked', async () => {
    // As if a bad value had reached the table some other way
    home(state, 'home', 'host', { priceNightly: 1000, damageDeposit: -900 })
    const res = await request()
    expect(res.status).toBe(409)
    expect(state.tables.booking ?? []).toHaveLength(0)
    expect(state.tables.blockedDate ?? []).toHaveLength(0)
  })

  it('never charges less than the stay price, so a payout cannot be more than was paid', async () => {
    home(state, 'home', 'host', { priceNightly: 1000, damageDeposit: 150 })
    const res = await request()
    expect(res.status).toBe(201)
    const booking = state.tables.booking[0] as { subtotal: number; totalPrice: number; damageDeposit: number }
    expect(booking).toMatchObject({ subtotal: 1000, damageDeposit: 150, totalPrice: 1150 })
    expect(booking.totalPrice).toBeGreaterThanOrEqual(booking.subtotal)
    expect(hostShare(booking.subtotal)).toBeLessThanOrEqual(booking.totalPrice)
  })
})

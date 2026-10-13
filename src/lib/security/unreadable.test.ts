import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './harness'

// What the routes do with a request they cannot read: a body that is not a
// JSON object, a value of the wrong type, a filter that cannot be used. The
// answer is a 400 with a plain sentence, never a 500.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', async (original) => ({ ...(await original<typeof import('@/lib/session')>()), getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

import { NOW, as, home, person, reset } from './harness'
import { BODY_NOT_READABLE, QUERY_NOT_READABLE, hasNullByte, jsonObject, wholeFromQuery } from '@/lib/validate'
import { POST as book, GET as getBookings } from '@/app/api/bookings/route'
import { POST as sendMessage, GET as getMessages } from '@/app/api/messages/route'
import { POST as review, GET as getReviews } from '@/app/api/reviews/route'
import { POST as pay } from '@/app/api/payments/route'
import { PATCH as editProfile } from '@/app/api/users/me/route'
import { POST as signIn } from '@/app/api/auth/signin/route'
import { POST as signUp } from '@/app/api/auth/signup/route'
import { POST as wish } from '@/app/api/wishlists/route'
import { PATCH as dismiss } from '@/app/api/notifications/route'
import { POST as savePayoutMethod } from '@/app/api/users/me/payout-method/route'
import { GET as search } from '@/app/api/listings/route'

const raw = (body: string, method = 'POST') => new Request('http://localhost/api/x', { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: body === '' ? undefined : body })
const sent = (body: unknown, method = 'POST') => raw(JSON.stringify(body), method)
const get = (query: string) => new Request(`http://localhost/api/x?${query}`)

beforeEach(() => {
  reset(state)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_input')
  for (const method of ['error', 'log', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST', { passwordHash: '$2a$04$abcdefghijklmnopqrstuuJ5m1xJ8q1Zq1Zq1Zq1Zq1Zq1Zq1Zq1Z' })
  person(state, 'guest')
  home(state, 'home', 'host')
  as(state, 'guest')
})

describe('reading a body', () => {
  it('gives the object, and null for anything that is not a JSON object', async () => {
    expect(await jsonObject(sent({ a: 1 }))).toEqual({ a: 1 })
    for (const body of ['', 'hello', '{"listingId":"x"', '42', 'null', '[1,2,3]', '"x"', 'true', '<a/>']) {
      expect(await jsonObject(raw(body)), body).toBeNull()
    }
  })

  it('gives null for a body with a null byte in any text, at any depth, or one nested absurdly deep', async () => {
    for (const body of [{ identifier: 'a\u0000b' }, { receiverId: 'host', content: ['fine', { deep: 'x\u0000' }] }, { 'ke\u0000y': 1 }]) {
      expect(await jsonObject(sent(body)), JSON.stringify(body)).toBeNull()
    }
    let deep: unknown = 'x'
    for (let i = 0; i < 80; i++) deep = { a: deep }
    expect(await jsonObject(sent(deep))).toBeNull()
    expect(await jsonObject(sent({ a: { b: { c: ['fine'] } } }))).toEqual({ a: { b: { c: ['fine'] } } })
  })

  it('sign-in, messages and reviews answer 400 to an id or address with a null byte in it', async () => {
    expect((await signIn(sent({ identifier: 'a\u0000b', password: 'whatever' }))).status).toBe(400)
    expect((await sendMessage(sent({ receiverId: 'a\u0000b', listingId: 'home', content: 'hello' }))).status).toBe(400)
    expect((await review(sent({ bookingId: 'x\u0000', rating: 5, comment: 'fine', type: 'GUEST_TO_HOST' }))).status).toBe(400)
  })

  const routes: [string, (req: Request) => Promise<Response>, string][] = [
    ['bookings', book, 'POST'], ['messages', sendMessage, 'POST'], ['reviews', review, 'POST'], ['payments', pay, 'POST'],
    ['profile update', editProfile, 'PATCH'], ['sign-in', signIn, 'POST'], ['sign-up', signUp, 'POST'],
  ]
  it.each(routes)('%s answers 400, not 500, to a body that is empty, not JSON, null, a number or a list', async (_name, route, method) => {
    for (const body of ['', 'hello', '{"listingId":"x"', '42', 'null', '[1,2,3]', '"x"']) {
      const res = await route(raw(body, method))
      expect(res.status, body).toBe(400)
      expect((await res.json()).error, body).toBe(BODY_NOT_READABLE)
    }
  })

  it('no route reads a body any other way', () => {
    const ROOT = path.resolve(__dirname, '../../app/api')
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
    const bare = files(ROOT).filter((file) => /\b(req|request)\.json\(\)/.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(ROOT, file))
    expect(bare).toEqual([])
  })
})

describe('a value of the wrong type', () => {
  it('payments: an id that is not text is refused before it reaches the database', async () => {
    for (const body of [{ bookingId: [1, 2], method: 'CARD' }, { bookingId: { not: null }, method: 'CARD' }, { bookingId: 7, method: 'MOMO' }, { bookingId: 'booking', method: 'CARD', instalmentId: ['x'] }]) {
      expect((await pay(sent(body))).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('wishlists: a listing id that is not text is refused', async () => {
    for (const listingId of [24, ['home'], { in: ['home'] }, true]) expect((await wish(sent({ listingId }))).status, JSON.stringify(listingId)).toBe(400)
    expect(state.tables.wishlist ?? []).toHaveLength(0)
    expect((await wish(sent({ listingId: 'home' }))).status).toBeLessThan(300)
    // A home that does not exist is 404, not a server fault
    expect((await wish(sent({ listingId: 'no-such-home' }))).status).toBe(404)
  })

  it('notifications: an id that is not text is refused', async () => {
    for (const id of [-1, ['x'], { not: '' }]) expect((await dismiss(sent({ id }, 'PATCH'))).status, JSON.stringify(id)).toBe(400)
  })

  it('payout method: a password, number or bank code that is not text is refused before any hashing or any call', async () => {
    as(state, 'host')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const base = { payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: '0241234567' }
    for (const body of [{ ...base, password: 12345 }, { ...base, password: ['x'] }, { ...base, password: { length: 8 } }]) {
      expect((await savePayoutMethod(sent(body))).status, JSON.stringify(body.password)).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('filters in the address', () => {
  it('knows a null byte when it sees one, in a name or a value', () => {
    expect(hasNullByte(new URLSearchParams('city=Accra&mode=SHORT_STAY'))).toBe(false)
    expect(hasNullByte(new URLSearchParams('city=%00'))).toBe(true)
    expect(hasNullByte(new URLSearchParams('city=Ac%00cra'))).toBe(true)
    expect(hasNullByte(new URLSearchParams('ci%00ty=Accra'))).toBe(true)
  })

  it('reads a whole number or nothing', () => {
    expect(wholeFromQuery('2', 0, 100)).toBe(2)
    expect(wholeFromQuery(' 3 ', 0, 100)).toBe(3)
    for (const bad of ['abc', '2.5', '-1', '1e3', '', '101', '99999999999', '0x10', '2 OR 1=1']) expect(wholeFromQuery(bad, 0, 100), bad).toBeNull()
  })

  it('search answers 400 to a bedroom count that is not a whole number, and still works for one that is', async () => {
    for (const bedrooms of ['abc', '2.5', '-1', '1e9', 'NaN']) {
      const res = await search(get(`bedrooms=${bedrooms}`))
      expect(res.status, bedrooms).toBe(400)
      expect((await res.json()).error).toBe('bedrooms must be a whole number')
    }
    const two = await search(get('bedrooms=2'))
    expect(two.status).toBe(200)
    expect((await two.json()).listings).toHaveLength(1)
    expect((await (await search(get('bedrooms=3'))).json()).listings).toHaveLength(0)
  })

  it('search, reviews, bookings and messages answer 400 to a null byte in any filter', async () => {
    const asked: [string, Promise<Response>][] = [
      ['search mode', search(get('mode=%00'))], ['search city', search(get('city=Ac%00cra'))], ['search region', search(get('region=%00'))],
      ['reviews listingId', getReviews(get('listingId=%00'))], ['reviews revieweeId', getReviews(get('revieweeId=x%00'))],
      ['bookings id', getBookings(get('id=%00'))], ['bookings guestId', getBookings(get('guestId=guest%00'))],
      ['messages with', getMessages(get('with=%00'))],
    ]
    for (const [name, reply] of asked) {
      const res = await reply
      expect(res.status, name).toBe(400)
      expect((await res.json()).error, name).toBe(QUERY_NOT_READABLE)
    }
  })
})

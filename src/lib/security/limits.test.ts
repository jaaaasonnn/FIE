import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { abortNextTransactions, type Row } from '@/lib/testing/fakeDb'
import { BUSY_TRY_AGAIN, SERIAL_RETRIES } from '@/lib/serialRetry'
import type { State } from './harness'

// Limits on what anyone can do over and over: guessing passwords, making
// accounts, holding dates without paying, sending messages.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', async (original) => ({ ...(await original<typeof import('@/lib/session')>()), getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

import { NOW, as, home, json, person, reset, stay } from './harness'
import { LIMITS, MAX_MESSAGE_LENGTH, NO_REASON_TO_MESSAGE, TOO_MANY_OPEN_BOOKINGS, TOO_MANY_OPEN_REQUESTS, signInKey } from '@/lib/rateLimit'
import { IP_LIMIT_PER_HOUR, ipHashOf, requestPasswordReset } from '@/lib/authTokens'
import { POST as signIn } from '@/app/api/auth/signin/route'
import { POST as signUp } from '@/app/api/auth/signup/route'
import { POST as book } from '@/app/api/bookings/route'
import { POST as send } from '@/app/api/messages/route'

const MIN = 60 * 1000
const PASSWORD = 'correct horse battery'
const HASH = bcrypt.hashSync(PASSWORD, 4)
const from = (ip: string) => ({ 'x-forwarded-for': ip })
const login = (identifier: unknown, password: unknown, ip = '203.0.113.7') => signIn(json('POST', { identifier, password }, from(ip)))
const join = (n: number, ip = '203.0.113.7') => signUp(json('POST', { name: `New ${n}`, email: `new${n}@example.test`, password: 'a long password' }, from(ip)))
const forward = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))
const failures = () => (state.tables.authRequest ?? []).filter((r) => r.kind === 'SIGN_IN_FAILED')

beforeEach(() => {
  reset(state)
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'ama', 'GUEST', { email: 'ama@example.test', passwordHash: HASH })
})

describe('signing in', () => {
  it('locks an account after 5 wrong passwords in 15 minutes, even for the right one', async () => {
    for (let i = 0; i < LIMITS.signInPerAccount.max; i++) expect((await login('ama@example.test', 'wrong', `198.51.100.${i}`)).status).toBe(401)
    const locked = await login('ama@example.test', PASSWORD, '198.51.100.99')
    expect(locked.status).toBe(429)
    expect(locked.headers.get('Retry-After')).toBe('900')
    expect(state.tables.session ?? []).toHaveLength(0)

    // The window passes: the right password works again, and the count starts afresh
    forward(15 * MIN + 1000)
    expect((await login('ama@example.test', PASSWORD)).status).toBe(200)
    expect(state.tables.session).toHaveLength(1)
    expect(failures().filter((r) => r.userId === signInKey('ama@example.test'))).toHaveLength(0)
  })

  it('twenty wrong passwords sent at the same instant: no more than 5 are checked', async () => {
    const replies = await Promise.all(Array.from({ length: 20 }, (_, i) => login('ama@example.test', `wrong-${i}`)))
    const checked = replies.filter((r) => r.status === 401).length
    // Never more than the limit. It can be fewer, even none: each one counts every attempt written before it looked
    expect(checked).toBeLessThanOrEqual(LIMITS.signInPerAccount.max)
    expect(replies.filter((r) => r.status === 429)).toHaveLength(20 - checked)
    // Only the guesses that were checked are on record
    expect(failures()).toHaveLength(checked)
  })

  it('a refused attempt leaves nothing on record, so being refused does not keep the lock going', async () => {
    for (let i = 0; i < 5; i++) await login('ama@example.test', 'wrong')
    for (let i = 0; i < 10; i++) expect((await login('ama@example.test', PASSWORD)).status).toBe(429)
    expect(failures()).toHaveLength(5)
    forward(15 * MIN + 1000)
    expect((await login('ama@example.test', PASSWORD)).status).toBe(200)
  })

  it('the right password leaves no attempt on record', async () => {
    await login('ama@example.test', 'wrong')
    expect((await login('ama@example.test', PASSWORD)).status).toBe(200)
    expect(failures()).toHaveLength(0)
  })

  it('counts the address as typed, so capitals and spaces do not dodge the lock', async () => {
    for (const typed of ['ama@example.test', 'AMA@example.test', ' ama@example.test ', 'Ama@Example.Test', 'ama@example.test']) await login(typed, 'wrong')
    expect((await login('ama@example.test', PASSWORD)).status).toBe(429)
  })

  it('answers the same for an address with no account, and locks it the same way', async () => {
    for (let i = 0; i < LIMITS.signInPerAccount.max; i++) {
      const res = await login('nobody@example.test', 'wrong', `198.51.100.${i}`)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Invalid credentials' })
    }
    expect((await login('nobody@example.test', 'wrong')).status).toBe(429)
  })

  it('checks the password against a hash even when there is no account, so the answer takes as long', async () => {
    const compare = vi.spyOn(bcrypt, 'compare')
    await login('nobody@example.test', 'wrong')
    expect(compare).toHaveBeenCalledTimes(1)
    const [given, hash] = compare.mock.calls[0] as unknown as [string, string]
    expect(given).toBe('wrong')
    // A real bcrypt hash at the same cost as a stored password
    expect(hash).toMatch(/^\$2[aby]\$12\$.{53}$/)
    // An account with no password set is treated the same way
    person(state, 'kofi', 'GUEST', { email: 'kofi@example.test', passwordHash: null })
    await login('kofi@example.test', 'wrong')
    expect(compare).toHaveBeenCalledTimes(2)
    compare.mockRestore()
  })

  it('stops one IP address after 20 wrong passwords in an hour, whatever accounts they were for', async () => {
    for (let i = 0; i < LIMITS.signInPerIp.max; i++) expect((await login(`victim${i}@example.test`, 'guess')).status).toBe(401)
    expect((await login('ama@example.test', PASSWORD)).status).toBe(429)
    // Someone else, somewhere else, is not affected
    expect((await login('ama@example.test', PASSWORD, '192.0.2.44')).status).toBe(200)
    forward(60 * MIN + 1000)
    expect((await login('ama@example.test', PASSWORD)).status).toBe(200)
    // 23 real password checks, about 4.5 seconds: more room than the usual 5-second limit
  }, 20_000)

  it('refuses a password or address that is not text, or is absurdly long, without hashing it', async () => {
    const compare = vi.spyOn(bcrypt, 'compare')
    expect((await login({ $ne: null }, 'x')).status).toBe(400)
    expect((await login('ama@example.test', ['x'])).status).toBe(400)
    expect((await login('ama@example.test', 'x'.repeat(201))).status).toBe(401)
    expect(compare).not.toHaveBeenCalled()
    compare.mockRestore()
  })

  it('keeps wrong passwords out of the limit on reset and confirmation links', async () => {
    for (let i = 0; i < IP_LIMIT_PER_HOUR + 5; i++) await login(`victim${i}@example.test`, 'guess')
    const ipHash = ipHashOf(json('POST', {}, from('203.0.113.7')))
    await requestPasswordReset('ama@example.test', ipHash)
    expect(state.tables.authToken).toHaveLength(1)
  })
})

describe('where the IP address is read from', () => {
  const hash = (headers: Record<string, string>) => ipHashOf(new Request('http://x', { headers }))
  it('prefers the headers Vercel sets over one a visitor can send', () => {
    const real = hash({ 'x-forwarded-for': '203.0.113.7' })
    expect(hash({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' })).toBe(real)
    expect(hash({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1, 203.0.113.7' })).toBe(real)
    expect(hash({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe(real)
    expect(hash({})).toBeNull()
  })
})

describe('signing up', () => {
  it('allows 5 accounts an hour from one IP address, then no more', async () => {
    for (let i = 0; i < LIMITS.signUpPerIp.max; i++) expect((await join(i)).status).toBe(201)
    const refused = await join(99)
    expect(refused.status).toBe(429)
    expect(state.tables.user.filter((u) => String(u.email).startsWith('new'))).toHaveLength(LIMITS.signUpPerIp.max)
    expect((await join(100, '192.0.2.44')).status).toBe(201)
    forward(60 * MIN + 1000)
    expect((await join(101)).status).toBe(201)
  })

  it('ten sign-ups from one address at the same instant: no more than 5 make an account, and the rest are never hashed', async () => {
    const replies = await Promise.all(Array.from({ length: 10 }, (_, i) => join(100 + i)))
    const made = replies.filter((r) => r.status === 201).length
    expect(made).toBeLessThanOrEqual(LIMITS.signUpPerIp.max)
    expect(replies.filter((r) => r.status === 429)).toHaveLength(10 - made)
    expect(state.tables.user.filter((u) => String(u.email).startsWith('new1'))).toHaveLength(made)
    // One count per account made: the refused ones took theirs away
    expect((state.tables.authRequest ?? []).filter((r) => r.kind === 'SIGN_UP')).toHaveLength(made)
  })

  it('two sign-ups with one email at the same instant: one account, and the other is told the address is taken', async () => {
    const twin = (ip: string) => signUp(json('POST', { name: 'Twin', email: 'twin@example.test', password: 'a long password' }, from(ip)))
    const replies = await Promise.all([twin('198.51.100.1'), twin('198.51.100.2'), twin('198.51.100.3')])
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409, 409])
    for (const lost of replies.filter((r) => r.status === 409)) expect((await lost.json()).error).toBe('Email already registered')
    expect(state.tables.user.filter((u) => u.email === 'twin@example.test')).toHaveLength(1)
    // Only the account that was made is counted
    expect((state.tables.authRequest ?? []).filter((r) => r.kind === 'SIGN_UP')).toHaveLength(1)
  })

  it('two sign-ups with one phone number at the same instant: the other is told the number is taken', async () => {
    const twin = (ip: string) => signUp(json('POST', { name: 'Twin', phone: '0241234567', password: 'a long password' }, from(ip)))
    const replies = await Promise.all([twin('198.51.100.1'), twin('198.51.100.2')])
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409])
    expect((await replies.find((r) => r.status === 409)!.json()).error).toBe('Phone number already registered')
  })

  it('does not count a sign-up that was refused', async () => {
    for (let i = 0; i < 8; i++) expect((await signUp(json('POST', { name: 'x', email: 'ama@example.test', password: 'a long password' }, from('203.0.113.7')))).status).toBe(409)
    expect((await join(1)).status).toBe(201)
  })

  it('sends the confirmation link under the same limits as every other link', async () => {
    // Ten link requests have already come from this address in the last hour
    const ipHash = ipHashOf(json('POST', {}, from('203.0.113.7')))
    for (let i = 0; i < IP_LIMIT_PER_HOUR; i++) (state.tables.authRequest ??= []).push({ id: `r${i}`, kind: 'RESET_PASSWORD', userId: null, ipHash, createdAt: new Date() })
    expect((await join(1)).status).toBe(201)
    expect(state.tables.authToken ?? []).toHaveLength(0)
    // From a quiet address the link is made as usual
    expect((await join(2, '192.0.2.44')).status).toBe(201)
    expect(state.tables.authToken).toHaveLength(1)
  })
})

describe('booking', () => {
  const request = (listingId: string, day: number) => book(json('POST', { listingId, rentalMode: 'SHORT_STAY', checkIn: `2027-03-${String(day).padStart(2, '0')}`, checkOut: `2027-03-${String(day + 1).padStart(2, '0')}` }))

  beforeEach(() => {
    person(state, 'host', 'HOST')
    for (let i = 1; i <= 14; i++) home(state, `home${i}`, 'host', { instantBook: i % 2 === 1 })
    as(state, 'ama')
  })

  describe('when Postgres aborts the transaction', () => {
    afterEach(() => abortNextTransactions(0))

    it('runs it again, and the guest gets their dates', async () => {
      abortNextTransactions(SERIAL_RETRIES)
      const reply = await request('home1', 9)
      expect(reply.status).toBe(201)
      expect(state.tables.booking).toHaveLength(1)
    })

    it('says "busy, try again" when it is aborted every time, never that the dates are taken, and writes nothing', async () => {
      abortNextTransactions(SERIAL_RETRIES + 1)
      const reply = await request('home1', 9)
      expect(reply.status).toBe(503)
      expect(reply.headers.get('Retry-After')).toBe('2')
      expect((await reply.json()).error).toBe(BUSY_TRY_AGAIN)
      expect(state.tables.booking ?? []).toHaveLength(0)
      expect(state.tables.blockedDate ?? []).toHaveLength(0)
      // And the same guest can book the same dates a moment later
      expect((await request('home1', 9)).status).toBe(201)
    })

    it('still answers a real clash of dates with 409, at once', async () => {
      expect((await request('home1', 9)).status).toBe(201)
      person(state, 'kofi', 'GUEST', { email: 'kofi@example.test', passwordHash: null })
      as(state, 'kofi')
      const clash = await request('home1', 9)
      expect(clash.status).toBe(409)
      expect((await clash.json()).error).toMatch(/no longer available/)
    })

    it('counts the guest\'s open bookings inside the transaction, so two made at the same instant cannot both be under the limit', () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/bookings/route.ts'), 'utf8')
      const transaction = source.slice(source.indexOf('withSerialRetry(() => db.$transaction('), source.indexOf('TransactionIsolationLevel.Serializable'))
      expect(transaction.match(/tx\.booking\.count\(\{ where: \{ guestId/g)).toHaveLength(3)
      expect(source).not.toMatch(/db\.booking\.count\(\{ where: \{ guestId, (paymentStatus|createdAt)/)
    })
  })

  it('lets a guest hold 2 confirmed bookings that are not paid for, and no more', async () => {
    expect((await request('home1', 9)).status).toBe(201)   // instant: confirmed, waiting to be paid for
    expect((await request('home3', 9)).status).toBe(201)
    const third = await request('home5', 9)
    expect(third.status).toBe(429)
    expect((await third.json()).error).toBe(TOO_MANY_OPEN_BOOKINGS)
    expect(state.tables.booking).toHaveLength(2)
    // The third home's dates were never held
    expect((state.tables.blockedDate ?? []).filter((d) => d.listingId === 'home5')).toHaveLength(0)

    // Paying for one, or cancelling one, frees a place
    state.tables.booking[0].paymentStatus = 'PAID'
    expect((await request('home5', 9)).status).toBe(201)
    expect((await request('home7', 9)).status).toBe(429)
    state.tables.booking[1].status = 'CANCELLED'
    expect((await request('home7', 9)).status).toBe(201)
  })

  it('does not count requests a host has not answered towards the 2', async () => {
    for (const id of ['home2', 'home4', 'home6']) expect((await request(id, 9)).status).toBe(201)
    expect(state.tables.booking.every((b) => b.status === 'PENDING')).toBe(true)
    expect((await request('home1', 9)).status).toBe(201)
    expect((await request('home3', 9)).status).toBe(201)
    expect((await request('home5', 9)).status).toBe(429)
  })

  it('lets a guest have 5 requests waiting for an answer, and no more', async () => {
    for (const id of ['home2', 'home4', 'home6', 'home8', 'home10']) expect((await request(id, 9)).status).toBe(201)
    const sixth = await request('home12', 9)
    expect(sixth.status).toBe(429)
    expect((await sixth.json()).error).toBe(TOO_MANY_OPEN_REQUESTS)
    expect(state.tables.booking).toHaveLength(5)
    // An instant booking is still open to them
    expect((await request('home1', 9)).status).toBe(201)
    // A host answering one, either way, frees a place
    state.tables.booking[0].status = 'DECLINED'
    expect((await request('home12', 9)).status).toBe(201)
    expect((await request('home14', 9)).status).toBe(429)
    state.tables.booking[1].status = 'CONFIRMED'
    expect((await request('home14', 9)).status).toBe(201)
  })

  it('lets a guest make 10 bookings in an hour, however they end, and no more', async () => {
    for (let i = 0; i < LIMITS.bookingsPerHour; i++) {
      expect((await request('home1', 9 + i)).status).toBe(201)
      state.tables.booking[i].status = 'CANCELLED'
    }
    expect((await request('home1', 25)).status).toBe(429)
    forward(60 * MIN + 1000)
    expect((await request('home1', 25)).status).toBe(201)
  })

  it('does not count another guest\'s bookings', async () => {
    person(state, 'kofi')
    stay(state, 'b1', 'home1', 'kofi', 'host', { paymentStatus: 'UNPAID', checkIn: new Date('2027-04-01T12:00:00Z'), checkOut: new Date('2027-04-02T12:00:00Z') })
    stay(state, 'b2', 'home2', 'kofi', 'host', { paymentStatus: 'UNPAID', checkIn: new Date('2027-04-01T12:00:00Z'), checkOut: new Date('2027-04-02T12:00:00Z') })
    expect((await request('home3', 9)).status).toBe(201)
  })
})

describe('messages', () => {
  const write = (body: Row) => send(json('POST', body))

  beforeEach(() => {
    person(state, 'host', 'HOST')
    person(state, 'kofi')
    home(state, 'home', 'host')
    stay(state, 'booking', 'home', 'ama', 'host')
    as(state, 'ama')
  })

  it('a first message must be to the host of the home it is about, or the other person on a booking', async () => {
    // To a stranger, with nothing to connect them
    const res = await write({ receiverId: 'kofi', content: 'Hello' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: NO_REASON_TO_MESSAGE })
    // Naming a home does not help when the message is not to its host
    expect((await write({ receiverId: 'kofi', listingId: 'home', content: 'Hello' })).status).toBe(403)
    // A booking the receiver has no part in
    expect((await write({ receiverId: 'kofi', bookingId: 'booking', content: 'Hello' })).status).toBe(403)
    expect(state.tables.message ?? []).toHaveLength(0)

    expect((await write({ receiverId: 'host', listingId: 'home', content: 'Is it free in March?' })).status).toBe(201)
    expect((await write({ receiverId: 'host', bookingId: 'booking', content: 'What time can I arrive?' })).status).toBe(201)
  })

  it('lets someone reply to a person who wrote to them first', async () => {
    as(state, 'host')
    expect((await write({ receiverId: 'kofi', content: 'Hello' })).status).toBe(403)
    as(state, 'kofi')
    expect((await write({ receiverId: 'host', listingId: 'home', content: 'Is the flat near the beach?' })).status).toBe(201)
    as(state, 'host')
    expect((await write({ receiverId: 'kofi', listingId: 'home', content: 'Five minutes on foot.' })).status).toBe(201)
    expect((await write({ receiverId: 'kofi', content: 'Anything else?' })).status).toBe(201)
  })

  it('allows 30 messages an hour and no more', async () => {
    for (let i = 0; i < LIMITS.messagesPerHour; i++) expect((await write({ receiverId: 'host', listingId: 'home', content: `Message ${i}` })).status).toBe(201)
    expect((await write({ receiverId: 'host', listingId: 'home', content: 'One more' })).status).toBe(429)
    expect(state.tables.message).toHaveLength(LIMITS.messagesPerHour)
    forward(60 * MIN + 1000)
    expect((await write({ receiverId: 'host', listingId: 'home', content: 'One more' })).status).toBe(201)
  })

  it('forty messages sent at the same instant: no more than 30 are stored', async () => {
    const replies = await Promise.all(Array.from({ length: 40 }, (_, i) => write({ receiverId: 'host', listingId: 'home', content: `Message ${i}` })))
    const sent = replies.filter((r) => r.status === 201).length
    expect(sent).toBeLessThanOrEqual(LIMITS.messagesPerHour)
    expect(replies.filter((r) => r.status === 429)).toHaveLength(40 - sent)
    expect(state.tables.message ?? []).toHaveLength(sent)
    // One count per message stored
    expect((state.tables.authRequest ?? []).filter((r) => r.kind === 'MESSAGE_SENT')).toHaveLength(sent)
  })

  it('does not count a message that was not sent', async () => {
    for (let i = 0; i < 40; i++) expect((await write({ receiverId: 'host', listingId: 'home', content: 'call me on whatsapp' })).status).toBe(400)
    expect((state.tables.authRequest ?? []).filter((r) => r.kind === 'MESSAGE_SENT')).toHaveLength(0)
    expect((await write({ receiverId: 'host', listingId: 'home', content: 'Hello' })).status).toBe(201)
  })

  it('refuses a message that is too long, or not text', async () => {
    expect((await write({ receiverId: 'host', listingId: 'home', content: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).status).toBe(400)
    expect((await write({ receiverId: 'host', listingId: 'home', content: { $gt: '' } })).status).toBe(400)
    expect((await write({ receiverId: { id: 'host' }, listingId: 'home', content: 'Hello' })).status).toBe(400)
    expect((await write({ receiverId: 'host', listingId: ['home'], content: 'Hello' })).status).toBe(400)
    expect((await write({ receiverId: 'host', listingId: 'home', content: 'x'.repeat(MAX_MESSAGE_LENGTH) })).status).toBe(201)
  })
})

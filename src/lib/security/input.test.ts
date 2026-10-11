import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Row } from '@/lib/testing/fakeDb'
import type { State } from './harness'

// What a request may send: the right type, a sensible size, and nothing that
// can pass for something else once it is put in an email.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))

import { NOW, as, home, json, params, person, reset, stay } from './harness'
import { ACCOUNT_LIMITS, MAX_PASSWORD_LENGTH, manyLines, oneLine, parseText, parseTextList, parseWhole } from '@/lib/validate'
import { LISTING_LIMITS } from '@/lib/listingInput'
import { writeMessages } from '@/lib/messaging/notify'
import { emailHtml } from '@/lib/messaging/emailHtml'
import { resetPassword } from '@/lib/authTokens'
import { POST as createListing } from '@/app/api/listings/route'
import { PATCH as editListing } from '@/app/api/listings/[id]/route'
import { POST as book } from '@/app/api/bookings/route'
import { POST as review, PATCH as reply } from '@/app/api/reviews/route'
import { PATCH as profile } from '@/app/api/users/me/route'
import { POST as signUp } from '@/app/api/auth/signup/route'

const ch = (...codes: number[]) => String.fromCharCode(...codes)
/** A title that tries to add a paragraph of its own to an email: a blank line, then "Label: link" */
const HOSTILE = 'Sea view flat\n\nConfirm your account: https://evil.example/login\n\nThank you'
const NEW = { title: 'Flat by the sea', propertyType: 'Apartment', region: 'Greater Accra', city: 'Accra', bedrooms: 2, rentalModes: ['SHORT_STAY'], priceNightly: 100 }
const create = (over: Row) => createListing(json('POST', { ...NEW, ...over }))
const edit = (body: Row, id = 'home') => editListing(json('PATCH', body), params(id))

beforeEach(() => {
  reset(state)
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_URL', 'https://fiegh.com')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST')
  person(state, 'guest')
  as(state, 'host')
})

describe('cleaning text', () => {
  it('puts a one-line field on one line and takes out what cannot be seen', () => {
    expect(oneLine('  Sea   view\r\n\r\nflat\t now ')).toBe('Sea view flat now')
    expect(oneLine(HOSTILE)).toBe('Sea view flat Confirm your account: https://evil.example/login Thank you')
    // Line and paragraph separators, a zero-width space, a right-to-left override, a null byte
    expect(oneLine(`a${ch(0x2028)}b${ch(0x2029)}c`)).toBe('a b c')
    expect(oneLine(`pay${ch(0x200b)}pal${ch(0x202e)}moc${ch(0)}`)).toBe('paypalmoc')
    expect(manyLines(`one\r\ntwo\n\n\n\n\nthree${ch(0x200b)}`)).toBe('one\ntwo\n\nthree')
  })

  it('refuses the wrong type and the wrong size', () => {
    const title = { label: 'The title', max: 10, required: true }
    expect(parseText('Flat', title)).toEqual({ ok: true, value: 'Flat' })
    for (const bad of [42, true, ['Flat'], { $ne: '' }, 'x'.repeat(11), '   ', '', null, undefined]) expect(parseText(bad, title).ok, String(bad)).toBe(false)
    expect(parseText('', { label: 'Bio', max: 10 })).toEqual({ ok: true, value: null })
    expect(parseWhole('3', { label: 'Bedrooms', min: 1, max: 50 })).toEqual({ ok: true, value: 3 })
    for (const bad of ['three', 2.5, 0, 51, '1e3', true, [2]]) expect(parseWhole(bad, { label: 'Bedrooms', min: 1, max: 50 }).ok, String(bad)).toBe(false)
    expect(parseTextList(['Wi-Fi', ' Pool '], { label: 'Amenities', maxItems: 2, maxEach: 10 })).toEqual({ ok: true, value: ['Wi-Fi', 'Pool'] })
    for (const bad of ['Wi-Fi', [1], ['a', 'b', 'c'], ['x'.repeat(11)], { 0: 'a' }]) expect(parseTextList(bad, { label: 'Amenities', maxItems: 2, maxEach: 10 }).ok).toBe(false)
  })
})

describe('a listing a host writes', () => {
  it('a title is stored on one line, on a new listing and on an edit', async () => {
    expect((await create({ title: HOSTILE })).status).toBe(201)
    expect(state.tables.listing[0].title).toBe('Sea view flat Confirm your account: https://evil.example/login Thank you')
    home(state, 'home', 'host')
    expect((await edit({ title: HOSTILE, city: 'Accra\nGhana', neighbourhood: 'Osu\r\nRE' })).status).toBe(200)
    expect(state.tables.listing[1]).toMatchObject({ title: 'Sea view flat Confirm your account: https://evil.example/login Thank you', city: 'Accra Ghana', neighbourhood: 'Osu RE' })
  })

  it('a field of the wrong type or size is refused on a new listing', async () => {
    for (const over of [
      { title: { $ne: '' } }, { title: 'x'.repeat(LISTING_LIMITS.title + 1) }, { description: 'x'.repeat(LISTING_LIMITS.description + 1) }, { description: 42 },
      { city: ['Accra'] }, { bedrooms: 'many' }, { bedrooms: 0 }, { bedrooms: 2.5 }, { bathrooms: -1 }, { maxGuests: 1000 }, { minStayNights: 'a week' },
      { lat: 999 }, { lng: 'west' }, { rentalModes: ['FREE'] }, { rentalModes: 'SHORT_STAY' }, { amenities: 'Wi-Fi' }, { amenities: [{ name: 'Wi-Fi' }] },
      { rules: Array(31).fill('No parties') }, { instantBook: 'yes' }, { welcomeMessage: 'x'.repeat(LISTING_LIMITS.welcomeMessage + 1) },
    ]) {
      expect((await create(over)).status, JSON.stringify(over).slice(0, 60)).toBe(400)
    }
    expect(state.tables.listing ?? []).toHaveLength(0)
  })

  it('a field of the wrong type or size is refused on an edit, and changes nothing', async () => {
    home(state, 'home', 'host')
    const before = { ...state.tables.listing[0] }
    for (const over of [
      { title: '' }, { title: 42 }, { title: 'x'.repeat(LISTING_LIMITS.title + 1) }, { description: { html: '<b>' } }, { city: null }, { bedrooms: 'many' },
      { lat: 999 }, { rentalModes: ['FREE'] }, { amenities: 'Wi-Fi' }, { instantBook: 1 }, { minStayNights: 0 },
    ]) {
      expect((await edit({ ...over, neighbourhood: 'Changed' })).status, JSON.stringify(over).slice(0, 60)).toBe(400)
    }
    expect(state.tables.listing[0]).toEqual(before)
  })

  it('an edit can change only the fields a host owns: nothing else in the request is stored', async () => {
    home(state, 'home', 'host')
    person(state, 'other', 'HOST')
    const res = await edit({
      title: 'A new title', hostId: 'other', isFeatured: true, moderationHold: false, avgRating: 5, reviewCount: 99,
      photos: '["https://evil.example/x.jpg"]', id: 'hijacked', createdAt: '2020-01-01T00:00:00Z', digitalAddressChecked: true,
    })
    expect(res.status).toBe(200)
    expect(state.tables.listing[0]).toMatchObject({
      id: 'home', title: 'A new title', hostId: 'host', isFeatured: false, avgRating: 0, reviewCount: 0, photos: '[]', createdAt: NOW,
    })
    expect(state.tables.listing[0]).not.toHaveProperty('digitalAddressChecked')
  })

  it('keeps numbers as numbers and lists as lists', async () => {
    home(state, 'home', 'host')
    expect((await edit({ bedrooms: '3', lat: '5.56', lng: -0.19, amenities: ['Wi-Fi', ' Pool '], rentalModes: ['SHORT_STAY', 'TEMP_STAY', 'SHORT_STAY'], instantBook: false })).status).toBe(200)
    expect(state.tables.listing[0]).toMatchObject({ bedrooms: 3, lat: 5.56, lng: -0.19, amenities: '["Wi-Fi","Pool"]', rentalModes: '["SHORT_STAY","TEMP_STAY"]', instantBook: false })
  })
})

describe('an email about a listing whose title tries to add its own button', () => {
  it('has one button, ours, and the title sits inside a sentence', async () => {
    // As if the title had been stored before titles were cleaned
    home(state, 'home', 'host', { title: HOSTILE })
    stay(state, 'booking', 'home', 'guest', 'host')
    const result = await writeMessages('booking.confirmed', { bookingId: 'booking' })
    expect(result.failed).toBe(false)
    const emails = state.tables.messageLog.filter((m) => m.channel === 'EMAIL')
    expect(emails).toHaveLength(2)
    for (const email of emails) {
      const html = emailHtml(email.subject as string, email.body as string)
      const buttons = [...html.matchAll(/<a href="([^"]+)" style="background:/g)].map((m) => m[1])
      expect(buttons).toHaveLength(1)
      expect(buttons[0].startsWith('https://fiegh.com/')).toBe(true)
      expect(html).not.toMatch(/href="https:\/\/evil\.example/)
      expect(email.subject as string).not.toMatch(/[\r\n]/)
      // No paragraph of the stored text is the attacker's "Label: link"
      expect((email.body as string).split(/\n{2,}/).some((p) => /^Confirm your account: https:\/\/evil/.test(p))).toBe(false)
    }
  })
})

describe('reviews', () => {
  const post = (over: Row) => review(json('POST', { bookingId: 'booking', rating: 5, comment: 'A lovely stay.', type: 'GUEST_TO_HOST', ...over }))
  beforeEach(() => {
    home(state, 'home', 'host')
    stay(state, 'booking', 'home', 'guest', 'host', { status: 'COMPLETED' })
    as(state, 'guest')
  })

  it('a rating must be a whole number of stars from 1 to 5', async () => {
    for (const rating of ['abc', '5', 4.5, 0, 6, true, [5], { gte: 1 }, NaN]) expect((await post({ rating })).status, String(rating)).toBe(400)
    expect(state.tables.review ?? []).toHaveLength(0)
    expect((await post({ rating: 4 })).status).toBe(201)
  })

  it('a review or a reply that is too long, or not text, is refused', async () => {
    expect((await post({ comment: 'x'.repeat(2001) })).status).toBe(400)
    expect((await post({ comment: { text: 'hi' } })).status).toBe(400)
    expect((await post({ bookingId: { not: '' } })).status).toBe(400)
    expect((await post({})).status).toBe(201)
    as(state, 'host')
    const id = state.tables.review[0].id
    expect((await reply(json('PATCH', { reviewId: id, hostReply: 'x'.repeat(1001) }))).status).toBe(400)
    expect((await reply(json('PATCH', { reviewId: id, hostReply: { $set: 'x' } }))).status).toBe(400)
    expect((await reply(json('PATCH', { reviewId: { not: '' }, hostReply: 'Thanks' }))).status).toBe(404)
    expect((await reply(json('PATCH', { reviewId: id, hostReply: 'Thank you for staying.' }))).status).toBe(200)
    expect(state.tables.review[0].hostReply).toBe('Thank you for staying.')
  })
})

describe('a booking request', () => {
  const request = (over: Row) => book(json('POST', { listingId: 'home', rentalMode: 'SHORT_STAY', checkIn: '2027-03-09', checkOut: '2027-03-10', ...over }))
  beforeEach(() => { home(state, 'home', 'host'); as(state, 'guest') })

  it('special requests that are too long, and ids that are not text, are refused', async () => {
    expect((await request({ specialRequests: 'x'.repeat(1001) })).status).toBe(400)
    expect((await request({ specialRequests: ['a'] })).status).toBe(400)
    expect((await request({ listingId: { not: '' } })).status).toBe(400)
    expect((await request({ checkIn: 20270309 })).status).toBe(400)
    expect(state.tables.booking ?? []).toHaveLength(0)
    expect((await request({ specialRequests: ' A late arrival,\r\nplease. ' })).status).toBe(201)
    expect(state.tables.booking[0].specialRequests).toBe('A late arrival,\nplease.')
  })
})

describe('what people type about themselves', () => {
  const save = (over: Row) => profile(json('PATCH', { name: 'Ama Owusu', ...over }))
  beforeEach(() => as(state, 'guest'))

  it('a profile field of the wrong type or size is refused', async () => {
    for (const over of [
      { name: { first: 'Ama' } }, { name: 'x'.repeat(ACCOUNT_LIMITS.name + 1) }, { name: '  ' }, { bio: 'x'.repeat(ACCOUNT_LIMITS.bio + 1) }, { bio: 7 },
      { nationality: ['Ghanaian'] }, { nationality: 'x'.repeat(ACCOUNT_LIMITS.nationality + 1) }, { businessName: 'x'.repeat(ACCOUNT_LIMITS.businessName + 1) }, { phone: 244123456 },
    ]) {
      expect((await save(over)).status, JSON.stringify(over).slice(0, 50)).toBe(400)
    }
    expect((await save({ name: 'Ama\nOwusu', bio: ' Hello.\r\nI travel a lot. ' })).status).toBe(200)
    expect(state.tables.user.find((u) => u.id === 'guest')).toMatchObject({ name: 'Ama Owusu', bio: 'Hello.\nI travel a lot.' })
  })

  it('a profile update cannot change a role, the ID flag or anything else it does not name', async () => {
    expect((await save({ role: 'ADMIN', isVerified: true, trustScore: 100, isSuperhost: true, email: 'taken@example.test', emailVerifiedAt: null, passwordHash: 'x' })).status).toBe(200)
    expect(state.tables.user.find((u) => u.id === 'guest')).toMatchObject({ role: 'GUEST', isVerified: false, trustScore: 0, isSuperhost: false, email: 'guest@example.test', passwordHash: null })
  })

  it('a sign-up field of the wrong type or size is refused, and a role of ADMIN is ignored', async () => {
    const join = (over: Row) => signUp(json('POST', { name: 'Kofi Mensah', email: 'kofi@example.test', password: 'a long password', ...over }))
    for (const over of [
      { name: { $ne: '' } }, { name: 'x'.repeat(ACCOUNT_LIMITS.name + 1) }, { password: ['a long password'] }, { password: 'x'.repeat(MAX_PASSWORD_LENGTH + 1) },
      { email: { $ne: '' } }, { phone: 244123456, email: undefined }, { nationality: 5 },
    ]) {
      expect((await join(over)).status, JSON.stringify(over).slice(0, 50)).toBe(400)
    }
    expect(state.tables.user.some((u) => u.email === 'kofi@example.test')).toBe(false)
    expect((await join({ role: 'ADMIN', name: 'Kofi\nMensah' })).status).toBe(201)
    expect(state.tables.user.find((u) => u.email === 'kofi@example.test')).toMatchObject({ role: 'GUEST', name: 'Kofi Mensah' })
  })

  it('a new password longer than any real one is refused before the link is used up', async () => {
    const result = await resetPassword('a'.repeat(43), 'x'.repeat(MAX_PASSWORD_LENGTH + 1))
    // Refused for its length, not for the link: the link is never looked up
    expect(result).toEqual({ ok: false, status: 400, error: `Password can be at most ${MAX_PASSWORD_LENGTH} characters` })
  })
})

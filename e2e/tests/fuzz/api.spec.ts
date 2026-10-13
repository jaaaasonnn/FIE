import fs from 'fs'
import path from 'path'
import fc from 'fast-check'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { measured } from '../../lib/race'
import { call, type Actor, type Reply, type World } from '../../lib/world'

// Hostile input to every route that takes any: wrong types, huge and tiny
// numbers, enormous strings, emoji, null bytes, nested objects, nonsense
// dates, broken JSON, oversized and mislabelled files.
//
// The rule for every answer: a 4xx with a plain reason (or a 2xx if the input
// happened to be acceptable). Never a 5xx, never a stack trace or anything
// from inside the server, never no answer at all.
//
// The seed is printed, so a failing run can be repeated: E2E_FUZZ_SEED=<seed>.

const RUNS = Number(process.env.E2E_FUZZ_RUNS ?? 40)
const SEED = Number(process.env.E2E_FUZZ_SEED ?? Date.now() % 2_000_000_000)
const LEAK = /at .*\(.*:\d+:\d+\)|node_modules|PrismaClient|prisma\.|Invalid `|sk_test|ECONNREFUSED|postgres(ql)?:\/\/|\bstack\b|SELECT .* FROM|syntax error/i

const hostile: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(null, true, false, 0, -1, 1, -0.01, 0.1 + 0.2, 1e308, -1e308, 2 ** 53 + 2, -(2 ** 53), 1e-9, '', ' ', '0', '-1', 'NaN', 'Infinity', 'null', 'undefined', 'true', '[]', '{}'),
  fc.constantFrom('\u0000', 'a\u0000b', '﻿', '‮evil', '😀'.repeat(40), 'ﷺ'.repeat(200), 'Ａｄｍｉｎ', "' OR 1=1 --", '"; DROP TABLE "User"; --', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '../../../etc/passwd', '%00', '{{7*7}}', '${7*7}', 'javascript:alert(1)', 'https://evil.example/x', 'View: https://evil.example/pay'),
  fc.constantFrom('2027-02-30', '9999-12-31', '0000-00-00', '1970-01-01', '2027-13-01', '2027-03-09T25:00:00Z', 'yesterday', '2027-03-09', '2024-02-29', '2027-02-29'),
  fc.constantFrom('x'.repeat(10_000), 'x'.repeat(200_000), 'é'.repeat(50_000)),
  fc.string({ maxLength: 60 }), fc.string({ unit: 'grapheme', maxLength: 30 }),
  fc.integer(), fc.double(), fc.bigInt({ min: -(BigInt(10) ** BigInt(30)), max: BigInt(10) ** BigInt(30) }).map(String),
  fc.array(fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.constant(null)), { maxLength: 6 }),
  fc.dictionary(fc.string({ maxLength: 8 }), fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.constant(null)), { maxKeys: 4 }),
  fc.constant({ $gt: '' }), fc.constant({ constructor: { prototype: { admin: true } } }), fc.constant([[[[[[[[[[]]]]]]]]]]),
)
/** A body for a route: each known field is sometimes right, mostly hostile, sometimes missing; plus fields that should not be there. */
const bodyFor = (valid: Record<string, unknown>) => fc.record(
  { ...Object.fromEntries(Object.entries(valid).map(([key, value]) => [key, fc.oneof({ weight: 2, arbitrary: fc.constant(value) }, { weight: 5, arbitrary: hostile })])), role: hostile, id: hostile, isAdmin: hostile, hostId: hostile, guestId: hostile, status: hostile, paymentStatus: hostile, totalPrice: hostile, isVerified: hostile },
  { requiredKeys: [] },
)

const KNOWN_F14 = ['/api/payments', '/api/wishlists', '/api/notifications', '/api/users/me/payout-method']
type Route = { name: string; method: string; path: string; as: Actor | null; valid: Record<string, unknown> }
const bad: string[] = []
function judge(route: Route, sent: unknown, reply: Reply) {
  const what = `${route.method} ${route.name} -> ${reply.status}`
  const shown = JSON.stringify(sent)?.slice(0, 300)
  if (reply.status === 0) bad.push(`NO ANSWER in 20 s: ${what} for ${shown}`)
  else if (reply.status >= 500) bad.push(`${what} ${reply.text.slice(0, 120)} for ${shown}`)
  else if (LEAK.test(reply.text.slice(0, 4000))) bad.push(`LEAK: ${what} ${LEAK.exec(reply.text)?.[0]} for ${shown}`)
}

async function routes(world: World): Promise<Route[]> {
  const admin = await world.admin()
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const request = await world.listing(host, { instantBook: false })
  const booking = await world.mustBook(guest, home.id)
  const requested = await world.mustBook(guest, request.id)
  const dates = world.dates(2)
  return [
    { name: '/api/auth/signup', method: 'POST', path: '/api/auth/signup', as: null, valid: { name: 'E2E Fuzz', email: 'e2e-fuzz@fiegh.test', password: 'Fuzz-pass-12345', role: 'GUEST', phone: '0241234567' } },
    { name: '/api/auth/signin', method: 'POST', path: '/api/auth/signin', as: null, valid: { identifier: guest.email, password: 'wrong' } },
    { name: '/api/auth/forgot-password', method: 'POST', path: '/api/auth/forgot-password', as: null, valid: { email: guest.email } },
    { name: '/api/auth/reset-password', method: 'POST', path: '/api/auth/reset-password', as: null, valid: { token: 'x'.repeat(43), password: 'Fuzz-pass-12345' } },
    { name: '/api/auth/confirm-email', method: 'POST', path: '/api/auth/confirm-email', as: null, valid: { token: 'x'.repeat(43) } },
    { name: '/api/auth/resend-verification', method: 'POST', path: '/api/auth/resend-verification', as: guest, valid: {} },
    { name: '/api/auth/signout', method: 'POST', path: '/api/auth/signout', as: null, valid: { everywhere: true } },
    { name: '/api/webhooks/paystack (unsigned)', method: 'POST', path: '/api/webhooks/paystack', as: null, valid: { event: 'charge.success', data: { reference: 'x', status: 'success', amount: 1 } } },
    { name: '/api/bookings', method: 'POST', path: '/api/bookings', as: guest, valid: { listingId: home.id, rentalMode: 'SHORT_STAY', ...dates, specialRequests: 'none', nightsOrMonths: 2 } },
    { name: '/api/bookings/[id] (guest)', method: 'PATCH', path: `/api/bookings/${requested}`, as: guest, valid: { action: 'cancel', expectedRefund: 0, reason: 'OTHER', note: 'x', preview: true, expectedEnd: '2027-03-09' } },
    { name: '/api/bookings/[id] (host)', method: 'PATCH', path: `/api/bookings/${requested}`, as: host, valid: { action: 'accept', expectedRefund: 0, reason: 'OTHER', note: 'x', preview: true } },
    { name: '/api/payments', method: 'POST', path: '/api/payments', as: guest, valid: { bookingId: requested, method: 'CARD', instalmentId: 'x' } },
    { name: '/api/messages', method: 'POST', path: '/api/messages', as: guest, valid: { receiverId: host.id, listingId: home.id, bookingId: booking, content: 'hello' } },
    { name: '/api/reviews', method: 'POST', path: '/api/reviews', as: guest, valid: { bookingId: booking, rating: 5, comment: 'fine', type: 'GUEST_TO_HOST' } },
    { name: '/api/reviews (reply)', method: 'PATCH', path: '/api/reviews', as: host, valid: { reviewId: 'x', hostReply: 'thanks' } },
    { name: '/api/wishlists', method: 'POST', path: '/api/wishlists', as: guest, valid: { listingId: home.id } },
    { name: '/api/wishlists (delete)', method: 'DELETE', path: '/api/wishlists', as: guest, valid: { listingId: home.id } },
    { name: '/api/notifications', method: 'PATCH', path: '/api/notifications', as: guest, valid: { id: 'x' } },
    { name: '/api/users/me', method: 'PATCH', path: '/api/users/me', as: guest, valid: { name: 'E2E Fuzz', bio: 'hello', nationality: 'Ghanaian', businessName: 'x', phone: '0241234567', email: 'x@fiegh.test', optionalEmails: true } },
    { name: '/api/users/me/password', method: 'POST', path: '/api/users/me/password', as: guest, valid: { currentPassword: 'wrong-on-purpose', newPassword: 'Fuzz-pass-12345' } },
    { name: '/api/users/me/email', method: 'POST', path: '/api/users/me/email', as: guest, valid: { email: 'e2e-fuzz-new@fiegh.test', password: 'wrong-on-purpose' } },
    { name: '/api/bookings/[id]/disputes', method: 'POST', path: `/api/bookings/${booking}/disputes`, as: guest, valid: { reason: 'NO_ACCESS', description: 'Nobody was there to let us in at all.' } },
    { name: '/api/disputes/[id]', method: 'POST', path: '/api/disputes/not-a-dispute', as: host, valid: { response: 'That is not what happened.' } },
    { name: '/api/listings', method: 'POST', path: '/api/listings', as: host, valid: { title: 'E2E fuzz home', description: 'A flat made by the fuzz test and removed afterwards.', propertyType: 'Apartment', region: 'Central', city: 'Cape Coast', neighbourhood: 'Pedu', bedrooms: 2, bathrooms: 1, maxGuests: 2, rentalModes: ['SHORT_STAY'], priceNightly: 80, priceMonthly: 600, priceAnnual: 6000, damageDeposit: 50, instantBook: true, lat: 5.1, lng: -1.2, amenities: ['wifi'], rules: ['no smoking'], photos: [], cancellationPolicy: 'MODERATE', minStayNights: 1, advanceMonthsRequired: 3, digitalAddress: 'GA-183-8164' } },
    { name: '/api/listings/[id]', method: 'PATCH', path: `/api/listings/${home.id}`, as: host, valid: { title: 'E2E fuzz home', priceNightly: 80, damageDeposit: 50, isActive: true, moderationHold: false, isFeatured: true, avgRating: 5, digitalAddress: 'GA-183-8164', lat: 5.1, lng: -1.2, bedrooms: 2, rentalModes: ['SHORT_STAY'], cancellationPolicy: 'STRICT' } },
    { name: '/api/listings/[id]/blocked-dates', method: 'POST', path: `/api/listings/${home.id}/blocked-dates`, as: host, valid: { start: dates.checkIn, end: dates.checkOut, note: 'x' } },
    { name: '/api/listings/[id]/blocked-dates (delete)', method: 'DELETE', path: `/api/listings/${home.id}/blocked-dates`, as: host, valid: { start: dates.checkIn, end: dates.checkOut } },
    { name: '/api/users/me/payout-method', method: 'POST', path: '/api/users/me/payout-method', as: host, valid: { password: 'wrong-on-purpose', payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: '0241234567', payoutBankCode: '999001', payoutBankAccountNumber: '1234567890' } },
    { name: '/api/verifications (decide)', method: 'PATCH', path: '/api/verifications', as: admin, valid: { verificationId: 'x', status: 'REJECTED', notes: 'x' } },
    { name: '/api/admin', method: 'POST', path: '/api/admin', as: admin, valid: { type: 'exchange-rate', usdToGhs: 15.5, rate: 15.5, listingId: home.id, action: 'hold' } },
    { name: '/api/admin/users', method: 'POST', path: '/api/admin/users', as: admin, valid: { userId: 'not-a-user', action: 'suspend', reason: 'A reason long enough to be accepted.' } },
    { name: '/api/admin/disputes', method: 'POST', path: '/api/admin/disputes', as: admin, valid: { disputeId: 'x', action: 'decide', outcome: 'FULL_REFUND', amount: 10, resolution: 'x'.repeat(30), note: 'x', dryRun: true } },
    { name: '/api/admin/rent', method: 'POST', path: '/api/admin/rent', as: admin, valid: { action: 'cover', instalmentId: 'x', dryRun: true } },
    { name: '/api/admin/listing-checks', method: 'POST', path: '/api/admin/listing-checks', as: admin, valid: { listingId: home.id, action: 'mark', method: 'VISIT', checks: ['ADDRESS_MATCHES'], note: 'x'.repeat(30), reason: 'x' } },
  ]
}

test.describe('hostile input', () => {
  test('every route that takes a body answers hostile input with a 4xx, never a 5xx, a leak or silence', async ({ world }) => {
    test.setTimeout(900_000)
    const all = await routes(world)
    console.log(`  fuzz seed ${SEED}, ${RUNS} bodies per route, ${all.length} routes`)
    let sent = 0
    for (const route of all) {
      await fc.assert(fc.asyncProperty(bodyFor(route.valid), async (body) => {
        const reply = route.as ? await route.as.call(route.method, route.path, body, { timeoutMs: 20_000 }) : await call(route.method, route.path, body, { timeoutMs: 20_000 })
        sent++
        judge(route, body, reply)
      }), { numRuns: RUNS, seed: SEED, endOnFailure: true })
    }
    measured(`${sent} hostile bodies sent to ${all.length} routes; ${bad.length} answered wrongly`)
    fs.mkdirSync(path.join(__dirname, '../../.reports'), { recursive: true })
    fs.writeFileSync(path.join(__dirname, '../../.reports/fuzz-bodies.json'), JSON.stringify({ seed: SEED, sent, bad }, null, 1))
    // Nothing a body said made anyone an admin, or changed what a booking costs
    const people = await db.user.findMany({ where: { id: { in: world.people.map((p) => p.id) } }, select: { id: true, role: true, isVerified: true } })
    for (const person of world.people) expect(people.find((p) => p.id === person.id)?.role, `${person.email} is still a ${person.role}`).toBe(person.role)
    expect(await db.user.count({ where: { email: { startsWith: 'e2e-fuzz' }, role: 'ADMIN' } })).toBe(0)
    await expectInvariants()
    // Accounts the sign-up route did make from an acceptable body are removed with the rest at the end of the run.
    // Four routes are known to answer 500 to a wrong type (finding F14, tested on its own below): everything else must be clean.
    const elsewhere = bad.filter((b) => !KNOWN_F14.some((route) => b.includes(route)))
    expect([...new Set(elsewhere.map((b) => b.replace(/ for .*/, '')))].slice(0, 40), `${elsewhere.length} wrong answers; examples in e2e/.reports/fuzz-bodies.json`).toEqual([])
  })

  test('a wrong type in the body is answered 400 by payments, wishlists, notifications and the payout method', async ({ world }) => {
    test.fail(true, 'F14: these four routes pass a value of the wrong type straight to the database or to bcrypt and answer 500')
    const host = await world.host()
    const guest = await world.guest()
    const replies = [
      await guest.call('POST', '/api/payments', { bookingId: [1, 2], method: 'CARD' }),
      await guest.call('POST', '/api/wishlists', { listingId: 24 }),
      await guest.call('PATCH', '/api/notifications', { id: -1 }),
      await host.call('POST', '/api/users/me/payout-method', { password: 12345, payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: '0241234567' }),
    ]
    expect(replies.map((r) => r.status)).toEqual([400, 400, 400, 400])
  })

  test('bodies that are not JSON at all', async ({ world }) => {
    test.fail(true, 'F14: seven routes answer 500, not 400, to a body that is empty or is not JSON')
    const guest = await world.guest()
    const wrong: string[] = []
    const raws: [string, string, Record<string, string>?][] = [
      ['empty', ''], ['not JSON', 'hello'], ['cut short', '{"listingId":"x"'], ['a number', '42'], ['null', 'null'], ['an array', '[1,2,3]'], ['a string', '"x"'],
      ['deeply nested', '['.repeat(20_000) + ']'.repeat(20_000)], ['one megabyte', JSON.stringify({ a: 'x'.repeat(1_000_000) })], ['five megabytes', JSON.stringify({ a: 'x'.repeat(5_000_000) })],
      ['a form instead', 'listingId=x&rentalMode=SHORT_STAY', { 'content-type': 'application/x-www-form-urlencoded' }], ['XML', '<a/>', { 'content-type': 'application/xml' }],
      ['duplicate keys', '{"action":"cancel","action":"accept"}'], ['a huge number', '{"rating":1e999}'], ['invalid UTF-8 escapes', '{"content":"\\ud800"}'],
    ]
    for (const path of ['/api/bookings', '/api/messages', '/api/reviews', '/api/payments', '/api/users/me', '/api/auth/signin', '/api/auth/signup', '/api/webhooks/paystack']) {
      for (const [name, raw, headers] of raws) {
        const method = path === '/api/users/me' ? 'PATCH' : 'POST'
        const reply = await guest.call(method, path, undefined, { raw, headers, timeoutMs: 20_000 })
        if (reply.status === 0 || reply.status >= 500 || LEAK.test(reply.text.slice(0, 4000))) wrong.push(`${method} ${path} with ${name}: ${reply.status} ${reply.text.slice(0, 100)}`)
      }
    }
    measured(`raw bodies: ${wrong.length} wrong answers of ${8 * raws.length}`)
    expect(wrong).toEqual([])
  })

  test('query strings: wrong types, huge values, nonsense dates', async ({ world }) => {
    const guest = await world.guest()
    const wrong: string[] = []
    await fc.assert(fc.asyncProperty(
      fc.constantFrom('/api/listings', '/api/listings/region-counts', '/api/bookings', '/api/reviews', '/api/messages', '/api/payments', '/api/notifications', '/api/exchange-rate', '/api/payouts', '/api/wishlists'),
      fc.dictionary(fc.constantFrom('page', 'limit', 'mode', 'region', 'city', 'minPrice', 'maxPrice', 'bedrooms', 'checkIn', 'checkOut', 'months', 'hostId', 'guestId', 'id', 'listingId', 'featured', 'checked', 'mine', 'revieweeId', 'with', 'bookingId'), hostile.map((v) => (typeof v === 'string' ? v.slice(0, 3000) : JSON.stringify(v) ?? '')), { maxKeys: 6 }),
      async (path, raw) => {
        // Two known gaps in the search route (finding F15) are tested on their own below, so they are kept out of this run
        const query = Object.fromEntries(Object.entries(raw).filter(([key, value]) => !(path === '/api/listings' && key === 'bedrooms') && !value.includes('\u0000')))
        const reply = await guest.call('GET', `${path}?${new URLSearchParams(query)}`, undefined, { timeoutMs: 20_000 })
        if (reply.status === 0 || reply.status >= 500 || LEAK.test(reply.text.slice(0, 4000))) wrong.push(`GET ${path}?${new URLSearchParams(query).toString().slice(0, 200)}: ${reply.status} ${reply.text.slice(0, 100)}`)
      }), { numRuns: RUNS * 6, seed: SEED, endOnFailure: true })
    fs.writeFileSync(path.join(__dirname, '../../.reports/fuzz-queries.json'), JSON.stringify({ seed: SEED, wrong }, null, 1))
    measured(`query strings: ${wrong.length} wrong answers of ${RUNS * 6}`)
    expect(wrong.slice(0, 20)).toEqual([])
  })

  test('search answers 400, not 500, to a bedroom count that is not a number and to a null byte', async () => {
    test.fail(true, 'F15: search answers 500 to bedrooms=abc, and search and the reviews list answer 500 to a null byte')
    const replies = await Promise.all(['/api/listings?bedrooms=abc', '/api/listings?mode=%00', '/api/listings?city=%00', '/api/reviews?listingId=%00'].map((url) => call('GET', url)))
    expect(replies.map((r) => r.status)).toEqual([400, 400, 400, 400])
  })

  test('five photos uploaded at the same moment are all kept', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    const real = fs.readFileSync(path.join(__dirname, '../../fixtures/photo.jpg'))
    let kept = 5, said = 5
    // Ten times over: every upload that says it succeeded is on the listing
    for (let round = 0; round < 10 && kept === said; round++) {
      await db.listing.update({ where: { id: home.id }, data: { photos: '[]' } })
      const replies = await Promise.all(Array.from({ length: 5 }, (_, i) => { const f = new FormData(); f.append('photos', new File([real], `c${i}.jpg`, { type: 'image/jpeg' })); return host.call('POST', `/api/listings/${home.id}/photos`, undefined, { form: f, server: (i % 2) as 0 | 1 }) }))
      said = replies.filter((r) => r.status < 300).length
      kept = JSON.parse((await db.listing.findUniqueOrThrow({ where: { id: home.id } })).photos).length
    }
    measured(`${said} uploads said they succeeded; the listing kept ${kept} photos`)
    expect(said).toBe(5)
    expect(kept).toBe(said)
  })

  test('uploads: oversized, mislabelled, empty and many at once', async ({ world }) => {
    test.setTimeout(300_000)
    const host = await world.host({ idApproved: false })
    const home = await world.listing(host)
    const real = fs.readFileSync(path.join(__dirname, '../../fixtures/photo.jpg'))
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    const files: [name: string, file: File, mustRefuse: boolean][] = [
      ['a script called .jpg', new File([Buffer.from('<?php system($_GET[1]); ?>')], 'shell.jpg', { type: 'image/jpeg' }), true],
      ['HTML called .png', new File([Buffer.from('<html><script>alert(1)</script></html>')], 'page.png', { type: 'image/png' }), true],
      ['an SVG with a script', new File([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')], 'x.svg', { type: 'image/svg+xml' }), true],
      ['a JPEG that says it is a PNG', new File([real], 'photo.png', { type: 'image/png' }), true],
      ['an empty file', new File([], 'empty.jpg', { type: 'image/jpeg' }), true],
      ['a JPEG header and then rubbish, 12 MB', new File([jpegHeader, Buffer.alloc(12 * 1024 * 1024, 1)], 'big.jpg', { type: 'image/jpeg' }), true],
      ['a path as a file name', new File([real], '../../../../etc/passwd.jpg', { type: 'image/jpeg' }), false],
      ['a 2,000 character file name', new File([real], `${'a'.repeat(2000)}.jpg`, { type: 'image/jpeg' }), false],
    ]
    const targets: [name: string, path: string, field: string, extra?: Record<string, string>][] = [
      ['listing photos', `/api/listings/${home.id}/photos`, 'photos'], ['profile photo', '/api/users/me/photo', 'photo'], ['ID document', '/api/verifications', 'idPhoto', { idType: 'GHANA_CARD' }],
    ]
    const wrong: string[] = []
    for (const [target, url, field, extra] of targets) {
      for (const [name, file, mustRefuse] of files) {
        const form = new FormData(); form.append(field, file); for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v)
        const reply = await host.call('POST', url, undefined, { form, timeoutMs: 60_000 })
        if (reply.status === 0 || reply.status >= 500 || LEAK.test(reply.text.slice(0, 4000))) wrong.push(`${target}, ${name}: ${reply.status} ${reply.text.slice(0, 100)}`)
        else if (mustRefuse && reply.status < 400) wrong.push(`${target}, ${name}: ACCEPTED (${reply.status})`)
      }
    }
    // Nothing that was refused was stored, and nothing was stored outside the person's own folder
    const stored = [...await fakes.files(home.id), ...await fakes.files(host.id)]
    for (const key of stored) expect(key).not.toMatch(/\.\.|etc\/passwd|\.svg|\.php|shell|page\.png/)
    // Thirty photos in one request, and five requests at once
    const many = new FormData(); for (let i = 0; i < 30; i++) many.append('photos', new File([real], `p${i}.jpg`, { type: 'image/jpeg' }))
    const flood = await host.call('POST', `/api/listings/${home.id}/photos`, undefined, { form: many, timeoutMs: 60_000 })
    if (flood.status === 0 || flood.status >= 500) wrong.push(`30 photos in one request: ${flood.status} ${flood.text.slice(0, 100)}`)
    const together = await Promise.all(Array.from({ length: 5 }, (_, i) => { const f = new FormData(); f.append('photos', new File([real], `c${i}.jpg`, { type: 'image/jpeg' })); return host.call('POST', `/api/listings/${home.id}/photos`, undefined, { form: f, server: (i % 2) as 0 | 1, timeoutMs: 60_000 }) }))
    for (const r of together) if (r.status === 0 || r.status >= 500) wrong.push(`5 uploads at once: ${r.status} ${r.text.slice(0, 100)}`)
    const photos: string[] = JSON.parse((await db.listing.findUniqueOrThrow({ where: { id: home.id } })).photos)
    measured(`uploads: ${wrong.length} wrong answers; the listing ended with ${photos.length} photos after 30-at-once (${flood.status}) and 5 uploads together (${together.map((r) => r.status)}), ${together.filter((r) => r.status < 300).length} of which said they succeeded`)
    expect(wrong).toEqual([])
  })
})

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { call, cron, type Actor } from '../../lib/world'

// A host's side: the ID and its approval, the "address and photos checked"
// badge, the calendar, and what happens after the stay (completion, reviews, messages).

const DAY = 86_400_000
const jpeg = () => new File([fs.readFileSync(path.join(__dirname, '../../fixtures/photo.jpg'))], 'photo.jpg', { type: 'image/jpeg' })

test.describe('host ID', () => {
  test('a host sends an ID; an admin approves it; only then is the host payable and the badge shown', async ({ world, page }) => {
    const admin = await world.admin()
    const host = await world.host({ idApproved: false })
    const form = new FormData(); form.append('idType', 'GHANA_CARD'); form.append('idPhoto', jpeg()); form.append('selfie', jpeg())
    const sent = await host.call('POST', '/api/verifications', undefined, { form })
    expect(sent.status, sent.text).toBeLessThan(300)
    const row = await db.verification.findUniqueOrThrow({ where: { userId: host.id } })
    expect(row).toMatchObject({ status: 'PENDING', reviewedById: null })
    // The document is in the private bucket, never at a public address
    expect((await fakes.files(`verification-docs/${host.id}/`)).length).toBeGreaterThanOrEqual(1)
    expect(row.idPhotoUrl).not.toContain('/object/public/')
    // Nobody but an admin can read it or decide it
    const stranger = await world.guest()
    for (const who of [host, stranger]) expect((await who.call('PATCH', '/api/verifications', { verificationId: row.id, status: 'APPROVED' })).status).toBe(403)
    expect((await stranger.call('GET', '/api/admin/verifications')).status).toBe(403)
    const listed = await admin.call('GET', '/api/admin/verifications')
    expect(listed.text).toContain('/object/sign/verification-docs/')

    expect((await admin.call('PATCH', '/api/verifications', { verificationId: row.id, status: 'APPROVED' })).status).toBe(200)
    expect(await db.verification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'APPROVED', reviewedById: admin.id })
    expect((await db.user.findUniqueOrThrow({ where: { id: host.id } })).isVerified).toBe(true)
    await host.mail(/ID/)
    // The public badge, and nothing else about the ID, is on the host's profile
    const home = await world.listing(host)
    await page.goto(`/listings/${home.id}`)
    await expect(page.getByText(/Host ID checked/).first()).toBeVisible()
    await expect(page.getByText(/\bverified\b/i)).toHaveCount(0)
  })

  test('an upload that only claims to be an image is refused, and nothing is stored', async ({ world }) => {
    const host = await world.host({ idApproved: false })
    const form = new FormData(); form.append('idType', 'GHANA_CARD'); form.append('idPhoto', new File([Buffer.from('<?php echo 1; ?>')], 'id.jpg', { type: 'image/jpeg' }))
    const sent = await host.call('POST', '/api/verifications', undefined, { form })
    expect(sent.status).toBe(400)
    expect(await db.verification.count({ where: { userId: host.id } })).toBe(0)
    expect(await fakes.files(`verification-docs/${host.id}/`)).toHaveLength(0)
  })
})

test.describe('"Address and photos checked"', () => {
  async function checkable(world: import('../../lib/world').World) {
    const admin = await world.admin()
    const host = await world.host()
    const home = await world.listing(host)
    await db.listing.update({ where: { id: home.id }, data: { digitalAddress: 'GA-183-8164', photos: JSON.stringify(['https://images.unsplash.com/photo-1506126208421-3345d63a05d8?w=1200&q=80']) } })
    const mark = (who: Actor, over: Record<string, unknown> = {}) => who.call('POST', '/api/admin/listing-checks', {
      listingId: home.id, action: 'mark', method: 'VIDEO_CALL', checks: ['ADDRESS_MATCHES', 'PHOTOS_MATCH', 'HOST_HAD_ACCESS'],
      note: 'Video call with the host at the gate and in each room; address looked up on the Ghana Post app.', ...over,
    })
    return { admin, host, home, mark }
  }
  const badge = async (id: string) => (await call('GET', `/api/listings/${id}`)).json.listing

  test('an admin marks a home checked: the badge appears, with no claim of ownership and no private detail', async ({ world, page }) => {
    const { admin, host, home, mark } = await checkable(world)
    // Every box, a method and a real note are needed
    expect((await mark(admin, { checks: ['ADDRESS_MATCHES', 'PHOTOS_MATCH'] })).status).toBe(400)
    expect((await mark(admin, { note: 'looks fine' })).status).toBe(400)
    expect((await mark(host)).status).toBe(403)
    const done = await mark(admin)
    expect(done.status, done.text).toBeLessThan(300)
    const pub = await badge(home.id)
    const text = JSON.stringify(pub)
    expect(text).not.toContain('GA-183-8164')
    expect(text).not.toContain('Video call with the host')
    expect(text).not.toContain(admin.id)
    await page.goto(`/listings/${home.id}`)
    await expect(page.getByText('Address and photos checked').first()).toBeVisible()
    // The page never says "verified", and where it mentions ownership or a guarantee it is to say the badge is NOT one
    await expect(page.getByText(/\bverified\b/i)).toHaveCount(0)
    for (const line of await page.getByText(/own(s|er|ership)|guarantee/i).allInnerTexts()) expect(line).toMatch(/\b(not|never|no)\b/i)
    await host.mail(/checked/i)
  })

  test('changing the address or the photos removes the badge; changing the price does not', async ({ world }) => {
    const { admin, host, home, mark } = await checkable(world)
    expect((await mark(admin)).status).toBeLessThan(300)
    const live = () => db.listingCheck.count({ where: { listingId: home.id, revokedAt: null } })
    expect(await live()).toBe(1)
    expect((await host.call('PATCH', `/api/listings/${home.id}`, { priceNightly: 95, title: 'E2E a new title for the same home' })).status).toBe(200)
    expect(await live(), 'price and title leave the badge').toBe(1)
    expect((await host.call('PATCH', `/api/listings/${home.id}`, { digitalAddress: 'GA-183-8165' })).status).toBe(200)
    expect(await live(), 'a new digital address removes it').toBe(0)
    await host.mail(/no longer|removed/i)
  })
})

test.describe('the calendar', () => {
  test('dates the host blocks cannot be booked or found in a search for those dates, and unblocking frees them', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const city = `Sunyani${Date.now().toString(36)}`
    const home = await world.listing(host, { city })
    const dates = world.dates(3)
    const blocked = await host.call('POST', `/api/listings/${home.id}/blocked-dates`, { start: dates.checkIn, end: dates.checkOut, note: 'family visiting' })
    expect(blocked.status, blocked.text).toBeLessThan(300)
    expect((await world.book(guest, home.id, dates)).status).toBe(409)
    const found = await call('GET', `/api/listings?city=${city}&mode=SHORT_STAY&checkIn=${dates.checkIn}&checkOut=${dates.checkOut}`)
    expect(found.json.listings).toHaveLength(0)
    // The note is the host's own: a guest looking at the home never sees it
    expect((await call('GET', `/api/listings/${home.id}`)).text).not.toContain('family visiting')
    expect((await guest.call('POST', `/api/listings/${home.id}/blocked-dates`, { start: dates.checkIn, end: dates.checkOut })).status).toBe(403)
    const freed = await host.call('DELETE', `/api/listings/${home.id}/blocked-dates`, { start: dates.checkIn, end: dates.checkOut })
    expect(freed.status, freed.text).toBeLessThan(300)
    await world.mustBook(guest, home.id, dates)
  })
})

test.describe('after the stay', () => {
  test('a stay is completed after check-out; guest and host review each other once; the reviews appear when both are in', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const { id } = await world.paidBooking(guest, home.id)
    const review = (who: Actor, type: string, rating: number) => who.call('POST', '/api/reviews', { bookingId: id, rating, comment: 'Clean, quiet and exactly as described. We would stay again.', type })
    // Not before the stay is over
    expect((await review(guest, 'GUEST_TO_HOST', 5)).status).toBeGreaterThanOrEqual(400)
    const b = await db.booking.findUniqueOrThrow({ where: { id } })
    await ageBooking(id, (b.checkOut.getTime() - Date.now()) / DAY + 1)
    await cron('complete-bookings')
    await expect.poll(async () => (await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED')
    for (const bad of [0, 6, 4.5, '5; DROP TABLE']) expect((await review(guest, 'GUEST_TO_HOST', bad as number)).status, `rating ${bad}`).toBe(400)
    expect((await review(guest, 'GUEST_TO_HOST', 5)).status).toBeLessThan(300)
    expect((await review(guest, 'GUEST_TO_HOST', 1)).status, 'a second review of the same stay').toBe(409)
    expect((await review(guest, 'HOST_TO_GUEST', 5)).status, 'a guest writing the host\'s review').toBeGreaterThanOrEqual(400)
    // One side only: not public yet
    expect((await call('GET', `/api/listings/${home.id}`)).json.listing.reviews).toHaveLength(0)
    expect((await review(host, 'HOST_TO_GUEST', 4)).status).toBeLessThan(300)
    await expect.poll(async () => (await call('GET', `/api/listings/${home.id}`)).json.listing.reviews.length).toBe(1)
    expect(await db.review.count({ where: { bookingId: id } })).toBe(2)
    // And the host is still paid once for the completed stay
    await cron('process-payouts')
    await expect.poll(async () => (await fakes.transfers(`booking ${id}`)).length).toBe(1)
    await expectInvariants()
  })

  test('guest and host message each other about a home; a stranger cannot start on a guest; contact details stay hidden until paid', async ({ world, page, signIn }) => {
    const host = await world.host()
    const [guest, stranger] = [await world.guest(), await world.guest()]
    const home = await world.listing(host)
    const write = (from: Actor, to: Actor, content: string, about: Record<string, string> = { listingId: home.id }) => from.call('POST', '/api/messages', { receiverId: to.id, content, ...about })
    expect((await write(guest, host, 'Hello, is the flat near the university?')).status).toBe(201)
    expect((await write(host, guest, 'Yes, ten minutes on foot.')).status).toBe(201)
    expect((await write(stranger, guest, 'Hi there, pay me directly instead')).status).toBeGreaterThanOrEqual(400)
    expect((await write(guest, host, 'x'.repeat(2001))).status).toBe(400)
    // The host sees the conversation in the dashboard
    await signIn(host)
    await page.goto('/dashboard/host/messages')
    await expect(page.getByText('Hello, is the flat near the university?').first()).toBeVisible()
    // An unpaid booking does not hand over phone or email
    const id = await world.mustBook(guest, home.id)
    const seenByHost = async () => (await host.call('GET', `/api/bookings?id=${id}`)).json.booking?.guest ?? (await host.call('GET', `/api/bookings?hostId=${host.id}`)).json.bookings[0].guest
    const before = await seenByHost()
    expect(before.name).toBe(guest.name)
    expect(before.email ?? null).toBeNull()
    expect(before.phone ?? null).toBeNull()
    const pay = await world.startPayment(guest, id)
    await fakes.setTx(pay.reference!, { status: 'success' })
    await world.verify(guest, pay.reference!)
    expect((await seenByHost()).email, 'once confirmed and paid, the host has the guest\'s email').toBe(guest.email)
    // The host is emailed about the new message, the guest about the reply
    await host.mail(/message/i)
    await guest.mail(/message/i)
  })
})

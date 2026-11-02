import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { ListingPage } from '../../pages'

// A home switched off by its host while a guest still has an old copy of a page that links to it: a home
// page drawn before the switch-off (SU6), or the listing page itself left open. Whatever the guest's copy
// shows, the home cannot be opened as bookable, cannot be booked, and nothing can be paid for it.
// E2E_SWITCHED_OFF_SHOTS=1 saves what the guest sees to e2e/.reports/switched-off/.

const PHOTOS = ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80']

async function shot(page: Page, name: string) {
  if (!process.env.E2E_SWITCHED_OFF_SHOTS) return
  const dir = path.join(__dirname, '..', '..', '.reports', 'switched-off')
  fs.mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${test.info().project.name}-${name}.png`), fullPage: true })
}

test.describe('a home switched off while a guest still has an old page', () => {
  test('a stale card on the home page opens "not available", with nothing to book @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    // Above every other home in the hero's order, so the guest's home page links to it
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS), isFeatured: true, avgRating: 2_000 } })
    expect((await host.call('PATCH', `/api/listings/${home.id}`, { title: home.title })).status).toBe(200)
    await signIn(guest)
    const card = page.locator(`a[href="/listings/${home.id}"]`).first()
    await expect.poll(async () => { await page.goto('/'); return card.count() }, { timeout: 10_000 }).toBeGreaterThan(0)

    // The host switches it off; the guest's home page is the old one, and they press its card
    expect((await host.call('DELETE', `/api/listings/${home.id}`)).status).toBe(200)
    await card.click()
    await expect(page).toHaveURL(new RegExp(`/listings/${home.id}$`))
    await expect(page.getByRole('heading', { name: 'Listing not found' })).toBeVisible()
    await expect(page.getByText(home.title)).toHaveCount(0)
    await expect(page.getByPlaceholder('Add date')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Instant Book|Request to Book|Reserve)/ })).toHaveCount(0)
    await shot(page, 'stale-card')

    // And the server refuses a booking whatever the page does
    const { checkIn, checkOut } = world.dates(2)
    const booked = await guest.call('POST', '/api/bookings', { listingId: home.id, rentalMode: 'SHORT_STAY', checkIn, checkOut })
    expect(booked.status).toBe(400)
    expect(booked.json.error).toBe('Listing is not available')
    expect(await db.booking.count({ where: { listingId: home.id } })).toBe(0)
    expect(await db.payment.count({ where: { booking: { listingId: home.id } } })).toBe(0)
  })

  test('a listing page left open: pressing book is refused with a message, and nothing is booked or charged @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const { checkIn, checkOut } = world.dates(2)
    await signIn(guest)
    const listing = new ListingPage(page)
    await listing.goto(home.id)
    await listing.chooseDates(checkIn, checkOut)

    expect((await host.call('DELETE', `/api/listings/${home.id}`)).status).toBe(200)
    await listing.bookButton().click()
    await expect(page.getByText('Listing is not available')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/listings/${home.id}`))
    await shot(page, 'open-listing-page')
    expect(await db.booking.count({ where: { listingId: home.id } })).toBe(0)
    expect(await db.payment.count({ where: { booking: { listingId: home.id } } })).toBe(0)
  })

  test('a booking made before the switch-off cannot be paid for after it (SU7)', async ({ world }) => {
    test.fail(true, 'SU7: the payment route does not look at the listing; a confirmed, unpaid booking can still be paid after its home is switched off')
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await host.call('DELETE', `/api/listings/${home.id}`)).status).toBe(200)
    const pay = await world.startPayment(guest, bookingId)
    expect(pay.status).toBeGreaterThanOrEqual(400)
    expect(await fakes.tx(bookingId)).toHaveLength(0)
  })
})

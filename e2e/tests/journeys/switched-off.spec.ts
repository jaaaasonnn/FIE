import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { APP, cron } from '../../lib/world'
import { CheckoutPage, FakePaystack, ListingPage } from '../../pages'

// A home switched off by its host while a guest still has an old copy of a page that links to it: a home
// page drawn before the switch-off (SU6), or the listing page itself left open. Whatever the guest's copy
// shows, the home cannot be opened as bookable, cannot be booked, and nothing can be paid for it (SU7: nor
// can a booking made before the switch-off; money already on its way is refunded in full). A home on hold
// is deliberately outside that rule.
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

  test('a booking made before the switch-off cannot be paid for: the guest is told, nothing is charged, and it ends (SU7) @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await host.call('DELETE', `/api/listings/${home.id}`)).status).toBe(200)

    // The server refuses to start a payment, and nothing reaches Paystack
    const pay = await world.startPayment(guest, bookingId)
    expect(pay.status).toBe(409)
    expect(pay.json).toEqual({ error: 'This home is no longer available. You have not been charged.', code: 'HOME_UNAVAILABLE' })
    expect(await fakes.tx(bookingId)).toHaveLength(0)

    // What the guest sees: the checkout and their bookings say so, with no way to pay
    await signIn(guest)
    await page.goto(`/checkout/${bookingId}`)
    await expect(page.getByText('This home is no longer available').first()).toBeVisible()
    await expect(page.getByText('You have not been charged.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Pay .* Securely/ })).toHaveCount(0)
    await shot(page, 'checkout')
    await page.goto('/dashboard/guest')
    await expect(page.getByText('No longer available').first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0)
    await shot(page, 'guest-dashboard')

    // The expiry job ends it at its next run, and both are told
    expect((await cron('expire-bookings')).status).toBe(200)
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID', cancelledBy: 'SYSTEM', cancelReason: 'HOME_UNAVAILABLE' })
    expect((await guest.mail(/no longer available/)).length).toBeGreaterThan(0)
    expect((await host.mail(/ended because the home is switched off/)).length).toBeGreaterThan(0)
    await expectInvariants()
  })

  test('a booking whose host is suspended cannot be paid for either (SU7)', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const admin = await world.admin()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await admin.call('POST', '/api/admin/users', { userId: host.id, action: 'suspend', reason: 'Suspended by the switched-off test.' })).status).toBe(200)
    const pay = await world.startPayment(guest, bookingId)
    expect(pay.status).toBe(409)
    expect(pay.json.code).toBe('HOME_UNAVAILABLE')
    expect(await fakes.tx(bookingId)).toHaveLength(0)
    expect((await cron('expire-bookings')).status).toBe(200)
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: 'CANCELLED', cancelReason: 'HOME_UNAVAILABLE' })
  })

  test('a home on hold is outside the rule: the booking stays payable, is not ended early, and its payment is confirmed (SU7)', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const admin = await world.admin()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await admin.call('POST', '/api/admin', { type: 'hold-listing', listingId: home.id })).status).toBe(200)

    expect((await cron('expire-bookings')).status).toBe(200)
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID' })
    const pay = await world.startPayment(guest, bookingId)
    expect(pay.status).toBe(200)
    await fakes.setTx(pay.reference!, { status: 'success' })
    await fakes.webhook(APP[0], 'charge.success', { reference: pay.reference })
    await world.verify(guest, pay.reference!)
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', cancelReason: null })
    expect(await db.refund.count({ where: { bookingId } })).toBe(0)
    await expectInvariants()
  })

  test('switched off while the guest is on Paystack\'s page: the payment finishes, is refunded once in full, and the booking ends (SU7) @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    const total = (await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).totalPrice
    await signIn(guest)
    const checkout = new CheckoutPage(page)
    await checkout.goto(bookingId)
    await checkout.chooseCard()
    await checkout.payButton().click()
    const paystack = new FakePaystack(page)
    await paystack.expectOpen()

    // The host switches the home off while the guest is on Paystack's page; the guest pays
    expect((await host.call('DELETE', `/api/listings/${home.id}`)).status).toBe(200)
    await paystack.pay()
    await expect(page.getByText('This home is no longer available').first()).toBeVisible()
    await expect(page.getByText('so it is being refunded in full')).toBeVisible()
    await shot(page, 'paid-after-switch-off')

    // Paystack's webhook arrives too, twice on each server: nothing more happens
    const [{ reference }] = await fakes.tx(bookingId)
    await Promise.all([fakes.webhook(APP[0], 'charge.success', { reference, times: 2 }), fakes.webhook(APP[1], 'charge.success', { reference, times: 2 })])
    expect(await fakes.tx(bookingId)).toHaveLength(1)
    expect((await db.payment.findMany({ where: { bookingId } })).map((p) => p.status)).toEqual(['SUCCESS'])
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PAID', cancelReason: 'HOME_UNAVAILABLE' })
    const refunds = await db.refund.findMany({ where: { bookingId } })
    expect(refunds).toHaveLength(1)
    expect(refunds[0]).toMatchObject({ reason: 'LATE_PAYMENT', amount: total })
    expect((await guest.mail(/became unavailable before your payment/)).length).toBe(1)
    await expectInvariants()
  })
})

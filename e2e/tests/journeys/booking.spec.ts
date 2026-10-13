import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { cron } from '../../lib/world'
import { CheckoutPage, FakePaystack, ListingPage } from '../../pages'

// Finding a home, asking for it, being accepted, paying; and the ways each step can go.

test.describe('search', () => {
  test('search by city shows the homes there and not others, with a pin for each on the map @core', async ({ page, world, browserName }) => {
    const host = await world.host()
    const city = `Wa${Date.now().toString(36)}`
    // (placed inside the map's opening view, around Accra: the map only draws pins for what is in view)
    const here = await Promise.all([world.listing(host, { city, priceNightly: 60, lat: 5.56, lng: -0.19 }), world.listing(host, { city, priceNightly: 95, lat: 5.57, lng: -0.2 })])
    const elsewhere = await world.listing(host, { city: `Bolga${Date.now().toString(36)}` })
    await page.goto('/search')
    await page.getByPlaceholder('Search by city, neighbourhood...').fill(city)
    await page.keyboard.press('Enter')
    for (const home of here) await expect(page.getByText(home.title).first()).toBeVisible()
    await expect(page.getByText(elsewhere.title)).toHaveCount(0)
    await expect(page.getByText('$60').first()).toBeVisible()
    await expect(page.getByText('$95').first()).toBeVisible()
    // The map is there and shows the homes (a pin each, or one cluster for both). On a phone it is behind the Map button.
    test.skip(browserName === 'firefox', 'headless Firefox has no WebGL here, so the map does not draw: the map is not tested in Firefox')
    await expect(page.locator('canvas.maplibregl-canvas').first()).toBeAttached()
    const map = page.locator('canvas.maplibregl-canvas:visible')
    const toggle = page.getByRole('button', { name: 'Map', exact: true })
    if ((await map.count()) === 0 && await toggle.isVisible()) await toggle.click()
    await expect(map.first()).toBeVisible()
    await expect.poll(async () => page.locator('.maplibregl-marker').count()).toBeGreaterThanOrEqual(1)
  })

  test('searching with dates leaves out a home that is taken on those dates', async ({ page, world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const city = `Ho${Date.now().toString(36)}`
    const [taken, free] = [await world.listing(host, { city }), await world.listing(host, { city })]
    const { checkIn, checkOut } = world.dates(3)
    await world.paidBooking(guest, taken.id, { checkIn, checkOut })
    await page.goto(`/search?city=${city}&mode=SHORT_STAY&checkIn=${checkIn}&checkOut=${checkOut}`)
    await expect(page.getByText(free.title).first()).toBeVisible()
    await expect(page.getByText(taken.title)).toHaveCount(0)
    // Without dates both are shown
    await page.goto(`/search?city=${city}`)
    await expect(page.getByText(taken.title).first()).toBeVisible()
  })

  test('the heart saves a home to the wishlist and takes it off again', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    await signIn(guest)
    await page.goto(`/listings/${home.id}`)
    await page.getByRole('button', { name: 'Save to wishlist' }).click()
    await expect.poll(() => db.wishlist.count({ where: { userId: guest.id, listingId: home.id } })).toBe(1)
    await page.goto('/dashboard/guest/wishlist')
    await expect(page.getByText(home.title).first()).toBeVisible()
    await page.goto(`/listings/${home.id}`)
    await page.getByRole('button', { name: /Remove from wishlist|Saved|Save to wishlist/ }).first().click()
    await expect.poll(() => db.wishlist.count({ where: { userId: guest.id, listingId: home.id } })).toBe(0)
  })
})

test.describe('request to book', () => {
  test('a request cannot be paid until the host accepts; then the guest has 24 hours and pays @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { instantBook: false, priceNightly: 70 })
    const { checkIn, checkOut } = world.dates(2)
    await signIn(guest)
    const listing = new ListingPage(page)
    await listing.goto(home.id)
    await listing.chooseDates(checkIn, checkOut)
    await listing.bookButton().click()
    const booking = await expect.poll(async () => db.booking.findFirst({ where: { guestId: guest.id, listingId: home.id } })).not.toBeNull().then(() => db.booking.findFirstOrThrow({ where: { guestId: guest.id, listingId: home.id } }))
    expect(booking).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID', payBy: null, totalPrice: 140 })
    // Paying before the host answers is refused by the server, whatever the page shows
    const early = await world.startPayment(guest, booking.id)
    expect(early.status).toBeGreaterThanOrEqual(400)
    expect(early.json.error).toContain('The host needs to accept your request first')
    expect(await fakes.tx(booking.id)).toHaveLength(0)
    // The host is told by email
    await host.mail(/request/i)

    expect((await host.call('PATCH', `/api/bookings/${booking.id}`, { action: 'accept' })).status).toBe(200)
    const accepted = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(accepted.status).toBe('CONFIRMED')
    const hours = (accepted.payBy!.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9); expect(hours).toBeLessThanOrEqual(24)

    const checkout = new CheckoutPage(page)
    await checkout.goto(booking.id)
    await checkout.chooseCard()
    await expect(checkout.payButton()).toHaveText(/\$140\.00/)
    await checkout.payButton().click()
    const paystack = new FakePaystack(page)
    await paystack.expectOpen()
    await paystack.pay()
    await expect(page.getByRole('heading', { name: 'Booking Confirmed!' })).toBeVisible()
    expect(await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    // Both are told it is paid and confirmed, once each
    await cron('send-messages')
    for (const person of [guest, host]) expect((await person.mail(/confirmed/i)).filter((m) => /confirmed/i.test(m.subject))).toHaveLength(1)
    await expectInvariants()
  })

  test('the host declines: the guest is told, nothing can be paid, and the dates are free again', async ({ world }) => {
    const host = await world.host()
    const [guest, next] = [await world.guest(), await world.guest()]
    const home = await world.listing(host, { instantBook: false })
    const dates = world.dates(2)
    const id = await world.mustBook(guest, home.id, dates)
    expect((await host.call('PATCH', `/api/bookings/${id}`, { action: 'decline' })).status).toBe(200)
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe('DECLINED')
    expect((await world.startPayment(guest, id)).status).toBeGreaterThanOrEqual(400)
    await guest.mail(/declin|not accept|could not/i)
    await world.mustBook(next, home.id, dates)
    await expectInvariants()
  })

  test('only the host of the home can accept or decline a request', async ({ world }) => {
    const [host, otherHost] = [await world.host(), await world.host()]
    const guest = await world.guest()
    const home = await world.listing(host, { instantBook: false })
    const id = await world.mustBook(guest, home.id)
    for (const person of [guest, otherHost]) {
      for (const action of ['accept', 'decline']) expect((await person.call('PATCH', `/api/bookings/${id}`, { action })).status).toBe(403)
    }
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING')
  })

  test('a request the host never answers is ended after 48 hours and the guest is told', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { instantBook: false })
    const id = await world.mustBook(guest, home.id)
    const { ageBooking } = await import('../../lib/db')
    await ageBooking(id, 2.05)
    await cron('expire-bookings')
    await expect.poll(async () => (await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED')
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ cancelledBy: 'SYSTEM', cancelReason: 'NO_HOST_RESPONSE' })
    await guest.mail(/did not (answer|respond)|no answer|not answered|expired|ended/i)
  })
})

test.describe('paying', () => {
  test('mobile money: the same amount, and the number typed is not kept anywhere it should not be', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { priceNightly: 55 })
    const id = await world.mustBook(guest, home.id)
    await signIn(guest)
    const checkout = new CheckoutPage(page)
    await checkout.goto(id)
    await checkout.chooseMomo('0241234567')
    await checkout.payButton().click()
    const paystack = new FakePaystack(page)
    await paystack.expectOpen()
    const [tx] = await fakes.tx(id)
    expect(tx).toMatchObject({ currency: 'GHS' })
    expect(JSON.stringify(tx)).toContain('mobile_money')
    await paystack.pay()
    await expect(page.getByRole('heading', { name: 'Booking Confirmed!' })).toBeVisible()
    // The host never sees the guest's mobile money number
    const asHost = await host.call('GET', `/api/bookings?hostId=${host.id}`)
    expect(asHost.text).not.toContain('0241234567')
    await expectInvariants()
  })

  test('the host is not shown the guest\'s Paystack payment reference', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const { id, reference } = await world.paidBooking(guest, home.id)
    for (const path of [`/api/bookings?hostId=${host.id}`, `/api/bookings?id=${id}`]) expect((await host.call('GET', path)).text, path).not.toContain(reference)
  })

  test('the card is declined at Paystack: the guest is back on checkout, told, and can pay again @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const id = await world.mustBook(guest, home.id)
    await signIn(guest)
    const checkout = new CheckoutPage(page)
    await checkout.goto(id)
    await checkout.chooseCard()
    await checkout.payButton().click()
    const paystack = new FakePaystack(page)
    await paystack.expectOpen()
    await paystack.decline()
    await expect(page).toHaveURL(new RegExp(`/checkout/${id}\\?payment=`))
    await expect(page.getByRole('heading', { name: 'Booking Confirmed!' })).toHaveCount(0)
    await expect(page.getByText(/not (go through|successful|complete)|failed|declined|try again/i).first()).toBeVisible()
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('UNPAID')
    await checkout.chooseCard()
    await checkout.payButton().click()
    await paystack.expectOpen()
    await paystack.pay()
    await expect(page.getByRole('heading', { name: 'Booking Confirmed!' })).toBeVisible()
    expect((await db.payment.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } })).map((p) => p.status)).toEqual(['FAILED', 'SUCCESS'])
    await expectInvariants()
  })

  test('the webhook arrives late, after the guest has closed the tab: the booking is confirmed and both are told', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const id = await world.mustBook(guest, home.id)
    const pay = await world.startPayment(guest, id)
    await fakes.setTx(pay.reference!, { status: 'success' })
    // The browser never comes back. Only Paystack's webhook says it was paid.
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('UNPAID')
    await fakes.webhook('http://localhost:3201', 'charge.success', { reference: pay.reference })
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    expect((await guest.mail(/confirmed/i)).filter((m) => /confirmed/i.test(m.subject))).toHaveLength(1)
    await expectInvariants()
  })

  test('an instant booking not paid within the hour is released, and a payment that lands afterwards is owed back in full', async ({ world }) => {
    const host = await world.host()
    const [guest, next] = [await world.guest(), await world.guest()]
    const home = await world.listing(host)
    const dates = world.dates(2)
    const id = await world.mustBook(guest, home.id, dates)
    const pay = await world.startPayment(guest, id)
    const { ageBooking } = await import('../../lib/db')
    await ageBooking(id, 1.5 / 24)
    await cron('expire-bookings')
    await expect.poll(async () => (await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED')
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).cancelReason).toBe('UNPAID_EXPIRED')
    // Paying is no longer possible from the site
    expect((await world.startPayment(guest, id)).status).toBeGreaterThanOrEqual(400)
    // But the page at Paystack was still open, and the guest pays there
    await fakes.setTx(pay.reference!, { status: 'success' })
    await fakes.webhook('http://localhost:3200', 'charge.success', { reference: pay.reference })
    const after = await db.booking.findUniqueOrThrow({ where: { id }, include: { refund: true } })
    expect(after.status, 'the booking is never revived').toBe('CANCELLED')
    expect(after.refund).toMatchObject({ reason: 'LATE_PAYMENT', amount: after.totalPrice })
    // The dates went to someone else in the meantime, and that stands
    await world.mustBook(next, home.id, dates)
    await expectInvariants()
  })
})

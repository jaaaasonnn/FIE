import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { Actor } from '../../lib/world'
import { AuthPage, CheckoutPage, FakePaystack, ListingPage } from '../../pages'

// The shortest path through the product, in a real browser on the production
// build: someone signs up, finds a home, books it and pays.

test.describe('the main journey @smoke @core', () => {
  test('a new guest signs up through the form and is sent a confirmation link that works', async ({ page, world }) => {
    const tag = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
    const person = new Actor('', `e2e-form-${tag}@fiegh.test`, `Form-pass-${tag}`, `E2E Form ${tag}`, 'GUEST')
    const auth = new AuthPage(page)
    await auth.gotoSignUp()
    await auth.signUp(person)
    await expect(page).not.toHaveURL(/\/login/)
    const row = await db.user.findUniqueOrThrow({ where: { email: person.email } })
    person.id = row.id
    world.people.push(person)
    expect(row).toMatchObject({ role: 'GUEST', emailVerifiedAt: null })
    // The password is stored hashed, and the session token is not stored as it is in the cookie
    expect(row.passwordHash).not.toContain(person.password)
    const cookie = (await page.context().cookies()).find((c) => c.name === 'fiegh_session')!
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' })
    expect(await db.session.count({ where: { token: cookie.value } })).toBe(0)
    expect(await db.session.count({ where: { userId: row.id } })).toBe(1)

    const link = await person.linkFrom('Confirm your email')
    await page.goto(link)
    await page.getByRole('button', { name: /confirm/i }).click()
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: row.id } })).emailVerifiedAt).not.toBeNull()
  })

  test('a guest logs in, books a home, pays at Paystack and sees it confirmed, with the same amount everywhere', async ({ page, world, problems, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { priceNightly: 85, title: `E2E smoke home ${Date.now().toString(36)}` })
    const { checkIn, checkOut } = world.dates(2)

    await signIn(guest)
    await page.goto(`/listings/${home.id}`)
    await expect(page.getByRole('heading', { level: 1, name: home.title })).toBeVisible()

    const listing = new ListingPage(page)
    await listing.chooseDates(checkIn, checkOut)
    await expect(page.getByText('$170.00').first()).toBeVisible()
    await listing.bookButton().click()

    await expect(page).toHaveURL(/\/checkout\//)
    const bookingId = /\/checkout\/([^/?#]+)/.exec(page.url())![1]
    const checkout = new CheckoutPage(page)
    await expect(page.getByText('$85.00 × 2 nights')).toBeVisible()
    await checkout.chooseCard()
    await expect(checkout.payButton()).toHaveText(/Pay \$170\.00 Securely/)
    await checkout.payButton().click()

    const paystack = new FakePaystack(page)
    await paystack.expectOpen()
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId } })
    // The cedis on Paystack's page are the cedis stored for the payment, to the pesewa
    await expect(paystack.amount()).toHaveText(`GHS ${(payment.amountPesewas! / 100).toFixed(2)}`)
    await expect(paystack.reference()).toHaveText(payment.gatewayReference!)
    await paystack.pay()

    await expect(page).toHaveURL(new RegExp(`/checkout/${bookingId}\\?payment=success`))
    await expect(page.getByRole('heading', { name: 'Booking Confirmed!' })).toBeVisible()
    // And the booking's own page says the same, with the same amount
    await page.goto(`/bookings/${bookingId}`)
    await expect(page.getByText('$170.00').first()).toBeVisible()

    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payments: true } })
    expect(booking).toMatchObject({ guestId: guest.id, hostId: host.id, status: 'CONFIRMED', paymentStatus: 'PAID', subtotal: 170, totalPrice: 170, serviceFee: 0 })
    expect(booking.payments.map((p) => p.status)).toEqual(['SUCCESS'])
    const [tx] = await fakes.tx(undefined, payment.gatewayReference!)
    expect(tx).toMatchObject({ status: 'success', currency: 'GHS', amount: booking.payments[0].amountPesewas })
    await expectInvariants()
    expect(problems.pageErrors).toEqual([])
  })
})

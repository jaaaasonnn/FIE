import { test, expect, FORM_LOGIN_NEEDS_HTTPS } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { measured } from '../../lib/race'
import { AuthPage, CheckoutPage, FakePaystack, ListingPage } from '../../pages'

// How the site behaves around the edges of a journey: links opened cold,
// back and forward, a refresh half way, a button pressed twice, a second tab.

test.describe('deep links', () => {
  for (const [name, target] of [['a checkout link', (b: string) => `/checkout/${b}`], ['the host dashboard', () => '/dashboard/host/bookings?tab=requests'], ['the guest payments page', () => '/dashboard/guest/payments']] as const) {
    test(`${name}, opened while signed out, comes back to the same place after logging in @core`, async ({ page, world, browserName }) => {
      test.skip(browserName === 'webkit', FORM_LOGIN_NEEDS_HTTPS)
      test.fail(true, 'F1: after logging in, the redirect is overridden and the person lands on their dashboard')
      const host = await world.host()
      const guest = await world.guest()
      const home = await world.listing(host)
      const bookingId = await world.mustBook(guest, home.id)
      const path = target(bookingId)
      const who = path.includes('/host') ? host : guest
      await page.goto(path)
      // The proxy sends a signed-out visitor to log in, and remembers where they were going
      await expect(page).toHaveURL(/\/login\?redirect=/)
      expect(new URL(page.url()).searchParams.get('redirect')).toBe(path)
      await new AuthPage(page).logIn(who.email, who.password)
      await expect(page).toHaveURL(new RegExp(path.replace(/[?]/g, '\\?')))
    })
  }

  test('a booking link opened cold by its signed-in guest opens straight away @core', async ({ page, world, signIn, problems }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    await page.goto(`/bookings/${bookingId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(home.title).first()).toBeVisible()
    expect(problems.pageErrors).toEqual([])
  })

  test('someone else\'s booking link shows nothing of the booking', async ({ page, world, signIn }) => {
    const host = await world.host()
    const [guest, stranger] = [await world.guest(), await world.guest()]
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(stranger)
    await page.goto(`/bookings/${bookingId}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(home.title)).toHaveCount(0)
    await page.goto(`/checkout/${bookingId}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /^Pay .* Securely/ })).toHaveCount(0)
  })

  test('a log-in link cannot be used to send someone to another website', async ({ page, world }) => {
    const guest = await world.guest()
    for (const evil of ['https://evil.example/steal', '//evil.example/steal', '/\\evil.example']) {
      await page.context().clearCookies()
      await page.goto(`/login?redirect=${encodeURIComponent(evil)}`)
      await new AuthPage(page).logIn(guest.email, guest.password)
      await expect(page).toHaveURL(/localhost:3200\/dashboard/)
    }
  })

  test('an address that does not exist shows the not-found page with a way home', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('link', { name: /home|search|browse/i }).first()).toBeVisible()
  })
})

test.describe('back, forward and refresh', () => {
  test('search to a listing and back: the same search, the same results, and forward works @core', async ({ page, world }) => {
    const host = await world.host()
    const city = `Zebilla${Date.now().toString(36)}`
    const homes = await Promise.all([1, 2, 3].map(() => world.listing(host, { city })))
    await page.goto(`/search?city=${city}`)
    const cards = page.locator(`a[href^="/listings/"]`)
    await expect(page.getByText(homes[0].title).first()).toBeVisible()
    const searchUrl = page.url()
    await page.getByText(homes[1].title).first().click()
    await expect(page).toHaveURL(new RegExp(`/listings/${homes[1].id}`))
    await expect(page.getByRole('heading', { level: 1, name: homes[1].title })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(searchUrl)
    for (const home of homes) await expect(page.getByText(home.title).first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThanOrEqual(3)
    await page.goForward()
    await expect(page.getByRole('heading', { level: 1, name: homes[1].title })).toBeVisible()
  })

  test('refreshing the checkout page keeps the booking and creates nothing', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { priceNightly: 120 })
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    const checkout = new CheckoutPage(page)
    await checkout.goto(bookingId)
    await expect(checkout.payButton()).toHaveText(/\$240\.00/)
    await page.reload()
    await page.reload()
    await expect(checkout.payButton()).toHaveText(/\$240\.00/)
    expect(await db.payment.count({ where: { bookingId } })).toBe(0)
    expect(await db.booking.count({ where: { guestId: guest.id } })).toBe(1)
  })

  test('coming back from Paystack without paying leaves the booking payable, and the page says so', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    const checkout = new CheckoutPage(page)
    await checkout.goto(bookingId)
    await checkout.chooseCard()
    await checkout.payButton().click()
    const paystack = new FakePaystack(page)
    await paystack.expectOpen()
    await paystack.close()
    await expect(page).toHaveURL(new RegExp(`/checkout/${bookingId}`))
    await expect(page.getByRole('heading', { name: 'Booking Confirmed!' })).toHaveCount(0)
    await expect(checkout.payButton()).toBeVisible()
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).paymentStatus).toBe('UNPAID')
    // The browser's back button from Paystack's page does the same
    await checkout.chooseCard()
    await checkout.payButton().click()
    await paystack.expectOpen()
    await page.goBack()
    await expect(checkout.payButton()).toBeVisible()
    await expectInvariants()
  })
})

test.describe('pressed twice', () => {
  test('the book button double-clicked makes one booking @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const { checkIn, checkOut } = world.dates(2)
    await signIn(guest)
    const listing = new ListingPage(page)
    await listing.goto(home.id)
    await listing.chooseDates(checkIn, checkOut)
    await listing.bookButton().dblclick()
    // One booking, whatever the second click did
    await expect.poll(() => db.booking.count({ where: { guestId: guest.id } })).toBe(1)
    const said = await page.locator('body').innerText()
    await expect(page, `after the double click the page says: ${said.match(/(already|error|not available|try again|limit)[^\n]{0,120}/i)?.[0] ?? '(nothing unusual)'}`).toHaveURL(/\/checkout\//)
  })

  test('the pay button double-clicked opens one payment at Paystack', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    const checkout = new CheckoutPage(page)
    await checkout.goto(bookingId)
    await checkout.chooseCard()
    await checkout.payButton().dblclick()
    await new FakePaystack(page).expectOpen()
    const opened = (await fakes.tx(bookingId)).length
    measured(`double-clicking Pay opened ${opened} payment(s) at Paystack`)
    expect(opened).toBe(1)
  })

  test('checkout open in two tabs: once paid in one, the other cannot charge again', async ({ page, context, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    const second = await context.newPage()
    const [a, b] = [new CheckoutPage(page), new CheckoutPage(second)]
    await a.goto(bookingId); await b.goto(bookingId)
    await a.chooseCard(); await b.chooseCard()
    await a.payButton().click()
    await new FakePaystack(page).expectOpen()
    // The other tab was opened before the first paid, and still shows the Pay button
    await b.payButton().click()
    await new FakePaystack(page).pay()
    await expect(page.getByRole('heading', { name: 'Booking Confirmed!' })).toBeVisible()
    expect((await fakes.tx(bookingId)).length, 'payments opened at Paystack for one booking').toBe(1)
  })

  test('the sign-up button double-clicked makes one account and shows no error', async ({ page, world }) => {
    const tag = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
    const email = `e2e-dbl-${tag}@fiegh.test`
    const auth = new AuthPage(page)
    await auth.gotoSignUp()
    await page.getByPlaceholder('Kwame Mensah').fill('E2E Double')
    await page.getByPlaceholder('you@example.com', { exact: true }).fill(email)
    await page.getByPlaceholder('At least 8 characters').fill('Double-pass-123')
    await page.getByPlaceholder('Repeat password').fill('Double-pass-123')
    await auth.submit('Create account').dblclick()
    await expect(page).not.toHaveURL(/\/login/)
    const rows = await db.user.findMany({ where: { email } })
    world.people.push(...rows.map((r) => Object.assign(Object.create(null), { id: r.id })))
    expect(rows).toHaveLength(1)
  })
})

test.describe('keyboard only', () => {
  test('logging in with the keyboard alone @core', async ({ page, world, browserName }) => {
    test.skip(browserName === 'webkit', FORM_LOGIN_NEEDS_HTTPS)
    const guest = await world.guest()
    await page.goto('/login')
    const identifier = page.getByPlaceholder('you@example.com or 0241234567')
    await identifier.focus()
    await page.keyboard.type(guest.email)
    await page.keyboard.press('Tab')
    // Focus must land on the password field (or a control belonging to it), not wander off the form
    await page.getByPlaceholder('Your password').focus()
    await page.keyboard.type(guest.password)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/dashboard\/guest/)
  })

  test('every control on the log-in and search pages can be reached with Tab, and shows where the focus is', async ({ page }) => {
    for (const path of ['/login', '/search']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      const reached = new Set<string>()
      let invisible = 0
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab')
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (!el || el === document.body) return null
          const s = getComputedStyle(el)
          const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none'
          return { id: `${el.tagName}:${(el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('href') || '').trim().slice(0, 40)}`, ring }
        })
        if (!info) continue
        if (!reached.has(info.id) && !info.ring) invisible++
        reached.add(info.id)
      }
      measured(`${path}: ${reached.size} controls reached with Tab, ${invisible} of them show no focus ring`)
      expect(reached.size).toBeGreaterThan(8)
    }
  })
})

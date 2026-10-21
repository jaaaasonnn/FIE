import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// G6 (fixed): one failed request could leave a page stuck for good: a script file that did not arrive left
// checkout on "Loading booking details…" with no way on, and a failed read of the booking said "Booking
// unavailable… pick new dates" although nothing was wrong with it. Now a read is tried again a few times
// (src/lib/clientFetch.ts), a script file that does not arrive is asked for again at most twice, without
// reloading the page (src/lib/chunkGuard.ts), and what still fails says so plainly with a Try again button.

const tryAgain = (page: Page) => page.getByRole('alert').filter({ hasText: 'Something went wrong loading this page' }).getByRole('button', { name: 'Try again' })
// A dropped connection is noticed after a round trip at least, never at once. Playwright's abort is instant,
// which in Firefox fails the app's first script files before the browser has read the guard further down the
// page's head (the guard cannot be put above Next's own script tags). Real failures take longer than reading a
// few kilobytes, so the test's do too.
const resetLater = (route: import('@playwright/test').Route) => new Promise((r) => setTimeout(r, 200)).then(() => route.abort('connectionreset'))
const cardButton = (page: Page) => page.getByRole('button', { name: 'Debit / Credit Card' })

async function checkoutFor(world: import('../../lib/world').World) {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  return { guest, home, bookingId }
}

test('checkout: the booking request is dropped once, and the page loads anyway @core', async ({ page, world, signIn }) => {
  const { guest, bookingId } = await checkoutFor(world)
  await signIn(guest)
  let dropped = 0
  await page.route('**/api/bookings?id=*', (route) => (dropped++ === 0 ? route.abort('connectionreset') : route.continue()))
  await page.goto(`/checkout/${bookingId}`)
  await expect(cardButton(page)).toBeVisible({ timeout: 15_000 })
  expect(dropped).toBeGreaterThanOrEqual(2)
})

test('checkout: the booking request keeps failing: "try again", never "Booking unavailable", and trying again works @core', async ({ page, world, signIn }) => {
  const { guest, bookingId } = await checkoutFor(world)
  await signIn(guest)
  let down = true
  await page.route('**/api/bookings?id=*', (route) => (down ? route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }) : route.continue()))
  await page.goto(`/checkout/${bookingId}`)
  await expect(tryAgain(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Booking unavailable')).toHaveCount(0)
  down = false
  await tryAgain(page).click()
  await expect(cardButton(page)).toBeVisible()
})

test('checkout: one of the app\'s script files does not arrive, and the page still becomes usable @core', async ({ page, world, signIn }) => {
  const { guest, bookingId } = await checkoutFor(world)
  await signIn(guest)
  let dropped = 0
  await page.route('**/_next/static/chunks/**/*.js', (route) => (dropped++ === 0 ? resetLater(route) : route.continue()))
  await page.goto(`/checkout/${bookingId}`)
  await expect(cardButton(page)).toBeVisible({ timeout: 20_000 })
  expect(dropped).toBeGreaterThan(1)
})

test('checkout: the app\'s script files never arrive: a plain message and Try again, not a spinner for ever @core', async ({ page, world, signIn }) => {
  const { guest, bookingId } = await checkoutFor(world)
  await signIn(guest)
  let loads = 0
  page.on('domcontentloaded', () => loads++)
  await page.route('**/_next/static/chunks/**/*.js', (route) => resetLater(route))
  await page.goto(`/checkout/${bookingId}`)
  await expect(tryAgain(page)).toBeVisible({ timeout: 20_000 })
  // Never reloaded: it does not go round for ever
  await page.waitForTimeout(3000)
  expect(loads).toBe(1)
  await page.unroute('**/_next/static/chunks/**/*.js')
  await tryAgain(page).click()
  await expect(cardButton(page)).toBeVisible({ timeout: 15_000 })
})

test('a listing whose request fails says "try again", not "not found" @core', async ({ page, world }) => {
  const host = await world.host()
  const home = await world.listing(host)
  let down = true
  await page.route(`**/api/listings/${home.id}`, (route) => (down ? route.abort('connectionreset') : route.continue()))
  await page.goto(`/listings/${home.id}`)
  await expect(tryAgain(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/not found/i)).toHaveCount(0)
  down = false
  await tryAgain(page).click()
  await expect(page.getByRole('heading', { name: home.title })).toBeVisible()
})

test('a search that is not answered says "try again", not "No properties found" @core', async ({ page }) => {
  let down = true
  await page.route('**/api/listings?*', (route) => (down ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue()))
  await page.goto('/search')
  await expect(tryAgain(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('No properties found')).toHaveCount(0)
  down = false
  await tryAgain(page).click()
  await expect(tryAgain(page)).toBeHidden()
})

test('the guest dashboard whose bookings do not load says "try again", not "No bookings yet" @core', async ({ page, world, signIn }) => {
  const { guest, home } = await checkoutFor(world)
  await signIn(guest)
  let down = true
  await page.route('**/api/bookings?guestId=*', (route) => (down ? route.abort('connectionreset') : route.continue()))
  await page.goto('/dashboard/guest')
  await expect(tryAgain(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('No bookings yet')).toHaveCount(0)
  down = false
  await tryAgain(page).click()
  await expect(page.getByText(home.title).first()).toBeVisible()
})

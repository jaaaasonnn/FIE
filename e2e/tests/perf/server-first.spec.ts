import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// G5: checkout, both dashboards, a listing and search come with their data from the server
// (src/lib/serverRead.ts) instead of fetching it from the browser after the page's JavaScript has run.
// Each is checked twice: the data is in the page's own HTML, and the page shows it with the browser's own
// request for it blocked (so it cannot have come from there). When the server has no answer the pages
// fetch from the browser as before: tests/chaos/server-first.spec.ts.

/** The page's HTML as the server sends it, with the browser's cookies. */
async function html(page: Page, url: string) {
  const res = await page.request.get(url)
  expect(res.status()).toBe(200)
  return res.text()
}

/** Refuses the browser's own requests to these API paths, and counts them. */
async function blockApi(page: Page, pattern: string | RegExp) {
  const asked: string[] = []
  await page.route(pattern, (route) => { asked.push(route.request().url()); return route.abort('blockedbyclient') })
  return asked
}

test('checkout comes with its booking', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await signIn(guest)
  expect(await html(page, `/checkout/${bookingId}`)).toContain(home.title)
  const asked = await blockApi(page, '**/api/bookings?id=*')
  await page.goto(`/checkout/${bookingId}`)
  await expect(page.getByRole('button', { name: 'Debit / Credit Card' })).toBeVisible()
  await expect(page.getByText(home.title).first()).toBeVisible()
  expect(asked).toEqual([])
})

test('the guest dashboard comes with its bookings', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  await world.mustBook(guest, home.id)
  await signIn(guest)
  expect(await html(page, '/dashboard/guest')).toContain(home.title)
  const asked = await blockApi(page, '**/api/bookings?guestId=*')
  await page.goto('/dashboard/guest')
  await expect(page.getByText(home.title).first()).toBeVisible()
  await expect(page.getByText('No bookings yet')).toHaveCount(0)
  expect(asked).toEqual([])
})

test('the host dashboard comes with its listings and bookings', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  await world.mustBook(guest, home.id)
  await signIn(host)
  expect(await html(page, '/dashboard/host')).toContain(home.title)
  const asked = await blockApi(page, /\/api\/(listings|bookings)\?hostId=/)
  await page.goto('/dashboard/host')
  await expect(page.getByText('Active Listings')).toBeVisible()
  await expect(page.getByText(home.title).first()).toBeVisible()
  expect(asked).toEqual([])
})

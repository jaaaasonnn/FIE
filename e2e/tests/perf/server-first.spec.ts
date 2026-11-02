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

test('a listing comes with the listing and its photos', async ({ page, world }) => {
  const host = await world.host()
  const home = await world.listing(host)
  expect(await html(page, `/listings/${home.id}`)).toContain(home.title)
  const asked = await blockApi(page, `**/api/listings/${home.id}`)
  await page.goto(`/listings/${home.id}`)
  await expect(page.getByRole('heading', { level: 1, name: home.title })).toBeVisible()
  expect(asked).toEqual([])
})

test('search comes with its first results', async ({ page, world }) => {
  const host = await world.host()
  const region = 'Upper East'
  const home = await world.listing(host, { region, city: `Bolga${Date.now().toString(36)}` })
  expect(await html(page, `/search?region=${encodeURIComponent(region)}`)).toContain(home.title)
  const asked = await blockApi(page, '**/api/listings?*')
  await page.goto(`/search?region=${encodeURIComponent(region)}`)
  await expect(page.getByText(home.title).first()).toBeVisible()
  expect(asked).toEqual([])
})

test('the admin overview comes with its figures', async ({ page, world, signIn }) => {
  const admin = await world.admin()
  await signIn(admin)
  expect(await html(page, '/admin')).toMatch(/\\?"totalUsers\\?":\d+/)
  const asked = await blockApi(page, '**/api/admin?type=*')
  await page.goto('/admin')
  await expect(page.getByText('Total Users')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access denied' })).toHaveCount(0)
  expect(asked).toEqual([])
})

// React must take over the HTML the server sent, not throw it away and draw the page again once its
// JavaScript has arrived: then the page would show its content no sooner than before. (A Suspense boundary
// inside these client pages did that; they have none now.)
test('each page keeps the copy the server sent', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const admin = await world.admin()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      ;(window as unknown as { __served?: Element | null }).__served = document.querySelector('body > div[hidden][id^="S:"] > *') ?? document.querySelector('main > *')
    })
  })
  const redrawn: string[] = []
  for (const [who, url] of [[guest, `/checkout/${bookingId}`], [guest, '/dashboard/guest'], [host, '/dashboard/host'], [null, `/listings/${home.id}`], [null, '/search'], [admin, '/admin']] as const) {
    await page.context().clearCookies()
    if (who) await signIn(who)
    for (let i = 0; i < 3; i++) {
      await page.goto(url)
      await page.waitForTimeout(500)
      const kept = await page.evaluate(() => document.querySelector('main > *') === (window as unknown as { __served?: Element | null }).__served)
      if (!kept) redrawn.push(`${url} (load ${i + 1})`)
    }
  }
  expect(redrawn).toEqual([])
})


import fs from 'fs'
import path from 'path'
import pg from 'pg'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// G5: checkout, both dashboards, a listing and search come with their data from the server
// (src/lib/serverRead.ts). When the server cannot read it in time, the page must still work exactly as it
// did when it fetched everything in the browser: its tries, "Try again" (G6), and no false "not found".
//
// The server's read is made to fail by locking the table it reads for longer than it waits, as the chaos
// set does for a slow database. The browser's own request then waits for the same lock, or is dropped or
// refused by the test. These run alone, in the chaos project.

const tryAgain = (page: Page) => page.getByRole('alert').filter({ hasText: 'Something went wrong loading this page' }).getByRole('button', { name: 'Try again' })
// Longer than the server waits for its read (read from the source: it imports Next's server modules)
const SERVER_READ_TIMEOUT_MS = Number(/SERVER_READ_TIMEOUT_MS = (\d+)/.exec(fs.readFileSync(path.resolve(__dirname, '../../../src/lib/serverRead.ts'), 'utf8'))![1])
const HOLD_MS = SERVER_READ_TIMEOUT_MS + 2000

/** Locks a table for HOLD_MS while `during` runs; returns once both are done (the lock is always let go). */
async function withTableLocked<T>(table: string, during: (release: () => Promise<void>) => Promise<T>): Promise<T> {
  const lever = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', password: 'e2e', database: 'fiegh_e2e' })
  await lever.connect()
  await lever.query('BEGIN')
  await lever.query(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`)
  let released = false
  const release = async () => { if (released) return; released = true; await lever.query('COMMIT'); await lever.end() }
  const timer = setTimeout(() => void release(), HOLD_MS) // the fault being injected: a fixed hold
  try {
    return await during(release)
  } finally {
    clearTimeout(timer)
    await release()
  }
}

const cardButton = (page: Page) => page.getByRole('button', { name: 'Debit / Credit Card' })

async function checkoutFor(world: import('../../lib/world').World) {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  return { guest, home, bookingId }
}

test.describe('checkout', () => {
  test('the server cannot read the booking in time and the browser\'s first request is dropped: the page loads anyway', async ({ page, world, signIn }) => {
    const { guest, bookingId } = await checkoutFor(world)
    await signIn(guest)
    let asked = 0
    await page.route('**/api/bookings?id=*', (route) => (asked++ === 0 ? route.abort('connectionreset') : route.continue()))
    await withTableLocked('Booking', async () => {
      await page.goto(`/checkout/${bookingId}`)
      await expect(cardButton(page)).toBeVisible({ timeout: 30_000 })
    })
    expect(asked, 'the browser fetched the booking itself, trying again after the dropped request').toBeGreaterThanOrEqual(2)
  })

  test('the server cannot read the booking and the browser\'s request keeps failing: "try again", never "Booking unavailable", and trying again works', async ({ page, world, signIn }) => {
    const { guest, bookingId } = await checkoutFor(world)
    await signIn(guest)
    let down = true
    await page.route('**/api/bookings?id=*', (route) => (down ? route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }) : route.continue()))
    await withTableLocked('Booking', async (release) => {
      await page.goto(`/checkout/${bookingId}`)
      await expect(tryAgain(page)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Booking unavailable')).toHaveCount(0)
      await release()
    })
    down = false
    await tryAgain(page).click()
    await expect(cardButton(page)).toBeVisible()
  })

  test('reached by a link while the server cannot read the booking: the browser fetches it, and the page loads', async ({ page, world, signIn }) => {
    const { guest, bookingId } = await checkoutFor(world)
    await signIn(guest)
    await page.goto('/dashboard/guest')
    const pay = page.getByRole('link', { name: /pay now/i }).first()
    await expect(pay).toBeVisible()
    let asked = 0
    await page.route('**/api/bookings?id=*', (route) => { asked++; return route.continue() })
    await withTableLocked('Booking', async () => {
      await pay.click()
      await expect(page).toHaveURL(new RegExp(`/checkout/${bookingId}`))
      await expect(cardButton(page)).toBeVisible({ timeout: 30_000 })
    })
    expect(asked).toBeGreaterThanOrEqual(1)
  })
})

test.describe('guest dashboard', () => {
  test('the server cannot read the bookings and the browser\'s request fails: "try again", not "No bookings yet", and trying again works', async ({ page, world, signIn }) => {
    const { guest, home } = await checkoutFor(world)
    await signIn(guest)
    let down = true
    await page.route('**/api/bookings?guestId=*', (route) => (down ? route.abort('connectionreset') : route.continue()))
    await withTableLocked('Booking', async (release) => {
      await page.goto('/dashboard/guest')
      await expect(tryAgain(page)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('No bookings yet')).toHaveCount(0)
      await release()
    })
    down = false
    await tryAgain(page).click()
    await expect(page.getByText(home.title).first()).toBeVisible()
  })
})

test.describe('host dashboard', () => {
  test('the server cannot read the bookings and the browser\'s request fails: "try again", and trying again works', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    await world.mustBook(guest, home.id)
    await signIn(host)
    let down = true
    await page.route('**/api/bookings?hostId=*', (route) => (down ? route.abort('connectionreset') : route.continue()))
    await withTableLocked('Booking', async (release) => {
      await page.goto('/dashboard/host')
      await expect(tryAgain(page)).toBeVisible({ timeout: 30_000 })
      await release()
    })
    down = false
    await tryAgain(page).click()
    await expect(page.getByText(home.title).first()).toBeVisible()
  })
})

test.describe('listing', () => {
  test('the server cannot read the listing and the browser\'s request fails: "try again", not "not found", and trying again works', async ({ page, world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    let down = true
    await page.route(`**/api/listings/${home.id}`, (route) => (down ? route.abort('connectionreset') : route.continue()))
    await withTableLocked('Listing', async (release) => {
      await page.goto(`/listings/${home.id}`)
      await expect(tryAgain(page)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(/not found/i)).toHaveCount(0)
      await release()
    })
    down = false
    await tryAgain(page).click()
    await expect(page.getByRole('heading', { name: home.title })).toBeVisible()
  })
})

test.describe('search', () => {
  test('the server cannot run the first search and the browser\'s is not answered: "try again", not "No properties found", and trying again works', async ({ page, world }) => {
    const host = await world.host()
    await world.listing(host)
    let down = true
    await page.route('**/api/listings?*', (route) => (down ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue()))
    await withTableLocked('Listing', async (release) => {
      await page.goto('/search')
      await expect(tryAgain(page)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('No properties found')).toHaveCount(0)
      await release()
    })
    down = false
    await tryAgain(page).click()
    await expect(tryAgain(page)).toBeHidden()
    await expect(page.locator('a[href^="/listings/"]').first()).toBeVisible()
  })
})

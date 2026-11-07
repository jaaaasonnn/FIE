import { devices } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { measured } from '../../lib/race'
import { recordShifts, shiftOf } from '../../lib/layoutShift'

// App shell, stage 1: zero layout shift on the pages that have the phone's bottom bar, at phone width.
// Chromium reports every shift (PerformanceObserver, "layout-shift"); a shift right after someone's input is
// not counted, as the browser's own Cumulative Layout Shift does not count it. Each page is opened fresh,
// left three seconds after it has loaded for anything that arrives late (the unread
// badge, the exchange rate, a hydrated form).

const PHONE = Object.fromEntries(Object.entries(devices['Pixel 7']).filter(([key]) => key !== 'defaultBrowserType'))
test.use(PHONE)

test.beforeEach(async ({ page }) => { await recordShifts(page) })

test('no layout shift at phone width on the pages with the bar, signed out', async ({ page }) => {
  for (const url of ['/', '/search', '/how-it-works', '/faq']) {
    const shift = await shiftOf(page, url)
    measured(`${url}: layout shift ${shift.total.toFixed(4)}`)
    expect(shift.total, `${url}: ${shift.worst.join('; ')}`).toBe(0)
  }
})

test('no layout shift at phone width on the pages with the bar, signed in', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  // An unread message, so the badge arrives while the page is being measured
  expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome', bookingId })).status).toBe(201)
  await signIn(guest)
  for (const url of ['/dashboard/guest', '/dashboard/guest/wishlist', '/dashboard/guest/messages', '/dashboard/guest/payments', '/account', `/bookings/${bookingId}`, '/']) {
    const shift = await shiftOf(page, url)
    measured(`${url}: layout shift ${shift.total.toFixed(4)}`)
    expect(shift.total, `${url}: ${shift.worst.join('; ')}`).toBe(0)
  }
})

// The same pages when every answer from the API arrives 1.5 s late, as on a slow phone line or a busy server:
// a page that fetches in the browser draws its loading state first, and what arrives must not move it about.
test('no layout shift at phone width when the answers arrive late, signed in', async ({ page, world, signIn }) => {
  test.setTimeout(120_000)
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await signIn(guest)
  await page.route('**/api/**', async (route) => {
    if (!route.request().url().includes('/api/auth/session')) await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fallback()
  })
  for (const url of ['/dashboard/guest/wishlist', `/bookings/${bookingId}`, '/dashboard/guest', '/dashboard/guest/messages', '/dashboard/guest/payments', '/account', '/']) {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(2500)
    const shift = await page.evaluate(() => (window as unknown as { __shift: { total: number; worst: string[] } }).__shift)
    measured(`late answers, ${url}: layout shift ${shift.total.toFixed(4)}`)
    expect(shift.total, `${url}: ${shift.worst.join('; ')}`).toBe(0)
  }
})


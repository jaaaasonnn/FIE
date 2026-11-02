import { devices } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { measured } from '../../lib/race'

// App shell, stage 1: zero layout shift on the pages that have the phone's bottom bar, at phone width.
// Chromium reports every shift (PerformanceObserver, "layout-shift"); a shift right after someone's input is
// not counted, as the browser's own Cumulative Layout Shift does not count it. Each page is opened fresh,
// left three seconds after it has loaded for anything that arrives late (the unread
// badge, the exchange rate, a hydrated form).

const PHONE = Object.fromEntries(Object.entries(devices['Pixel 7']).filter(([key]) => key !== 'defaultBrowserType'))
test.use(PHONE)

async function shiftOf(page: import('@playwright/test').Page, url: string) {
  // (the message inbox asks for new messages every few seconds, so a page is never idle: wait for it to
  // load, then three seconds more)
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(3000)
  return page.evaluate(() => (window as unknown as { __shift: { total: number; worst: string[] } }).__shift)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const record = { total: 0, worst: [] as string[] }
    ;(window as unknown as { __shift: typeof record }).__shift = record
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] })[]) {
        if (entry.hadRecentInput) continue
        record.total += entry.value
        for (const source of entry.sources ?? []) {
          const node = source.node as Element | undefined
          record.worst.push(`${entry.value.toFixed(4)} ${node?.nodeName ?? '?'}.${String(node && 'className' in node ? node.className : '').slice(0, 50)}`)
        }
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
})

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

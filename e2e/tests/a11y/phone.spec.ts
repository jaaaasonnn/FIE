import AxeBuilder from '@axe-core/playwright'
import { devices, type Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// App shell, stage 1: the accessibility scan (axe, WCAG 2.1 A and AA, as tests/a11y/axe.spec.ts) at phone width,
// on the pages that have the phone's bottom bar, with the bar's unread badge showing. There is no baseline
// for these: any problem fails.

const PHONE = Object.fromEntries(Object.entries(devices['Pixel 7']).filter(([key]) => key !== 'defaultBrowserType'))
test.use(PHONE)

async function scan(page: Page, where: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return result.violations.map((v) => `${v.impact}: ${where}: ${v.id} (${v.help}) e.g. ${v.nodes[0]?.target.join(' ')} ${v.nodes[0]?.html.slice(0, 120)}`)
}
async function visit(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'load' })
  await expect(page.locator('[data-bottom-bar]')).toBeVisible()
  await page.waitForTimeout(1500)
}

test('accessibility scan at phone width, signed out', async ({ page }) => {
  const found: string[] = []
  for (const url of ['/', '/search', '/how-it-works', '/faq', '/terms', '/privacy']) { await visit(page, url); found.push(...await scan(page, url)) }
  expect(found).toEqual([])
})

test('accessibility scan at phone width, as a guest with an unread message, and as a host', async ({ page, world, signIn }) => {
  test.setTimeout(180_000)
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome', bookingId })).status).toBe(201)
  const found: string[] = []
  await signIn(guest)
  for (const url of ['/', '/dashboard/guest', '/dashboard/guest/wishlist', '/dashboard/guest/messages', '/dashboard/guest/payments', '/account', `/bookings/${bookingId}`, `/profile/${guest.id}`]) {
    await visit(page, url)
    if (url === '/') await expect(page.locator('[data-bottom-bar] [data-unread-slot]')).toBeVisible()
    found.push(...await scan(page, `guest ${url}`))
  }
  await page.context().clearCookies()
  await signIn(host)
  for (const url of ['/dashboard/host/messages', '/account']) { await visit(page, url); found.push(...await scan(page, `host ${url}`)) }
  expect(found).toEqual([])
})

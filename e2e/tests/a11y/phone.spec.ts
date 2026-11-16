import AxeBuilder from '@axe-core/playwright'
import { devices, type Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { withPhotos } from '../../lib/photos'

// App shell, stage 1: the accessibility scan (axe, WCAG 2.1 A and AA, as tests/a11y/axe.spec.ts) at phone width,
// on the pages that have the phone's bottom bar, with the bar's unread badge showing. There is no baseline
// for these: any problem fails.

const PHONE = Object.fromEntries(Object.entries(devices['Pixel 7']).filter(([key]) => key !== 'defaultBrowserType'))
test.use(PHONE)

// AS38, a known accessibility limitation, not a pass (e2e/FINDINGS.md). On a phone, a search card with two or more
// photos has a strip that swipes sideways (stage 2), and the keyboard cannot scroll it: axe's
// scrollable-region-focusable. Accepted for now because the strip is a touch-only extra: the same photos are reached
// through the card's own link, on the listing page by its labelled thumbnails and its full-screen viewer, and making
// the strip focusable would put a focusable element inside a link, which is not valid HTML. Excluded here and only
// here: that one rule, that one element, on /search only. Every other rule still runs on the strip, and the rule
// still runs on every other element and page. A later accessibility pass should revisit it (for example a strip that
// does not scroll, with buttons of its own). The test below proves the exclusion is that narrow.
const AS38 = { rule: 'scrollable-region-focusable', target: '.search-card-strip', page: /^\/search\/?$/ }
type Violation = { id: string; impact?: string | null; help: string; nodes: { target: unknown[]; html: string }[] }
function withoutAs38<V extends Violation>(path: string, violations: V[]): V[] {
  if (!AS38.page.test(path)) return violations
  return violations
    .map((v) => v.id !== AS38.rule ? v : { ...v, nodes: v.nodes.filter((n) => !n.target.join(' ').includes(AS38.target)) })
    .filter((v) => v.nodes.length > 0)
}

async function scan(page: Page, where: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return withoutAs38(new URL(page.url()).pathname, result.violations)
    .map((v) => `${v.impact}: ${where}: ${v.id} (${v.help}) e.g. ${v.nodes[0]?.target.join(' ')} ${v.nodes[0]?.html.slice(0, 120)}`)
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

// AS38's exclusion is exactly as narrow as written above, and the listing page needs none: there the photos are
// reached by labelled thumbnails and the full-screen viewer (tester-fixes-2).
test('AS38: the search card photo strip is left out of one rule on /search only, and the listing page scans clean', async ({ page, world }) => {
  const host = await world.host()
  const city = `Photoville ${Date.now().toString(36)}`
  const home = await world.listing(host, { city })
  await withPhotos(home.id)
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

  // /search with that home's photos on a card: the limitation is really there, and only the strip, only for that rule
  await page.goto(`/search?q=${encodeURIComponent(city)}`, { waitUntil: 'load' })
  await expect(page.locator('.search-card-strip').filter({ visible: true }).first()).toBeVisible()
  await page.waitForTimeout(1500)
  const raw = (await new AxeBuilder({ page }).withTags(tags).analyze()).violations
  const limit = raw.find((v) => v.id === AS38.rule)
  expect(limit, 'the strip is still not reachable by keyboard: if this fails, AS38 is fixed and the exclusion can go').toBeTruthy()
  expect(limit!.nodes.some((n) => n.target.join(' ').includes(AS38.target))).toBe(true)
  // With the strip left out, /search has nothing else
  expect(withoutAs38('/search', raw).map((v) => v.id)).toEqual([])
  // The same answer on any other page is left exactly as axe gave it
  for (const other of ['/', `/listings/${home.id}`, '/search/x', '/searching']) expect(withoutAs38(other, raw)).toEqual(raw)
  // Another element failing the same rule on /search is still reported
  const fake = { id: AS38.rule, impact: 'serious', help: 'x', nodes: [{ target: ['.something-else'], html: '<div>' }] }
  expect(withoutAs38('/search', [fake])).toEqual([fake])

  // The listing page with the same six photos: the whole page clean at phone width, with no exclusion
  await page.goto(`/listings/${home.id}`, { waitUntil: 'load' })
  await expect(page.getByRole('button', { name: 'Photo 6 of 6', exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  const listing = (await new AxeBuilder({ page }).withTags(tags).analyze()).violations
  expect(listing.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
})

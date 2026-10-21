import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'

// Second go, Stage B findings fixed on branch fix-perf-1: G4, G9, G8, G10.

const PHOTOS = ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80']

/** Every image the page asked for, with the width the optimiser was asked for (null: not through it). */
function imageRequests(page: Page) {
  const seen: { url: string; width: number | null }[] = []
  page.on('request', (r) => {
    if (r.resourceType() !== 'image') return
    const u = new URL(r.url())
    seen.push({ url: r.url(), width: u.pathname === '/_next/image' ? Number(u.searchParams.get('w')) : null })
  })
  return seen
}

// G4: checkout and both dashboards downloaded each listing photo at full size (1200 px, about 120 KB) for an
// 80-px thumbnail, straight from the photo host.
test('thumbnails on checkout and both dashboards come through the image optimiser at thumbnail size', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS) } })
  const bookingId = await world.mustBook(guest, home.id)
  for (const [who, url] of [[guest, `/checkout/${bookingId}`], [guest, '/dashboard/guest'], [host, '/dashboard/host']] as const) {
    await page.context().clearCookies()
    await signIn(who)
    const seen = imageRequests(page)
    await page.goto(url)
    await expect(page.locator('img[src*="photo-1502672260266"]').first()).toBeVisible()
    const photo = seen.filter((s) => s.url.includes('photo-1502672260266'))
    expect(photo.length, `${url}: the listing photo was asked for`).toBeGreaterThan(0)
    for (const p of photo) {
      expect(p.width, `${url}: through the optimiser, not the original`).not.toBeNull()
      expect(p.width!, `${url}: at thumbnail size`).toBeLessThanOrEqual(384)
    }
    page.removeAllListeners('request')
  }
})

// G9: the first search cards are on screen at once but their photos were loading="lazy", and none was marked
// as the first to fetch, although the first card's photo is the page's largest paint. On the home page the first
// featured card was lazy too.
test('the first search photos load at once, the first one first; later ones wait', async ({ page, world }) => {
  const host = await world.host()
  for (let i = 0; i < 6; i++) {
    const home = await world.listing(host)
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS) } })
  }
  await page.goto('/search')
  const photos = page.locator('.listing-card img')
  await expect(photos.nth(5)).toBeAttached()
  const seen = await photos.evaluateAll((els) => els.slice(0, 6).map((e) => ({ loading: e.getAttribute('loading'), priority: e.getAttribute('fetchpriority') })))
  expect(seen[0]).toEqual({ loading: 'eager', priority: 'high' })
  for (const i of [1, 2, 3]) expect(seen[i], `card ${i + 1}`).toEqual({ loading: 'eager', priority: null })
  for (const i of [4, 5]) expect(seen[i].loading, `card ${i + 1}`).toBe('lazy')
})

test('the first featured home on the home page is not left lazy', async ({ page, world }) => {
  const host = await world.host()
  for (let i = 0; i < 2; i++) {
    const home = await world.listing(host)
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS), isFeatured: true } })
  }
  await page.goto('/')
  const photos = page.locator('article img')
  await expect(photos.nth(1)).toBeAttached()
  await expect(photos.first()).toHaveAttribute('loading', 'eager')
  await expect(photos.nth(1)).toHaveAttribute('loading', 'lazy')
})

// G8: back from a listing to search came back to the top of the results: on wider screens the list scrolls
// inside its own panel, which the browser does not restore, and the results arrive after the page is drawn.
test('back from a listing returns to the same place in the search results @core', async ({ page, world }) => {
  const host = await world.host()
  for (let i = 0; i < 14; i++) await world.listing(host)
  await page.goto('/search')
  const cards = page.locator('a.listing-card')
  await expect(cards.nth(13)).toBeAttached()
  // The list's own panel on a wide screen, the page itself on a phone
  const scroller = async () => page.evaluate(() => {
    const panel = document.querySelector('a.listing-card')?.closest('.md\\:overflow-y-auto') as HTMLElement | null
    return panel && panel.scrollHeight > panel.clientHeight && getComputedStyle(panel).overflowY === 'auto' ? 'panel' : 'page'
  })
  const where = await scroller()
  const position = () => page.evaluate((w) => (w === 'panel' ? (document.querySelector('a.listing-card')!.closest('.md\\:overflow-y-auto') as HTMLElement).scrollTop : window.scrollY), where)
  const target = cards.nth(10)
  await target.scrollIntoViewIfNeeded()
  const before = await position()
  expect(before, 'scrolled down the list').toBeGreaterThan(300)
  const href = await target.getAttribute('href')
  await target.click()
  await expect(page).toHaveURL(new RegExp(href!.split('?')[0]))
  await page.goBack()
  await expect(cards.nth(10)).toBeVisible()
  // Where it was, give or take the header (it changes height as the page scrolls on a phone). Which card is
  // there is not checked: tests running alongside add homes, which move the newest-first list down.
  await expect.poll(position, { message: `the ${where} is back where it was` }).toBeGreaterThan(before - 150)
  expect(await position()).toBeLessThan(before + 150)
})

import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { APP } from '../../lib/world'
import { measured } from '../../lib/race'

// Second go, Stage B findings fixed on branch fix-perf-1: G4, G9, G8, G10.

const PHOTOS = ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80']

/** The photo each listing thumbnail on the page is showing, once loaded, and the width the optimiser was asked for (null: not through it). */
async function shownPhotos(page: Page) {
  const imgs = page.locator('img[src*="photo-1502672260266"], img[srcset*="photo-1502672260266"]')
  await expect(imgs.first()).toBeVisible()
  await expect.poll(() => imgs.first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  return imgs.evaluateAll((els) => els.map((e) => {
    const u = new URL((e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src)
    return { url: u.href, width: u.pathname === '/_next/image' ? Number(u.searchParams.get('w')) : null }
  }))
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
    await page.goto(url)
    for (const p of await shownPhotos(page)) {
      expect(p.width, `${url}: through the optimiser, not the original`).not.toBeNull()
      expect(p.width!, `${url}: at thumbnail size`).toBeLessThanOrEqual(384)
    }
  }
})

// G9: the first search cards are on screen at once but their photos were loading="lazy", and none was marked
// as the first to fetch, although the first card's photo is the page's largest paint. On the home page the first
// featured card was lazy too.
test('the first search photos load at once, the first one first; later ones wait', async ({ page, world }) => {
  const host = await world.host()
  // In a region of their own: other tests add homes without photos alongside, newest first
  for (let i = 0; i < 6; i++) {
    const home = await world.listing(host, { region: 'Upper East', city: 'Bolgatanga' })
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS) } })
  }
  await page.goto('/search?region=Upper%20East')
  await expect(page.locator('a.listing-card img').nth(5)).toBeAttached()
  // By the card's place in the list: homes made alongside by other tests may have no photo
  const seen = await page.locator('a.listing-card').evaluateAll((cards) => cards.slice(0, 8).map((card, place) => {
    const img = card.querySelector('img')
    return img ? { place, loading: img.getAttribute('loading'), priority: img.getAttribute('fetchpriority') } : null
  }))
  const withPhoto = seen.filter((x): x is NonNullable<typeof x> => x !== null)
  expect(withPhoto.length).toBeGreaterThanOrEqual(4)
  for (const { place, loading, priority } of withPhoto) {
    expect(loading, `card ${place + 1}`).toBe(place < 4 ? 'eager' : 'lazy')
    expect(priority, `card ${place + 1}`).toBe(place === 0 ? 'high' : null)
  }
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

// G10: the home page was kept for an hour (revalidate 3600). A home switched off, put on hold or whose host was
// suspended stayed in its hero, linking to a page that is gone, for up to an hour. Now: usually at once, at most a
// minute (SU6: a copy another visit was drawing at the moment of the change is kept until the timed refresh).
const MINUTE_AND_A_BIT = 75_000

/** Opens the home page until it no longer links to the home; how long that took, in ms */
async function goneFromHomePage(page: Page, id: string) {
  const start = Date.now()
  await expect.poll(async () => {
    await page.goto('/')
    await expect(page.locator('main')).toBeVisible()
    return page.locator(`a[href="/listings/${id}"]`).count()
  }, { timeout: MINUTE_AND_A_BIT, intervals: [500, 1_000, 2_000] }).toBe(0)
  return Date.now() - start
}

test('a home switched off leaves the home page, usually at once and at most a minute later', async ({ page, world }) => {
  test.setTimeout(120_000)
  const host = await world.host()
  const home = await world.listing(host)
  // Made the hero's first choice for short stays: featured and rated highest
  await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS), isFeatured: true, avgRating: 5 } })
  // Any edit through the app has the page drawn again
  expect((await host.call('PATCH', `/api/listings/${home.id}`, { title: home.title })).status).toBe(200)
  await page.goto('/')
  await expect(page.locator(`a[href="/listings/${home.id}"]`).first()).toBeAttached()
  expect((await host.call('DELETE', `/api/listings/${home.id}`)).status).toBe(200)
  measured(`a switched-off home left the home page after ${await goneFromHomePage(page, home.id)} ms`)
})

test('the home page is kept for at most a minute between drawings (SU6)', async () => {
  // The bound on a copy that was being drawn at the moment of a change: Next keeps it until this refresh
  const res = await fetch(`${APP[0]}/`)
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toMatch(/^s-maxage=60\b/)
})

// SU6: Next keeps a drawn page stamped with the moment it was stored, not when its data was read. A visit that
// read the listings just before a home was switched off and stored the page just after the change marked it is
// kept as fresh: before, until the next change anywhere or five minutes. Four lanes at once: three visitors
// drawing the home page all the time and a host editing another listing (each edit marks the page, so drawings
// are always under way); the home is switched off in the middle of it, as one more visit arrives, then
// everything stops and nothing else marks the page. Up to ten rounds, until one leaves the home behind; that
// copy must be gone within a minute.
test('a home switched off while other visits are drawing the home page is gone from it within a minute (SU6)', async ({ page, world }) => {
  test.setTimeout(240_000)
  const host = await world.host()
  const other = await world.listing(host)
  const linked = async (id: string) => (await (await fetch(`${APP[0]}/`)).text()).includes(`/listings/${id}"`)
  for (let round = 0; round < 10; round++) {
    const home = await world.listing(host)
    // Above every other home in the hero's order, whatever other tests have left
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS), isFeatured: true, avgRating: 1_000 + round } })
    expect((await host.call('PATCH', `/api/listings/${home.id}`, { title: home.title })).status).toBe(200)
    await expect.poll(() => linked(home.id), { timeout: 10_000, message: 'the home is in the hero to begin with' }).toBe(true)

    let busy = true
    const lanes = [
      ...[0, 1, 2].map(async () => { while (busy) await fetch(`${APP[0]}/`).then((r) => r.text()).catch(() => '') }),
      (async () => { while (busy) { await host.call('PATCH', `/api/listings/${other.id}`, { title: other.title }); await new Promise((r) => setTimeout(r, 20)) } })(),
    ]
    await new Promise((r) => setTimeout(r, 300))
    // And one drawing started just before the switch-off, as a visitor arriving at that moment would
    expect((await host.call('PATCH', `/api/listings/${other.id}`, { title: other.title })).status).toBe(200)
    const arriving = fetch(`${APP[0]}/`).then((r) => r.text()).catch(() => '')
    expect((await host.call('DELETE', `/api/listings/${home.id}`)).status).toBe(200)
    busy = false
    await Promise.all([...lanes, arriving])
    if (!(await linked(home.id))) continue
    measured(`round ${round + 1}: a copy drawn at the moment of the switch-off kept the home; it went after ${await goneFromHomePage(page, home.id)} ms`)
    return
  }
  measured('no round left the home behind')
})

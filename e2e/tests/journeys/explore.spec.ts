import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import type { Actor, World } from '../../lib/world'

// App shell, stage 2: Explore, the home page on a phone (src/components/home/ExplorePhone.tsx). @core, so it
// runs in every set-up and goes by the screen's width: on a phone, Explore with no header, rows of live homes
// that leave when a home is switched off, put on hold or its host suspended, hearts that save; from 768 px up,
// the page as it was, and no Explore. Which cities get a row is tested in src/lib/exploreRows.test.ts.
// E2E_EXPLORE_SHOTS=1 saves pictures to e2e/.reports/explore.

const SHOTS = path.join(__dirname, '..', '..', '.reports', 'explore')
async function shot(page: Page, name: string) {
  if (!process.env.E2E_EXPLORE_SHOTS) return
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-${name}.png`) })
}
const isPhone = () => (test.info().project.use.viewport?.width ?? 1280) < 768
const PHOTOS = ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80']
// The home page is kept and drawn again after a change, at most a minute later (SU6)
const KEPT_PAGE_MS = 75_000

/** A home at the front of its city's row: featured, rated above anything else the tests make */
async function frontHome(world: World, host: Actor, title?: string) {
  const home = await world.listing(host, { city: 'Cape Coast', ...(title ? { title } : {}) })
  await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS), isFeatured: true, avgRating: 3_000 } })
  // An edit through the app, so the kept home page is drawn again (lib/homePage.ts)
  expect((await host.call('PATCH', `/api/listings/${home.id}`, { title: home.title })).status).toBe(200)
  return home
}

const card = (page: Page, id: string) => page.locator(`.explore-phone a[href="/listings/${id}"]`)
async function shown(page: Page, id: string): Promise<boolean> {
  await page.goto('/')
  return (await card(page, id).count()) > 0
}

test.describe('Explore on a phone', () => {
  test('the page: no header, the pill and chips, rows of at most eight cards, nothing from the desktop page @core', async ({ page, world }) => {
    test.setTimeout(KEPT_PAGE_MS + 30_000)
    const host = await world.host()
    const long = await frontHome(world, host, `A very long title for a home that runs well past the edge of any card ${Date.now()}`)
    const asked: string[] = []
    page.on('request', (r) => asked.push(r.url()))
    await page.goto('/')
    if (isPhone()) await expect.poll(() => shown(page, long.id), { timeout: KEPT_PAGE_MS }).toBe(true)
    if (!isPhone()) {
      await expect(page.locator('.explore-phone')).toBeHidden()
      await expect(page.locator('header.site-header')).toBeVisible()
      await expect(page.getByRole('radiogroup', { name: 'Rental type' })).toBeVisible()
      return
    }
    await expect(page.locator('header.site-header')).toBeHidden()
    await expect(page.locator('.explore-desktop')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Where to?' })).toBeVisible()
    const chips = page.getByRole('navigation', { name: 'Rental types' }).getByRole('link')
    await expect(chips).toHaveText(['Short Stay', 'Monthly', 'Long-Term', 'Checked homes'])
    expect(await chips.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([
      '/search?mode=SHORT_STAY', '/search?mode=TEMP_STAY', '/search?mode=PERMANENT', '/search?checked=true',
    ])
    const rows = page.locator('.explore-row')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(5)
    for (let i = 0; i < count; i++) expect(await rows.nth(i).locator('.explore-card').count()).toBeLessThanOrEqual(8)
    // Every card the same size, whatever its title (a long one once widened its card and its photo)
    const sizes = await page.locator('.explore-card').evaluateAll((cards) => cards.map((c) => { const r = c.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` }))
    expect(new Set(sizes).size, sizes.join(' ')).toBe(1)
    await shot(page, 'explore')

    // The desktop sections ask for nothing on a phone, and the hero's photos are not fetched
    await page.waitForLoadState('networkidle')
    expect(asked.filter((u) => /\/api\/listings\?featured|\/api\/listings\/region-counts/.test(u))).toEqual([])
    // (the hero asks Unsplash for 1600 px sources, and nothing else on the page does: app/page.tsx)
    expect(asked.filter((u) => decodeURIComponent(u).includes('w=1600'))).toEqual([])
  })

  test('each chip\'s words fit inside its pill at 320 to 430 px (the strip may run past the screen) @core', async ({ page }) => {
    test.skip(!isPhone(), 'Explore is the phone\'s page')
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      const chips = await page.locator('.explore-chip').evaluateAll((els) => els.map((el) => {
        const words = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect() })
        const box = el.getBoundingClientRect()
        return { text: (el.textContent ?? '').trim(), fits: el.scrollWidth <= el.clientWidth && words.every((w) => w.left >= box.left && w.right <= box.right && w.height <= box.height), lines: new Set(words.map((w) => Math.round(w.top))).size }
      }))
      expect(chips.map((c) => c.text)).toEqual(['Short Stay', 'Monthly', 'Long-Term', 'Checked homes'])
      for (const c of chips) expect(c, `${width}px "${c.text}"`).toMatchObject({ fits: true, lines: 1 })
    }
  })

  test('the chips open search with their filter on @core', async ({ page }) => {
    test.skip(!isPhone(), 'Explore is the phone\'s page')
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Rental types' }).getByRole('link', { name: 'Checked homes' }).click()
    await expect(page).toHaveURL(/\/search\?checked=true$/)
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Address and photos checked by FieGH' })).toBeChecked()
  })

  test('a home switched off, put on hold, or whose host is suspended leaves its row @core', async ({ page, world }) => {
    test.skip(!isPhone(), 'Explore is the phone\'s page')
    test.setTimeout(KEPT_PAGE_MS * 2 + 30_000)
    const admin = await world.admin()
    const [hostA, hostB, hostC] = [await world.host(), await world.host(), await world.host()]
    const off = await frontHome(world, hostA)
    const held = await frontHome(world, hostB)
    const suspended = await frontHome(world, hostC)
    await expect.poll(async () => (await shown(page, off.id)) && (await card(page, held.id).count()) > 0 && (await card(page, suspended.id).count()) > 0, { timeout: KEPT_PAGE_MS }).toBe(true)

    expect((await hostA.call('DELETE', `/api/listings/${off.id}`)).status).toBe(200)
    expect((await admin.call('POST', '/api/admin', { type: 'hold-listing', listingId: held.id })).status).toBe(200)
    expect((await admin.call('POST', '/api/admin/users', { userId: hostC.id, action: 'suspend', reason: 'An end-to-end test of Explore.' })).status).toBe(200)
    await expect.poll(async () => {
      await page.goto('/')
      return Promise.all([off, held, suspended].map((h) => card(page, h.id).count()))
    }, { timeout: KEPT_PAGE_MS }).toEqual([0, 0, 0])
  })

  test('the heart saves and unsaves a home, and shows it saved on the next visit @core', async ({ page, world, signIn }) => {
    test.skip(!isPhone(), 'Explore is the phone\'s page')
    test.setTimeout(KEPT_PAGE_MS + 30_000)
    const host = await world.host()
    const guest = await world.guest()
    const home = await frontHome(world, host)
    await signIn(guest)
    await expect.poll(() => shown(page, home.id), { timeout: KEPT_PAGE_MS }).toBe(true)
    const heart = page.locator(`.explore-phone [data-heart="${home.id}"]`).first()
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => db.wishlist.count({ where: { userId: guest.id, listingId: home.id } })).toBe(1)
    await shot(page, 'heart-saved')

    await page.goto('/')
    await expect(page.locator(`.explore-phone [data-heart="${home.id}"]`).first()).toHaveAttribute('aria-pressed', 'true')
    await page.locator(`.explore-phone [data-heart="${home.id}"]`).first().click()
    await expect(page.locator(`.explore-phone [data-heart="${home.id}"]`).first()).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => db.wishlist.count({ where: { userId: guest.id, listingId: home.id } })).toBe(0)
  })

  test('signed out, the heart goes to log in and back to Explore @core', async ({ page, world }) => {
    test.skip(!isPhone(), 'Explore is the phone\'s page')
    test.setTimeout(KEPT_PAGE_MS + 30_000)
    const home = await frontHome(world, await world.host())
    await expect.poll(() => shown(page, home.id), { timeout: KEPT_PAGE_MS }).toBe(true)
    await page.locator(`.explore-phone [data-heart="${home.id}"]`).first().click()
    await expect(page).toHaveURL(/\/login\?redirect=%2F$/)
  })
})

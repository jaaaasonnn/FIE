import AxeBuilder from '@axe-core/playwright'
import type { CDPSession, Locator, Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { withPhotos } from '../../lib/photos'
import { recordShifts, shiftOf } from '../../lib/layoutShift'
import { audit } from '../../lib/phoneFit'
import { setInsets, ISLAND } from '../../lib/installedApp'

// The listing page's photos (tester-fixes-2): components/listing/ListingGallery.tsx and PhotoViewer.tsx.
//  - The big photo is a strip that snaps to each photo (CSS scroll-snap): a finger swipes it.
//  - A tap or click on a photo or a thumbnail opens a full-screen viewer at that photo: a labelled modal dialog,
//    "2 / 6" (and "Photo 2 of 6" for a screen reader), Close of 44 px inside the safe areas, Escape and the arrow
//    keys, the focus back on what opened it, the page behind still, pinch-zoom not blocked, Back closes it and the
//    listing stays. Its code is fetched on the first press.
//  - On a touch screen ((hover: none)) the round arrows and the dots are gone: a small counter and a thin bar that is
//    not a button stay. Below 768 px the dots are gone in every browser, so no dot is stretched to 44 px.
//
// Real touch: Chromium's own touch input (DevTools Input.dispatchTouchEvent) in the Android set-up, so the browser
// itself scrolls and snaps the strip. WebKit (the iPhone and iPad set-ups) has no way for Playwright to send a swipe
// or a pinch: there the tests tap for real and move the strip by its scroll position, and the swipe, the pinch and
// the Dynamic Island are on e2e/REAL-PHONE-CHECKLIST.md.

const N = 6
const project = () => test.info().project.name
const touch = () => !!test.info().project.use.hasTouch
/** The set-ups where Chromium's DevTools protocol drives the page (real touch input, safe areas) */
const chromiumEngine = () => ['chromium', 'android'].includes(project())

async function openListing(page: Page, id: string) {
  await page.goto(`/listings/${id}`)
  // Running: React has the gallery's photos
  await page.waitForFunction(() => {
    const b = document.querySelector('.listing-gallery-slide')
    return !!b && Object.keys(b).some((k) => k.startsWith('__reactProps'))
  })
  await page.waitForLoadState('networkidle')
}
async function homeWithPhotos(world: import('../../lib/world').World) {
  const home = await world.listing(await world.host())
  await withPhotos(home.id, N)
  return home
}

const gallery = (page: Page) => page.locator('.listing-gallery')
const strip = (page: Page) => page.locator('.listing-gallery-strip')
const viewer = (page: Page) => page.locator('dialog.photo-viewer')
const counter = (page: Page) => page.locator('.listing-gallery-count')
/** The photo the strip has come to rest on (1-based), and whether it rests exactly on it (snapped) */
const resting = (s: Locator) => s.evaluate((el) => ({ photo: Math.round(el.scrollLeft / el.clientWidth) + 1, snapped: Math.abs(el.scrollLeft / el.clientWidth - Math.round(el.scrollLeft / el.clientWidth)) < 0.02 }))

async function press(page: Page, target: Locator) {
  if (touch()) await target.tap()
  else await target.click()
}

/** A finger dragged across `box` from 80% to 20% of its width (or down to up with `vertical`), through the browser's own touch input */
async function swipe(cdp: CDPSession, box: { x: number; y: number; width: number; height: number }, vertical = false) {
  const at = (f: number) => vertical
    ? { x: box.x + box.width / 2, y: box.y + box.height * f }
    : { x: box.x + box.width * f, y: box.y + box.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0.8)] })
  for (let s = 1; s <= 8; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(0.8 - s * 0.075)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** One photo on, as each browser can: a real swipe (Android), a sideways wheel (a desktop's trackpad), or the scroll position (WebKit on a phone or iPad) */
async function nextPhoto(page: Page, s: Locator) {
  const box = (await s.boundingBox())!
  if (project() === 'android') await swipe(await page.context().newCDPSession(page), box)
  else if (!touch()) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(box.width * 0.6, 0) }
  else await s.evaluate((el) => el.scrollBy({ left: el.clientWidth * 0.6, behavior: 'instant' }))
}

test.describe('listing photos: the gallery swipes and opens a full-screen viewer (tester-fixes-2)', () => {
  test('a tap on a photo opens the viewer at that photo; Escape closes it and the focus goes back @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await openListing(page, home.id)
    // The third photo in the gallery, then a tap on it
    await strip(page).evaluate((el) => el.scrollTo({ left: el.clientWidth * 2, behavior: 'instant' }))
    await expect(counter(page)).toHaveText('3 / 6')
    const third = page.getByRole('button', { name: 'View photo 3 of 6 full screen' })
    await press(page, third)
    const dialog = page.getByRole('dialog', { name: `Photos of ${home.title}` })
    await expect(dialog).toBeVisible()
    await expect(page.locator('.photo-viewer-count')).toContainText('3 / 6')
    await expect(page.locator('.photo-viewer-count .sr-only')).toHaveText('Photo 3 of 6')
    await expect.poll(() => resting(page.locator('.photo-viewer-strip'))).toEqual({ photo: 3, snapped: true })
    await expect(dialog.getByRole('group', { name: 'Photo 3 of 6' })).toBeInViewport({ ratio: 0.9 })
    // The photo itself has arrived from the image optimiser (the viewer writes its addresses itself)
    await expect.poll(() => dialog.getByRole('group', { name: 'Photo 3 of 6' }).locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    // The focus is inside, on Close
    await expect(dialog.getByRole('button', { name: 'Close photos' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toBeHidden()
    await expect(third).toBeFocused()
    await expect(page).toHaveURL(new RegExp(`/listings/${home.id}$`))
  })

  test('a thumbnail opens the viewer at its photo, and Close gives the focus back to it @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await openListing(page, home.id)
    const thumb = page.getByRole('button', { name: 'Photo 5 of 6', exact: true })
    await expect(thumb).toHaveAttribute('aria-haspopup', 'dialog')
    await press(page, thumb)
    await expect(viewer(page)).toBeVisible()
    await expect(page.locator('.photo-viewer-count')).toContainText('5 / 6')
    await expect.poll(() => resting(page.locator('.photo-viewer-strip'))).toEqual({ photo: 5, snapped: true })
    // The gallery is on that photo too
    await expect(counter(page)).toHaveText('5 / 6')
    await press(page, page.getByRole('button', { name: 'Close photos' }))
    await expect(viewer(page)).toBeHidden()
    await expect(thumb).toBeFocused()
    // Every thumbnail says which photo it is
    for (let i = 1; i <= N; i++) await expect(page.getByRole('button', { name: `Photo ${i} of ${N}`, exact: true })).toHaveCount(1)
  })

  test('swiping moves the gallery and the viewer one photo, and each comes to rest on a photo @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await openListing(page, home.id)
    await nextPhoto(page, strip(page))
    await expect(counter(page)).toHaveText('2 / 6')
    await expect.poll(() => resting(strip(page))).toEqual({ photo: 2, snapped: true })
    // The thumbnail of the photo shown is marked
    await expect(page.getByRole('button', { name: 'Photo 2 of 6', exact: true })).toHaveAttribute('aria-current', 'true')

    await press(page, page.getByRole('button', { name: 'View photo 2 of 6 full screen' }))
    await expect(viewer(page)).toBeVisible()
    const inside = page.locator('.photo-viewer-strip')
    await expect.poll(() => resting(inside)).toEqual({ photo: 2, snapped: true })
    await nextPhoto(page, inside)
    await expect(page.locator('.photo-viewer-count .sr-only')).toHaveText('Photo 3 of 6')
    await expect.poll(() => resting(inside)).toEqual({ photo: 3, snapped: true })
  })

  test('the arrow keys move between photos in the viewer, and a screen reader hears each one @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await openListing(page, home.id)
    await press(page, page.getByRole('button', { name: 'View photo 1 of 6 full screen' }))
    const count = page.locator('.photo-viewer-count')
    await expect(count).toHaveAttribute('aria-live', 'polite')
    await expect(count.locator('.sr-only')).toHaveText('Photo 1 of 6')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(count.locator('.sr-only')).toHaveText('Photo 3 of 6')
    await expect(count).toContainText('3 / 6')
    await expect.poll(() => resting(page.locator('.photo-viewer-strip'))).toEqual({ photo: 3, snapped: true })
    await page.keyboard.press('ArrowLeft')
    await expect(count.locator('.sr-only')).toHaveText('Photo 2 of 6')
    await expect.poll(() => resting(page.locator('.photo-viewer-strip'))).toEqual({ photo: 2, snapped: true })
  })

  test('Close is 44 px and inside the safe areas; the counter is above the home bar @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    // A phone with a Dynamic Island, where the browser can be told so (Chromium); elsewhere none
    const insets = chromiumEngine() ? ISLAND : { top: 0, bottom: 0, left: 0, right: 0 }
    if (chromiumEngine()) await setInsets(page.context(), page, insets)
    await openListing(page, home.id)
    await press(page, page.getByRole('button', { name: 'View photo 1 of 6 full screen' }))
    await expect(viewer(page)).toBeVisible()
    const v = page.viewportSize()!
    const close = (await page.getByRole('button', { name: 'Close photos' }).boundingBox())!
    expect(close.width).toBeGreaterThanOrEqual(44)
    expect(close.height).toBeGreaterThanOrEqual(44)
    expect(close.y, 'below the status bar and the Dynamic Island').toBeGreaterThanOrEqual(insets.top + 8)
    expect(close.x + close.width).toBeLessThanOrEqual(v.width - insets.right - 8)
    const count = (await page.locator('.photo-viewer-count').boundingBox())!
    expect(count.y + count.height, 'above the home bar').toBeLessThanOrEqual(v.height - insets.bottom - 8)
    // Close is drawn over the photos: a tap there reaches it
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: close.x + close.width / 2, y: close.y + close.height / 2 })
    expect(hit).toBe('Close photos')
  })

  test('the page behind does not scroll while the viewer is open, and nothing blocks a pinch @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await openListing(page, home.id)
    await page.evaluate(() => window.scrollTo(0, 40))
    await press(page, page.getByRole('button', { name: 'View photo 1 of 6 full screen' }))
    await expect(viewer(page)).toBeVisible()
    // Once the page is still: the press on the photo can bring it into view with a smooth scroll of its own (Firefox)
    let y = -1
    await expect.poll(async () => { const was = y; await page.waitForTimeout(150); y = await page.evaluate(() => window.scrollY); return y === was }).toBe(true)
    expect(await page.evaluate(() => [getComputedStyle(document.documentElement).overflow, getComputedStyle(document.body).overflow])).toEqual(['hidden', 'hidden'])
    const v = page.viewportSize()!
    if (project() === 'android') await swipe(await page.context().newCDPSession(page), { x: 0, y: 0, width: v.width, height: v.height }, true)
    else if (!touch()) { await page.mouse.move(v.width / 2, v.height / 2); await page.mouse.wheel(0, 800) }
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.scrollY)).toBe(y)

    // Pinch: the page can still be zoomed (no user-scalable=no or maximum-scale), and nothing in the viewer says otherwise
    const meta = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(meta).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale/)
    const actions = await page.evaluate(() => ['.photo-viewer', '.photo-viewer-strip', '.photo-viewer-slide', '.photo-viewer-slide img']
      .map((s) => getComputedStyle(document.querySelector(s)!).touchAction))
    for (const a of actions) expect(['auto', 'manipulation'].includes(a) || a.includes('pinch-zoom'), `touch-action ${a}`).toBe(true)
    if (project() === 'android') {
      // A real pinch through Chromium's own gesture input zooms the page in
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.synthesizePinchGesture', { x: v.width / 2, y: v.height / 2, scaleFactor: 2, gestureSourceType: 'touch' })
      await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBeGreaterThan(1.5)
    }
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toBeHidden()
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden')
  })

  test('Back closes the viewer and the listing stays; closing it leaves no extra step in the history @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await page.goto('/how-it-works')
    await openListing(page, home.id)
    const first = page.getByRole('button', { name: 'View photo 1 of 6 full screen' })
    await press(page, first)
    await expect(viewer(page)).toBeVisible()
    await page.goBack()
    await expect(viewer(page)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/listings/${home.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: home.title })).toBeVisible()
    await expect(first).toBeFocused()
    // Opened and closed with its own button: Back then leaves the listing, as if it had never been opened
    await press(page, first)
    await expect(viewer(page)).toBeVisible()
    await press(page, page.getByRole('button', { name: 'Close photos' }))
    await expect(viewer(page)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/listings/${home.id}$`))
    await page.goBack()
    await expect(page).toHaveURL(/\/how-it-works$/)
  })

  test('on a touch screen: no arrows or dots, a small counter and a thin bar; with a mouse on a desktop: arrows and dots as before @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await openListing(page, home.id)
    const touchScreen = await page.evaluate(() => matchMedia('(hover: none)').matches)
    const wide = page.viewportSize()!.width >= 768
    const arrows = gallery(page).getByRole('button', { name: /^(Previous|Next) photo$/ })
    const dots = gallery(page).locator('.listing-gallery-dots button')
    const bar = gallery(page).locator('.listing-gallery-bar')
    if (touchScreen) {
      await expect(arrows.first()).toBeHidden()
      await expect(arrows.last()).toBeHidden()
    } else {
      await expect(arrows.first()).toBeVisible()
      await expect(arrows.last()).toBeVisible()
    }
    if (!touchScreen && wide) {
      // A desktop with a mouse: the dots, 8 px, and no bar
      await expect(dots).toHaveCount(N)
      for (const box of await dots.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
        expect(Math.round(box.width)).toBe(8)
        expect(Math.round(box.height)).toBe(8)
      }
      await expect(bar).toBeHidden()
    } else {
      await expect(dots.first()).toBeHidden()
      await expect(bar).toBeVisible()
      const b = (await bar.boundingBox())!
      expect(b.height).toBeGreaterThanOrEqual(2)
      expect(b.height).toBeLessThanOrEqual(3)
      // Not a button and not reachable: drawn only
      expect(await bar.evaluate((el) => [el.getAttribute('aria-hidden'), getComputedStyle(el).pointerEvents, el.querySelectorAll('button, a, [tabindex]').length])).toEqual(['true', 'none', 0])
      const c = (await counter(page).boundingBox())!
      expect(c.height, 'a small counter').toBeLessThanOrEqual(26)
    }
    // No control stretched out of shape anywhere in the gallery (the 44 px rule made the 8 px dots 8 x 44 bars)
    const stretched = await gallery(page).evaluate((el) => Array.from(el.querySelectorAll('button'))
      .filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0 && !b.classList.contains('listing-gallery-slide'))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => Math.max(r.width, r.height) / Math.min(r.width, r.height) > 1.5)
      .map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`))
    expect(stretched).toEqual([])
    // The counter follows the photo when the desktop's arrow is pressed
    if (!touchScreen) {
      await arrows.last().click()
      await expect(counter(page)).toHaveText('2 / 6')
      await expect.poll(() => resting(strip(page))).toEqual({ photo: 2, snapped: true })
    }
  })

  test('no accessibility failures on the gallery or with the viewer open @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    await openListing(page, home.id)
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
    const closed = await new AxeBuilder({ page }).include('.listing-gallery').withTags(tags).analyze()
    expect(closed.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    await press(page, page.getByRole('button', { name: 'View photo 2 of 6 full screen' }))
    await expect(viewer(page)).toBeVisible()
    await page.waitForTimeout(300)
    const open = await new AxeBuilder({ page }).include('dialog').withTags(tags).analyze()
    expect(open.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    // A modal dialog: the page behind is out of reach
    expect(await page.evaluate(() => document.querySelector('dialog.photo-viewer')!.matches(':modal'))).toBe(true)
  })

  test('the viewer\'s code is fetched on the first press on a photo, not with the page or a scroll @core', async ({ page, world }) => {
    const home = await homeWithPhotos(world)
    const scripts: string[] = []
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()) })
    await openListing(page, home.id)
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo(0, 0))
    const before = scripts.length
    await expect(viewer(page)).toHaveCount(0)
    await press(page, page.getByRole('button', { name: 'View photo 1 of 6 full screen' }))
    await expect(viewer(page)).toBeVisible()
    expect(scripts.length, 'one more script file, fetched on the press').toBeGreaterThan(before)
  })

  test('the listing page with photos: no layout shift, and everything fits at phone widths', async ({ page, world }) => {
    test.skip(project() !== 'chromium', 'widths are set by the test')
    test.setTimeout(120_000)
    const host = await world.host()
    const home = await world.listing(host)
    await withPhotos(home.id, N)
    const bare = await world.listing(host)
    await recordShifts(page)
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      const shift = await shiftOf(page, `/listings/${home.id}`)
      expect(shift.total, `${width} px: ${shift.worst.join('; ')}`).toBe(0)
      expect(await audit(page, `listing ${width}`)).toEqual([])
    }
    // A desktop: every page has the header's own small shift at 1280 px (AS37, before this branch and on pages
    // with no photos); the photos add nothing to it
    await page.setViewportSize({ width: 1280, height: 800 })
    const withThem = await shiftOf(page, `/listings/${home.id}`)
    const without = await shiftOf(page, `/listings/${bare.id}`)
    expect(withThem.total.toFixed(4), withThem.worst.join('; ')).toBe(without.total.toFixed(4))
    expect(withThem.worst.join(' ')).not.toMatch(/gallery|photo/i)
  })
})

import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { openSheet } from '../../pages'

// App shell, stage 2, steps 5 and 6 (phones only; desktop as it was): the header steps aside on scroll and comes
// back (public/shell.js), never on checkout or log-in or while the menu or the sheet is open; Explore's rows are
// where they were after Back; the footer folds into sections; empty states with one action in the owner's words;
// placeholders in place of spinners; plain titles in place of the dark bands; sheets slide up unless motion is
// reduced. @core, so it runs in every set-up and goes by the screen's width. E2E_DETAILS_SHOTS=1 saves pictures.

const SHOTS = path.join(__dirname, '..', '..', '.reports', 'shell-details')
async function shot(page: Page, name: string) {
  if (!process.env.E2E_DETAILS_SHOTS) return
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-${name}.png`) })
}
const isPhone = () => (test.info().project.use.viewport?.width ?? 1280) < 768
const phonesOnly = () => test.skip(!isPhone(), 'a phone\'s')
const headerHidden = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-header-hidden'))
const ready = (page: Page) => page.waitForFunction(() => document.documentElement.hasAttribute('data-sheet-ready') || !document.querySelector('[data-search-sheet]'))

/** Scrolls as a person does, a little at a time, so the page's scroll events see the direction */
async function scrollBy(page: Page, dy: number) {
  const steps = 6
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'instant' }), dy / steps)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(150)
}

/** Waits for the phone's shell script (public/shell.js), which a page without the sheet loads too */
async function shellLoaded(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __fieSheet?: boolean }).__fieSheet === true)
}

test.describe('the header steps aside on scroll', () => {
  test('down hides it, up brings it back; the search page\'s bar moves with it @core', async ({ page, world }) => {
    phonesOnly()
    // Enough homes for the search page to scroll past its bar
    const host = await world.host()
    const city = `Sc${Date.now().toString(36)}`
    for (let i = 0; i < 6; i++) await world.listing(host, { city })
    await page.goto('/how-it-works')
    await shellLoaded(page)
    expect(await headerHidden(page)).toBe(false)
    await scrollBy(page, 600)
    expect(await headerHidden(page)).toBe(true)
    await expect.poll(async () => (await page.locator('header.site-header').boundingBox())!.y).toBeLessThan(-40)
    await shot(page, 'header-hidden')
    await scrollBy(page, -200)
    expect(await headerHidden(page)).toBe(false)
    await expect.poll(async () => Math.round((await page.locator('header.site-header').boundingBox())!.y)).toBe(0)

    await page.goto(`/search?q=${city}`)
    await shellLoaded(page)
    await scrollBy(page, 400)
    expect(await headerHidden(page)).toBe(true)
    // The search bar sits at the top of the screen, not under a gap where the header was
    // (measured where it is drawn: once scrolled, WebKit's phone set-up reports a visible area 16 px down the page,
    // visualViewport.offsetTop, and every stuck and fixed element's box 16 px up; its pictures show them in place)
    await expect.poll(() => page.locator('.under-header').evaluate((el) => Math.round(el.getBoundingClientRect().top + (visualViewport?.offsetTop ?? 0)))).toBe(0)
  })

  test('never on checkout or log-in, never while the menu or the sheet is open, never near the top @core', async ({ page, world, signIn }) => {
    phonesOnly()
    // Log-in
    await page.goto('/login')
    await shellLoaded(page)
    await scrollBy(page, 400)
    expect(await headerHidden(page)).toBe(false)
    // Checkout
    const guest = await world.guest()
    const home = await world.listing(await world.host())
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    await page.goto(`/checkout/${bookingId}`)
    await shellLoaded(page)
    await scrollBy(page, 400)
    expect(await headerHidden(page)).toBe(false)
    // The menu open
    await page.goto('/faq')
    await shellLoaded(page)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await scrollBy(page, 500)
    expect(await headerHidden(page)).toBe(false)
    await page.getByRole('button', { name: 'Close menu' }).click()
    // The sheet open (the search page)
    await page.goto('/search')
    await ready(page)
    await scrollBy(page, 300)
    await scrollBy(page, -300)
    await openSheet(page)
    expect(await headerHidden(page)).toBe(false)
  })

  test('desktop: the header never moves @core', async ({ page }) => {
    test.skip(isPhone(), 'the desktop\'s case')
    await page.goto('/how-it-works')
    await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'instant' }))
    await page.waitForTimeout(300)
    expect(await headerHidden(page)).toBe(false)
    expect(Math.round((await page.locator('header.site-header').boundingBox())!.y)).toBe(0)
  })
})

test.describe('motion', () => {
  test('with reduced motion the header and the sheet move without animation @core', async ({ browser }) => {
    phonesOnly()
    const context = await browser.newContext({ ...test.info().project.use, reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      await page.goto('/')
      const panel = await openSheet(page)
      expect(await panel.locator('.search-sheet-panel').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
      await page.goto('/how-it-works')
      expect(await page.locator('header.site-header').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
    } finally {
      await context.close()
    }
  })
})

test.describe('Explore after Back', () => {
  test('a row swiped along is where it was when Back brings Explore back @core', async ({ page, world }) => {
    phonesOnly()
    test.setTimeout(150_000)
    const host = await world.host()
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const h = await world.listing(host, { city: 'Cape Coast' })
      await db.listing.update({ where: { id: h.id }, data: { photos: JSON.stringify([`https://images.unsplash.com/photo-150267226${i}2-1c1ef2d93688?w=1200&q=80`]), isFeatured: true, avgRating: 3_100 + i } })
      ids.push(h.id)
    }
    expect((await host.call('PATCH', `/api/listings/${ids[0]}`, { title: 'Back test home' })).status).toBe(200)
    await expect.poll(async () => { await page.goto('/'); return page.locator(`.explore-phone a[href="/listings/${ids[0]}"]`).count() }, { timeout: 75_000 }).toBeGreaterThan(0)
    await ready(page)
    const strip = page.locator('.explore-strip').filter({ has: page.locator(`a[href="/listings/${ids[0]}"]`) })
    await strip.evaluate((el) => el.scrollTo({ left: el.clientWidth * 0.9, behavior: 'instant' }))
    await page.waitForTimeout(400)
    const before = await strip.evaluate((el) => el.scrollLeft)
    expect(before).toBeGreaterThan(100)
    const visible = strip.locator('.explore-card a').filter({ visible: true })
    const target = visible.nth(1)
    await target.click()
    await expect(page).toHaveURL(/\/listings\//)
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(async () => Math.abs((await strip.evaluate((el) => el.scrollLeft)) - before)).toBeLessThan(4)
  })
})

test.describe('the footer', () => {
  test('a phone: the lists fold into sections; the banner and the contact lines stay in view @core', async ({ page }) => {
    phonesOnly()
    await page.goto('/faq')
    const footer = page.locator('footer')
    await expect(footer.getByText('Never pay outside the app.')).toBeVisible()
    await expect(footer.getByRole('link', { name: 'support@fiegh.com' })).toBeVisible()
    await expect(footer.getByText('Accra, Ghana')).toBeVisible()
    for (const name of ['Explore', 'Hosting', 'Support']) {
      const fold = footer.locator('details.footer-fold').filter({ has: page.locator('summary', { hasText: name }) })
      await expect(fold).not.toHaveAttribute('open')
      expect(Math.round((await fold.locator('summary').boundingBox())!.height)).toBeGreaterThanOrEqual(48)
    }
    await expect(footer.getByRole('link', { name: 'Terms of Service' })).toBeHidden()
    await footer.locator('summary', { hasText: 'Support' }).click()
    await expect(footer.getByRole('link', { name: 'Terms of Service' }).filter({ visible: true })).toBeVisible()
    await footer.scrollIntoViewIfNeeded()
    await shot(page, 'footer-open')
  })

  test('desktop: the footer as it was, every list open, no sections @core', async ({ page }) => {
    test.skip(isPhone(), 'the desktop\'s case')
    await page.goto('/faq')
    const footer = page.locator('footer')
    await expect(footer.locator('details.footer-fold').filter({ visible: true })).toHaveCount(0)
    for (const name of ['Short Stays', 'Become a Host', 'Terms of Service']) await expect(footer.getByRole('link', { name }).filter({ visible: true })).toBeVisible()
    for (const name of ['Explore', 'Hosting', 'Support']) await expect(footer.getByRole('heading', { name, level: 4 })).toBeVisible()
  })
})

test.describe('empty pages, placeholders and titles on a phone', () => {
  test('a new guest: Trips, Wishlists and Messages say so, each with one thing to do; plain titles, no dark band @core', async ({ page, world, signIn }) => {
    phonesOnly()
    const guest = await world.guest()
    await signIn(guest)
    const cases: [string, string, string, string, string | null][] = [
      ['/dashboard/guest', 'No trips yet.', 'Your next stay starts with a search.', 'Find a home', null],
      ['/dashboard/guest/wishlist', 'Nothing saved yet.', 'Tap the heart on any home to keep it here.', 'Explore homes', 'Your Wishlist'],
      ['/dashboard/guest/messages', 'No messages yet.', 'Questions to a host land here.', 'Explore homes', 'Messages'],
    ]
    for (const [url, title, text, action, heading] of cases) {
      await page.goto(url)
      const empty = page.locator('.phone-empty').filter({ visible: true })
      await expect(empty).toHaveCount(1)
      await expect(empty.getByText(title)).toBeVisible()
      await expect(empty.getByText(text)).toBeVisible()
      await expect(empty.getByRole('link')).toHaveText([action])
      if (heading) {
        await expect(page.getByRole('heading', { level: 1, name: heading }).filter({ visible: true })).toHaveCount(1)
        // The dark band is the desktop's
        expect(await page.locator('div[style*="var(--brown-dark)"]').filter({ visible: true }).count()).toBe(0)
      }
      await shot(page, `empty-${url.split('/').pop()}`)
    }
    await page.goto('/dashboard/guest/payments')
    await expect(page.getByRole('heading', { level: 1, name: 'Payment History' }).filter({ visible: true })).toHaveCount(1)
    expect(await page.locator('div[style*="var(--brown-dark)"]').filter({ visible: true }).count()).toBe(0)
  })

  test('the host inbox: a plain title, no dark band @core', async ({ page, world, signIn }) => {
    phonesOnly()
    await signIn(await world.host())
    await page.goto('/dashboard/host/messages')
    await expect(page.getByRole('heading', { level: 1, name: 'Messages' }).filter({ visible: true })).toHaveCount(1)
    await expect(page.getByText('Chat with your guests').filter({ visible: true })).toBeVisible()
    expect(await page.locator('div[style*="var(--brown-dark)"]').filter({ visible: true }).count()).toBe(0)
  })

  test('search with nothing to show: the owner\'s words and Clear filters, which clears them @core', async ({ page }) => {
    phonesOnly()
    await page.goto(`/search?q=Nowhere${Date.now()}`)
    const empty = page.locator('.phone-empty').filter({ visible: true })
    await expect(empty.getByText('No homes match all of that.')).toBeVisible()
    await expect(empty.getByText('Try fewer filters or other dates.')).toBeVisible()
    await empty.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.locator('[data-search-pill]:visible')).toHaveText('Where to?')
  })

  test('while a page waits for its answer: placeholders the size of the content, no spinner @core', async ({ page, world, signIn }) => {
    phonesOnly()
    await signIn(await world.guest())
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    await page.route(/\/api\/(wishlists|payments|messages)(\?|$)/, async (route) => { await held; await route.fallback() })
    for (const url of ['/dashboard/guest/wishlist', '/dashboard/guest/payments', '/dashboard/guest/messages']) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('[aria-busy="true"]').filter({ visible: true }).first()).toBeVisible()
      await expect(page.locator('.animate-spin').filter({ visible: true })).toHaveCount(0)
      await shot(page, `placeholder-${url.split('/').pop()}`)
    }
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('the inbox\'s time label keeps its edge when "Just now" becomes "1m ago" (AS9) @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'The key is with the caretaker', bookingId })).status).toBe(201)
    await signIn(guest)
    await page.goto('/dashboard/guest/messages')
    const label = page.locator('button span.text-xs').filter({ hasText: /ago|now/ }).first()
    await expect(label).toBeVisible()
    const edges = await label.evaluate((el) => {
      const left = () => Math.round(el.getBoundingClientRect().left)
      el.textContent = 'Just now'
      const a = left()
      el.textContent = '12m ago'
      return [a, left()]
    })
    expect(edges[1]).toBe(edges[0])
  })
})

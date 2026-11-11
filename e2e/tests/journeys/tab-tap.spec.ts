import type { Page, Request, Route } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { recordShifts } from '../../lib/layoutShift'
import { audit } from '../../lib/phoneFit'
import type { Actor, World } from '../../lib/world'

// A tap on a bottom-bar tab answers at once (the real-phone finding of 2026-11-10: on an iPhone 17 Pro and an Android
// phone, in the installed app, Trips showed nothing for a second or two, so people tapped it again). public/bar.js,
// phones only: the tapped tab is marked at once, the page area shows that tab's placeholder in the new page's shape
// until the page is in place, and a second tap on the same tab while it loads does nothing.
//
// The server is made slow here: every move between pages (Next's RSC request) and every API answer but the session
// check arrives 1.5 s late. Next's prefetches are refused, so each tap really waits for the server, as it does for a
// page that is not kept (Trips, Profile, Messages' redirect). 390 px wide, in Chromium and the iPhone and Android
// set-ups. Layout shift is what Chromium reports; WebKit reports none, so the iPhone set-up checks the rest.

const DELAY_MS = 1500
const WITHIN_MS = 150

type Tab = 'explore' | 'wishlists' | 'trips' | 'messages' | 'profile'
const TABS: { tab: Tab; from: string; to: RegExp; title: string | null }[] = [
  { tab: 'trips', from: '/account', to: /\/dashboard\/guest$/, title: 'Your Bookings' },
  { tab: 'wishlists', from: '/dashboard/guest', to: /\/dashboard\/guest\/wishlist$/, title: 'Your Wishlist' },
  { tab: 'messages', from: '/dashboard/guest', to: /\/dashboard\/guest\/messages$/, title: 'Messages' },
  { tab: 'profile', from: '/dashboard/guest', to: /\/account$/, title: 'Profile' },
  // Explore: grey shapes only (no heading words to line up), and the header steps aside at the tap, as on Explore
  { tab: 'explore', from: '/dashboard/guest', to: /\/$/, title: null },
]

const isRsc = (req: Request) => !!req.headers()['rsc']
const isPrefetch = (req: Request) => { const h = req.headers(); return !!(h['next-router-prefetch'] || h['next-router-segment-prefetch']) }

/** The slow server: moves between pages and API answers 1.5 s late, prefetches refused (counted in `moves`) */
/** Requests still on their way, per page, and when the last one ended (to wait until every late answer has come) */
const inFlight = new WeakMap<Page, { open: Set<Request>; last: number }>()

/** Until nothing has been on its way for a second: every late answer has arrived, and what it sets off has too
 *  (the inbox marks a conversation read only once its list has come) */
async function allAnswered(page: Page) {
  const state = inFlight.get(page)!
  await expect.poll(() => state.open.size === 0 && Date.now() - state.last > 1000, { timeout: 20_000, intervals: [200] }).toBe(true)
}

async function slowServer(page: Page) {
  const state = { open: new Set<Request>(), last: Date.now() }
  inFlight.set(page, state)
  page.on('request', (req) => { state.open.add(req) })
  // Done when its answer has come, as the app's fetch is (Chromium reports a request "finished" only once its body has
  // been read, and the inbox never reads the body of its mark-read PATCH). A redirect (Messages' /messages) is one
  // request per hop: every hop is done with the last.
  const done = (req: Request) => { for (let r: Request | null = req; r; r = r.redirectedFrom()) state.open.delete(r); state.last = Date.now() }
  page.on('response', (res) => done(res.request()))
  page.on('requestfailed', done)
  const moves: string[] = []
  await page.route('**/*', async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (isRsc(req) && isPrefetch(req)) return route.abort()
    if (isRsc(req)) moves.push(url.pathname)
    if (isRsc(req) || (url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/session')) await new Promise((r) => setTimeout(r, DELAY_MS))
    await route.fallback().catch(() => {})
  })
  return moves
}

async function guestWithTrips(world: World): Promise<Actor> {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  expect((await guest.call('POST', '/api/wishlists', { userId: guest.id, listingId: home.id })).status).toBeLessThan(300)
  expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome', bookingId })).status).toBe(201)
  return guest
}

/** Watches, frame by frame from the tap, for the tapped tab to look chosen (and the page's own tab not), with a
 *  placeholder on screen: the bar's (#tab-loading) or the new page's own (aria-busy). Times are from the click event. */
async function watchTap(page: Page, tab: Tab, title: string | null) {
  await page.evaluate(({ tab, title }) => {
    const w = window as unknown as { __tap: { at: number; ready: number; placeholderTitleTop: number | null } }
    w.__tap = { at: 0, ready: 0, placeholderTitleTop: null }
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-accent-deep)'
    document.body.appendChild(probe)
    const chosen = getComputedStyle(probe).color
    probe.remove()
    const shown = (el: Element | null) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
    const check = () => {
      const tabs = Array.from(document.querySelectorAll<HTMLElement>('[data-bottom-bar] a[data-tab]'))
      const tapped = tabs.find((a) => a.dataset.tab === tab)
      const others = tabs.filter((a) => a.dataset.tab !== tab)
      if (!tapped || getComputedStyle(tapped).color !== chosen || others.some((a) => getComputedStyle(a).color === chosen)) return false
      const cover = document.getElementById('tab-loading')
      if (shown(cover)) {
        const heading = Array.from(cover!.querySelectorAll('h1, h2')).find((h) => h.textContent === title)
        if (heading) w.__tap.placeholderTitleTop = heading.getBoundingClientRect().top
        return true
      }
      return Array.from(document.querySelectorAll('[aria-busy="true"]')).some(shown)
    }
    window.addEventListener('click', (e) => {
      if (w.__tap.at || !(e.target instanceof Element) || !e.target.closest('[data-bottom-bar] a')) return
      w.__tap.at = performance.now()
      const frame = () => { if (check()) w.__tap.ready = performance.now(); else if (performance.now() - w.__tap.at < 5000) requestAnimationFrame(frame) }
      frame()
    }, true)
  }, { tab, title })
}

const tapState = (page: Page) => page.evaluate(() => (window as unknown as { __tap: { at: number; ready: number; placeholderTitleTop: number | null } }).__tap)

async function tap(page: Page, tab: Tab) {
  const link = page.locator(`[data-bottom-bar] a[data-tab="${tab}"]`)
  if (test.info().project.use.hasTouch) await link.tap()
  else await link.click()
}

/** After the page has arrived: the new page's own bar has the real state, and nothing of the tap is left */
async function expectSettled(page: Page, tab: Tab) {
  await expect(page.locator('#tab-loading')).toHaveCount(0)
  await expect(page.locator(`[data-bottom-bar] a[aria-current="page"]`)).toHaveAttribute('data-tab', tab)
  await expect(page.locator('[data-bottom-bar] [data-going]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-tab-going'))).toBe(false)
}

test.describe('a tap on a bottom-bar tab, with a slow server (390 px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await recordShifts(page)
  })
  test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })

  for (const { tab, from, to, title } of TABS) {
    test(`${tab}: the tab is marked and a placeholder in the page's shape is on screen within ${WITHIN_MS} ms; no layout shift when the page arrives @core`, async ({ page, world, signIn, browserName }) => {
      test.setTimeout(90_000)
      const guest = await guestWithTrips(world)
      await signIn(guest)
      await slowServer(page)
      await page.goto(from)
      await expect(page.locator('[data-bottom-bar] a[aria-current="page"]')).toHaveCount(1)
      await page.waitForLoadState('networkidle')
      await watchTap(page, tab, title)
      await page.evaluate(() => { const s = (window as unknown as { __shift: { total: number; worst: string[] } }).__shift; s.total = 0; s.worst = [] })

      await tap(page, tab)
      await expect.poll(async () => (await tapState(page)).ready, { timeout: 5000 }).toBeGreaterThan(0)
      const { at, ready, placeholderTitleTop } = await tapState(page)
      expect(ready - at, `${tab}: marked and a placeholder on screen ${Math.round(ready - at)} ms after the tap`).toBeLessThanOrEqual(WITHIN_MS)

      {
        // Still the placeholder, a second in: it covers the whole wait, not just the first frames
        await page.waitForTimeout(DELAY_MS - 500)
        await expect(page.locator('#tab-loading')).toBeVisible()
        expect(page.url()).not.toMatch(to)
      }
      await page.waitForURL(to, { timeout: 15_000 })
      await expectSettled(page, tab)

      if (title) {
        // The placeholder's title stood where the page's own title is drawn
        const real = page.locator('main').getByRole('heading', { name: title, exact: true }).filter({ visible: true }).first()
        await expect(real).toBeVisible({ timeout: 10_000 })
        const realTop = (await real.boundingBox())!.y
        if (placeholderTitleTop !== null) expect(Math.abs(realTop - placeholderTitleTop), `${tab}: the placeholder's title at ${placeholderTitleTop}, the page's at ${realTop}`).toBeLessThanOrEqual(2)
      }
      // Everything the page asks for has come (each answer 1.5 s late), and what those set off, then the shift is read
      await allAnswered(page)
      if (browserName === 'chromium') {
        const shift = await page.evaluate(() => (window as unknown as { __shift: { total: number; worst: string[] } }).__shift)
        expect(shift.total, `${tab}: ${shift.worst.join('; ')}`).toBe(0)
      }
    })
  }

  test('a second tap on the tab being opened does nothing: one move to the server, one new history entry @core', async ({ page, world, signIn }) => {
    test.setTimeout(90_000)
    const guest = await guestWithTrips(world)
    await signIn(guest)
    const moves = await slowServer(page)
    await page.goto('/account')
    await page.waitForLoadState('networkidle')
    moves.length = 0
    const before = await page.evaluate(() => history.length)
    const errors: string[] = []
    // (WebKit reports Sentry's session pings to the local stand-in, an http address under the https front, as errors)
    page.on('pageerror', (e) => { if (!e.message.includes('/api/1/envelope/')) errors.push(e.message) })

    await tap(page, 'trips')
    await page.waitForTimeout(250)
    await tap(page, 'trips')
    await page.waitForTimeout(250)
    await tap(page, 'trips')
    await page.waitForURL(/\/dashboard\/guest$/, { timeout: 15_000 })
    await expectSettled(page, 'trips')
    await page.waitForTimeout(DELAY_MS + 500)

    expect(moves.filter((p) => p === '/dashboard/guest'), `the moves to the server: ${moves.join(', ')}`).toHaveLength(1)
    expect(await page.evaluate(() => history.length)).toBe(before + 1)
    expect(errors).toEqual([])
    // The page is there once, whole
    await expect(page.locator('main').getByRole('heading', { name: 'Your Bookings', exact: true }).filter({ visible: true })).toHaveCount(1)
  })

  test('a tap on another tab while one is loading goes to the other; a tap on the page you are on puts the bar back @core', async ({ page, world, signIn }) => {
    test.setTimeout(90_000)
    const guest = await guestWithTrips(world)
    await signIn(guest)
    await slowServer(page)
    await page.goto('/dashboard/guest')
    await page.waitForLoadState('networkidle')

    await tap(page, 'profile')
    await expect(page.locator('#tab-loading')).toBeVisible()
    await tap(page, 'wishlists')
    await expect(page.locator('[data-bottom-bar] [data-going]')).toHaveAttribute('data-tab', 'wishlists')
    await page.waitForURL(/\/dashboard\/guest\/wishlist$/, { timeout: 15_000 })
    await expectSettled(page, 'wishlists')

    // On Wishlists, a tap on Trips and then on Wishlists (the page you are on): nothing is left marked or covered
    await tap(page, 'trips')
    await expect(page.locator('#tab-loading')).toBeVisible()
    await tap(page, 'wishlists')
    await expect(page.locator('#tab-loading')).toHaveCount(0)
    await expect(page.locator('[data-bottom-bar] [data-going]')).toHaveCount(0)
    await page.waitForTimeout(DELAY_MS * 2 + 500)
    await expect(page).toHaveURL(/\/dashboard\/guest\/wishlist$/)
    await expectSettled(page, 'wishlists')
  })

  // The phone fit check (lib/phoneFit.ts: nothing past the edge, no wrapped pills, no small text or targets) while each
  // placeholder is on screen, at the widths every phone page is checked at
  test('each placeholder passes the phone fit check at 320, 360, 390 and 430 px', async ({ page, world, signIn }) => {
    test.setTimeout(300_000)
    const guest = await guestWithTrips(world)
    await signIn(guest)
    await slowServer(page)
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 })
      for (const { tab, from, to } of TABS) {
        await page.goto(from)
        await expect(page.locator('[data-bottom-bar] a[aria-current="page"]')).toHaveCount(1)
        await tap(page, tab)
        await expect(page.locator('#tab-loading')).toBeVisible()
        expect(await audit(page, `${tab} placeholder at ${width}`), `${tab} at ${width} px`).toEqual([])
        await page.waitForURL(to, { timeout: 15_000 })
      }
    }
  })
})

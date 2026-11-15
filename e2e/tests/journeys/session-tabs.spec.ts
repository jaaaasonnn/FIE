import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { AuthPage } from '../../pages'

// Signing in and out, then using the bottom bar, without ever loading a page again (tester-fixes-1, item 1).
//
// The testers' finding: on a phone, after signing out and in again, the tabs went to the log-in page or to the
// wrong page although the person was signed in. Cause: the bar's tabs are prefetched while signed out, and the
// server answers a protected page with a move to /login; Next kept those answers after signing in and used them for
// the next taps. The fix is one place, src/context/AuthContext.tsx: router.refresh() after signing in, signing up and
// signing out drops every page the router kept. And /login sends a signed-in person on whenever they reach it, also
// after its own form has just signed them in.
//
// Phone width, in Chromium (390 px) and the iPhone and Android set-ups. Every move is a tap or a click; the test never
// loads a page itself after the first. The app may load one page in full at the moment of signing in: when log-in was
// reached through a protected tab's redirect, Next's refresh cannot redo that page in place and loads /login again
// (FINDINGS AS35). So the marker that says "no page load" is set again once signed in, and checked at every tap after.

const PHONE = { width: 390, height: 844 }
const onlyIn = () => test.skip(!['chromium', 'iphone', 'android'].includes(test.info().project.name), 'phone widths, in three set-ups')

type Tab = 'explore' | 'wishlists' | 'trips' | 'messages' | 'profile'
const WHERE: Record<Tab, { url: RegExp; heading: string | RegExp | null }> = {
  // Trips on a phone greets the person
  trips: { url: /\/dashboard\/guest$/, heading: /^Hi, / },
  wishlists: { url: /\/dashboard\/guest\/wishlist$/, heading: 'Your Wishlist' },
  messages: { url: /\/dashboard\/guest\/messages$/, heading: 'Messages' },
  profile: { url: /\/account$/, heading: 'Profile' },
  explore: { url: /\/$/, heading: null },
}

/** React has the page (a tap before then is a plain link, and loads a page) */
const running = (page: Page) => page.waitForFunction(() => {
  const a = document.querySelector('[data-bottom-bar] a, header a')
  return !!a && Object.keys(a).some((k) => k.startsWith('__reactFiber'))
})

async function tap(page: Page, t: Tab) {
  const link = page.locator(`[data-bottom-bar] a[data-tab="${t}"]`)
  if (test.info().project.use.hasTouch) await link.tap()
  else await link.click()
}

const markLoaded = (page: Page) => page.evaluate(() => { (window as unknown as { __loadedOnce: boolean }).__loadedOnce = true })

/** No page load since the marker was set */
async function noReload(page: Page, step: string) {
  expect(await page.evaluate(() => (window as unknown as { __loadedOnce?: boolean }).__loadedOnce === true), `${step}: the page was loaded again`).toBe(true)
}

/** Signed in: each tab reaches its own page, never log-in */
async function everyTab(page: Page, round: string) {
  for (const t of ['profile', 'trips', 'wishlists', 'messages', 'explore', 'profile'] as Tab[]) {
    await tap(page, t)
    await expect(page, `${round}: ${t}`).toHaveURL(WHERE[t].url)
    const heading = WHERE[t].heading
    if (heading) await expect(page.getByRole('heading', { level: 1, name: heading }), `${round}: ${t}`).toBeVisible()
    await expect(page.locator('#login-identifier'), `${round}: ${t} must not show log-in`).toHaveCount(0)
    await noReload(page, `${round}: ${t}`)
  }
}

async function logInHere(page: Page, guest: { email: string; password: string; name: string }, to: RegExp) {
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('#login-identifier')).toBeVisible()
  await new AuthPage(page).logIn(guest.email, guest.password)
  await expect(page).toHaveURL(to)
  await expect(page.locator('#login-identifier')).toHaveCount(0)
  // Who is signed in, said once
  await expect(page.locator('#toast-root').getByText(`Signed in as ${guest.name}`)).toHaveCount(1)
  await running(page)
  await markLoaded(page)
}

async function signOutFromProfile(page: Page) {
  await tap(page, 'profile')
  await expect(page).toHaveURL(WHERE.profile.url)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/$/)
  await running(page)
}

/** Signed out: a protected tab leads to log-in (and from there back to that tab once signed in) */
async function signedOutTabs(page: Page, round: string) {
  for (const t of ['trips', 'wishlists', 'messages', 'profile'] as Tab[]) {
    await tap(page, t)
    await expect(page, `${round}: signed out, ${t}`).toHaveURL(/\/login\?redirect=/)
    await expect(page.locator('#login-identifier'), `${round}: signed out, ${t}`).toBeVisible()
    await noReload(page, `${round}: signed out, ${t}`)
    if (t === 'profile') return
    // Back to a page with the bar, by its logo (log-in has no bar)
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/)
  }
}

test.describe('signing in and out, then the tabs, with no page loads (tester-fixes-1)', () => {
  test.beforeEach(async ({ page }) => {
    onlyIn()
    if (test.info().project.name === 'chromium') await page.setViewportSize(PHONE)
  })

  test('sign in from a tab, use every tab, sign out, sign in again, every tab again @core', async ({ page, world }) => {
    test.setTimeout(150_000)
    const guest = await world.guest()
    await page.goto('/')
    await running(page)
    await markLoaded(page)
    // Long enough for the bar's tabs to be prefetched while signed out (what Next then kept)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    await tap(page, 'profile')
    await noReload(page, 'signed out, Profile')
    await logInHere(page, guest, WHERE.profile.url)
    await everyTab(page, 'first sign-in')

    for (const round of ['second', 'third']) {
      await signOutFromProfile(page)
      await page.waitForTimeout(1500)
      await signedOutTabs(page, `${round} round`)
      await logInHere(page, guest, WHERE.profile.url)
      await everyTab(page, `${round} sign-in`)
    }
  })

  test('sign in from the header\'s Log in link, then every tab @core', async ({ page, world }) => {
    test.setTimeout(120_000)
    const guest = await world.guest()
    await page.goto('/how-it-works')
    await running(page)
    await markLoaded(page)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    // On a phone the header's Log in is in its menu
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.locator('a[href="/login"]:visible').first().click()
    await logInHere(page, guest, /\/dashboard\/guest$/)
    await everyTab(page, 'header sign-in')
  })

  test('a signed-in person who reaches /login right after its form signed them in is sent on @core', async ({ page, world }) => {
    test.skip(test.info().project.name === 'iphone', 'Playwright cannot answer a request with a redirect in WebKit')
    const guest = await world.guest()
    await page.goto('/login?redirect=%2Faccount')
    await page.waitForLoadState('load')
    // The first move to /account after signing in is answered with a move back to log-in, as a page the router kept
    // from before signing in was (the moves after it reach the server as usual)
    let sent = false
    await page.route('**/account*', async (route) => {
      const req = route.request()
      if (sent || !req.headers()['rsc'] || req.headers()['next-router-prefetch']) return route.fallback()
      sent = true
      await route.fulfill({ status: 307, headers: { location: '/login?redirect=%2Faccount' } })
    })
    await new AuthPage(page).logIn(guest.email, guest.password)
    await expect.poll(() => sent).toBe(true)
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('signing in says who you are signed in as, to a screen reader too @core', async ({ page, world }) => {
    const guest = await world.guest()
    await page.goto('/login')
    await page.waitForLoadState('load')
    await new AuthPage(page).logIn(guest.email, guest.password)
    await expect(page).toHaveURL(/\/dashboard\/guest$/)
    const toast = page.locator('#toast-root').getByText(`Signed in as ${guest.name}`)
    await expect(toast).toBeVisible()
    await expect(page.locator('#toast-root')).toHaveAttribute('role', 'status')
  })
})

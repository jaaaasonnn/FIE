import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { AuthPage } from '../../pages'
import { type Actor, type World } from '../../lib/world'

// App shell, stage 1: the phone's bottom bar (src/components/layout/BottomBar.tsx). @core, so it runs in every
// set-up and goes by the screen's width: on a phone (iPhone, Android) the bar is checked; from 768 px up (the
// desktops, the iPad) it must not be there at all. E2E_SHELL_SHOTS=1 saves pictures to e2e/.reports/app-shell.

const SHOTS = path.join(__dirname, '..', '..', '.reports', 'app-shell')
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHELL_SHOTS) return
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-${name}.png`) })
}
const isPhone = () => (test.info().project.use.viewport?.width ?? 1280) < 768
const bar = (page: Page) => page.locator('[data-bottom-bar]')
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: new RegExp(`^${name}`) })

/** A guest with a booking, a host, and the pages each has */
async function people(world: World) {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  return { host, guest, home, bookingId }
}

type Stop = { path: string; tab: string | null }
const signedOutWithBar: Stop[] = [
  { path: '/', tab: 'Explore' }, { path: '/search', tab: 'Explore' }, { path: '/how-it-works', tab: null },
  { path: '/faq', tab: null }, { path: '/terms', tab: null }, { path: '/privacy', tab: null },
]
const guestWithBar = (bookingId: string, guestId: string): Stop[] => [
  { path: '/dashboard/guest', tab: 'Trips' }, { path: '/dashboard/guest/wishlist', tab: 'Wishlists' },
  { path: '/dashboard/guest/messages', tab: 'Messages' }, { path: '/dashboard/guest/payments', tab: 'Profile' },
  { path: '/account', tab: 'Profile' }, { path: `/bookings/${bookingId}`, tab: 'Trips' }, { path: `/profile/${guestId}`, tab: null },
  { path: '/become-a-host', tab: null },
]
const guestWithoutBar = (bookingId: string, listingId: string) => [
  `/listings/${listingId}`, `/checkout/${bookingId}`, `/bookings/${bookingId}/problem`, '/profile/edit',
]

/**
 * Nothing fixed or sticky on the page is under the bar; and the buttons people press to pay or book, which are
 * part of the page, are clear of it whenever the browser brings them into view (scroll-padding in globals.css:
 * the same happens when they are reached with the keyboard).
 */
async function nothingUnderTheBar(page: Page, where: string) {
  const covered = await page.evaluate(async () => {
    const barEl = document.querySelector('[data-bottom-bar]')
    if (!barEl) return ['no bar']
    const b = barEl.getBoundingClientRect()
    const out: string[] = []
    const overlaps = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (barEl.contains(el) || el.closest('[data-bottom-bar]')) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const fixed = style.position === 'fixed' || style.position === 'sticky'
      const payOrBook = (el.tagName === 'BUTTON' || el.tagName === 'A') && /\b(pay|book|reserve|request to book)\b/i.test(el.textContent ?? '')
      if (!fixed && !payOrBook) continue
      if (!fixed) {
        el.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      }
      const r = el.getBoundingClientRect()
      if (overlaps(r)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${(el.textContent ?? '').trim().slice(0, 30)}"`)
    }
    return out
  })
  expect(covered, `${where}: under the bottom bar`).toEqual([])
  // Scrolled to the very end, the last of the page (the footer) ends above the bar, not behind it
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await page.waitForFunction(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1)
  const clear = await page.evaluate(() => {
    const b = document.querySelector('[data-bottom-bar]')!.getBoundingClientRect()
    const footer = document.querySelector('footer')
    const last = footer?.lastElementChild ?? footer
    return last ? last.getBoundingClientRect().bottom <= b.top + 1 : true
  })
  expect(clear, `${where}: the end of the page is not behind the bar`).toBe(true)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}

async function expectBar(page: Page, where: string, active: string | null) {
  await expect(bar(page), where).toBeVisible()
  for (const name of ['Explore', 'Wishlists', 'Trips', 'Messages', 'Profile']) await expect(tab(page, name), `${where}: ${name}`).toBeVisible()
  const current = page.locator('[data-bottom-bar] [aria-current="page"]')
  if (active) {
    await expect(current, `${where}: the tab marked as here`).toHaveCount(1)
    await expect(current).toHaveAttribute('href', await tab(page, active).getAttribute('href') ?? '')
  } else {
    await expect(current, `${where}: no tab marked as here`).toHaveCount(0)
  }
}

test.describe('the phone\'s bottom bar (app shell, stage 1)', () => {
  test('signed out: on the public pages, with the right tab marked, and nothing under it @core', async ({ page }) => {
    for (const stop of signedOutWithBar) {
      await page.goto(stop.path)
      if (!isPhone()) { await expect(bar(page), `${stop.path} at ${test.info().project.name}`).toBeHidden(); continue }
      await expectBar(page, stop.path, stop.tab)
      await nothingUnderTheBar(page, stop.path)
    }
    if (isPhone()) { await page.goto('/how-it-works'); await shot(page, 'signed-out') }
  })

  test('signed out: Wishlists, Trips, Messages and Profile lead to log in, and back to the tab after it @core', async ({ page, world }) => {
    test.skip(!isPhone(), 'the bar is for phones')
    const guest = await world.guest()
    const auth = new AuthPage(page)
    for (const [name, target] of [['Wishlists', '/dashboard/guest/wishlist'], ['Trips', '/dashboard/guest'], ['Messages', '/messages'], ['Profile', '/account']] as const) {
      await page.goto('/')
      await tab(page, name).click()
      await expect(page, name).toHaveURL(new RegExp(`/login\\?redirect=${encodeURIComponent(target).replace(/%2F/g, '(%2F|/)')}$`))
    }
    // Logging in from the last of them comes back to it (opened as a page of its own, so it is running when
    // the form is filled in; the click above landed on it through a redirect)
    await auth.gotoLogin(`?redirect=${encodeURIComponent('/account')}`)
    await auth.logIn(guest.email, guest.password)
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  })

  test('signed in: on every page it belongs to, with its tab marked; not on a listing, checkout, the problem form or profile editing @core', async ({ page, world, signIn }) => {
    const { guest, home, bookingId } = await people(world)
    await signIn(guest)
    for (const stop of guestWithBar(bookingId, guest.id)) {
      await page.goto(stop.path)
      await expect(page.locator('main')).toBeVisible()
      if (!isPhone()) { await expect(bar(page), stop.path).toBeHidden(); continue }
      await expectBar(page, stop.path, stop.tab)
      await nothingUnderTheBar(page, stop.path)
      if (stop.tab === 'Trips' && stop.path === '/dashboard/guest') await shot(page, 'trips-active')
    }
    for (const where of guestWithoutBar(bookingId, home.id)) {
      await page.goto(where)
      await expect(page.locator('main')).toBeVisible()
      await expect(bar(page), where).toHaveCount(0)
    }
  })

  test('Messages takes a host to the host inbox and a guest to theirs @core', async ({ page, world, signIn }) => {
    const { host, guest } = await people(world)
    for (const [person, inbox] of [[guest, '/dashboard/guest/messages'], [host, '/dashboard/host/messages']] as [Actor, string][]) {
      await page.context().clearCookies()
      await signIn(person)
      await page.goto('/messages')
      await expect(page).toHaveURL(new RegExp(`${inbox}$`))
      if (isPhone()) await expect(page.locator('[data-bottom-bar] [aria-current="page"]')).toHaveAttribute('href', '/messages')
    }
  })

  test('the unread badge counts the person\'s own unread messages, says so to a screen reader, and clears once read @core', async ({ page, world, signIn }) => {
    const { host, guest, bookingId } = await people(world)
    // Three to the guest, and one to the host that must not count for the guest
    for (const content of ['Welcome', 'The key is with the caretaker', 'See you soon']) {
      expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content, bookingId })).status).toBe(201)
    }
    expect((await guest.call('POST', '/api/messages', { receiverId: host.id, content: 'Thank you', bookingId })).status).toBe(201)
    const own = await guest.call('GET', '/api/messages/unread')
    expect(own.json).toEqual({ count: 3, signedIn: true })
    await signIn(guest)
    await page.goto('/')
    const badge = page.locator('[data-bottom-bar] [data-unread-slot]')
    if (!isPhone()) {
      // A desktop never loads the badge's script
      await page.waitForLoadState('networkidle')
      expect(await page.evaluate(() => (window as unknown as { __fieBar?: boolean }).__fieBar ?? false)).toBe(false)
      return
    }
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('33 unread messages')
    await expect(tab(page, 'Messages')).toHaveAccessibleName('Messages 3 unread messages')
    await shot(page, 'unread-badge')
    // Reading the conversation clears it
    expect((await guest.call('PATCH', '/api/messages', { otherUserId: host.id, bookingId })).status).toBe(200)
    expect((await guest.call('GET', '/api/messages/unread')).json.count).toBe(0)
    await page.goto('/search')
    await expect(badge).toBeHidden()
  })

  test('the bar steps aside while the keyboard is up, and comes back after @core', async ({ page }) => {
    test.skip(!isPhone(), 'the bar is for phones')
    await page.goto('/search')
    await expect(bar(page)).toBeVisible()
    const field = page.getByPlaceholder('Search by city, neighbourhood...')
    await field.focus()
    await expect(bar(page)).toBeHidden()
    await field.fill('Accra')
    await shot(page, 'keyboard-open')
    await field.blur()
    await expect(bar(page)).toBeVisible()
  })

  test('keeps clear of the iPhone home bar: the page may reach the edge, and the bar pads for it @core', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
    const rules = await page.evaluate(() => Array.from(document.styleSheets).flatMap((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText) } catch { return [] } }).join('\n'))
    expect(rules).toMatch(/\.bottom-bar \{[^}]*padding-bottom: env\(safe-area-inset-bottom/)
    expect(rules).toMatch(/--bottom-bar-offset: calc\(var\(--bottom-bar-height\) \+ env\(safe-area-inset-bottom/)
  })

  test('the account page: what a guest, a host and an admin each find there, and logging out @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const admin = await world.admin()
    const links = async () => (await page.locator('main .account-row').allTextContents()).map((t) => t.trim())
    for (const [person, has, hasNot] of [
      [guest, ['Become a host'], ['Hosting dashboard', 'Admin']],
      [host, ['Hosting dashboard'], ['Become a host', 'Admin']],
      [admin, ['Admin'], ['Hosting dashboard']],
    ] as [Actor, string[], string[]][]) {
      await page.context().clearCookies()
      await signIn(person)
      await page.goto('/account')
      const found = await links()
      for (const name of ['Edit your profile', 'Your public profile', 'Payments', 'Your ID', 'Log out', ...has]) expect(found, person.email).toContain(name)
      for (const name of hasNot) expect(found, person.email).not.toContain(name)
    }
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/account')
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)account$/)
  })
})

test.describe('stage 1 polish, on a phone', () => {
  test('the Trips icon is the header\'s own logo mark: the same asset, gold on Trips, grey elsewhere @core', async ({ page, world, signIn }) => {
    test.skip(!isPhone(), 'the bar is for phones')
    const guest = await world.guest()
    await signIn(guest)
    const markOf = (selector: string) => page.locator(selector).first().evaluate((el) => { const s = getComputedStyle(el); return { mask: s.maskImage || s.webkitMaskImage, colour: s.backgroundColor } })
    await page.goto('/')
    const header = await markOf('header .logo-mark')
    const idle = await markOf('[data-bottom-bar] .bottom-bar-mark')
    expect(header.mask).toContain('logo-mark.png')
    expect(idle.mask).toBe(header.mask)
    await page.goto('/dashboard/guest')
    const active = await markOf('[data-bottom-bar] .bottom-bar-mark')
    expect(active.mask).toBe(header.mask)
    expect(active.colour, 'gold on Trips, as the header logo').toBe(header.colour)
    expect(idle.colour, 'grey elsewhere').not.toBe(header.colour)
  })

  test('the header is 56 px tall on a phone, with the logo at its usual size @core', async ({ page }) => {
    test.skip(!isPhone(), 'phones only')
    await page.goto('/how-it-works')
    const bar = await page.locator('.site-header-bar').boundingBox()
    expect(Math.round(bar!.height)).toBe(56)
    const logo = await page.locator('header .logo-mark').boundingBox()
    expect(Math.round(logo!.height)).toBe(24)
  })

  test('the search dates read "Add date" in FieGH\'s style, side by side, never the browser\'s pattern @core', async ({ page }) => {
    test.skip(!isPhone(), 'phones only')
    await page.goto('/search')
    const faces = page.locator('.search-dates .date-field-face')
    await expect(faces).toHaveCount(2)
    for (const face of await faces.all()) await expect(face).toHaveText('Add date')
    await expect(faces.first()).toBeVisible()
    const inputs = page.locator('.search-dates input[type="date"]')
    expect(await inputs.first().evaluate((el) => getComputedStyle(el).color)).toBe('rgba(0, 0, 0, 0)')
    const [a, b] = [await inputs.nth(0).boundingBox(), await inputs.nth(1).boundingBox()]
    expect(Math.round(a!.y), 'check-in and check-out in one row').toBe(Math.round(b!.y))
    expect(Math.round(a!.height)).toBe(44)
    // Picking a date shows it in our words
    await inputs.first().fill('2027-03-10')
    await expect(faces.first()).toHaveText('Wed, 10 Mar')
  })

  test('Trips on a phone: a compact header, one row of figures, then the bookings; notices after them @core', async ({ page, world, signIn }) => {
    test.skip(!isPhone(), 'phones only')
    const { guest } = await people(world)
    await signIn(guest)
    await page.goto('/dashboard/guest')
    const hi = page.getByRole('heading', { name: /^Hi, / })
    await expect(hi).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Welcome back/ })).toBeHidden()
    await expect(page.getByRole('link', { name: /Verification pending · Verify ID/ })).toHaveAttribute('href', '/auth/verify-id')
    const top = async (locator: import('@playwright/test').Locator) => (await locator.boundingBox())!.y
    const figures = page.locator('dl').filter({ hasText: 'Bookings' }).first()
    const bookings = page.getByRole('heading', { name: 'Your Bookings' })
    const notices = page.getByRole('heading', { name: 'Recent Notifications' })
    expect(await top(hi)).toBeLessThan(await top(figures))
    expect(await top(figures)).toBeLessThan(await top(bookings))
    expect(await top(bookings)).toBeLessThan(await top(notices))
  })
})

test.describe('the unread count (GET /api/messages/unread)', () => {
  test('signed out it is 0 and not a failure; signed in it is the person\'s own, never someone else\'s', async ({ world }) => {
    const anon = await fetch('http://localhost:3200/api/messages/unread')
    expect(anon.status).toBe(200)
    expect(await anon.json()).toEqual({ count: 0, signedIn: false })
    expect(anon.headers.get('cache-control')).toContain('no-store')
    const { host, guest, bookingId } = await people(world)
    expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Hello', bookingId })).status).toBe(201)
    expect((await guest.call('GET', '/api/messages/unread')).json.count).toBe(1)
    expect((await host.call('GET', '/api/messages/unread')).json.count).toBe(0)
    // The count does not take anyone's id: there is nothing to ask for someone else's
    expect((await host.call('GET', `/api/messages/unread?userId=${guest.id}`)).json.count).toBe(0)
    expect(await db.message.count({ where: { receiverId: guest.id, isRead: false } })).toBe(1)
  })
})

/**
 * For the report: the header's logo and the Trips tab's mark side by side at 24, 28 and 48 px, drawn by the site's
 * own styles and asset (the header's .logo-mark and the bar's .bottom-bar-mark both mask public/logo-mark.png).
 */
test('the logo mark: the header logo and the Trips tab, side by side at 24, 28 and 48 px', async ({ page }) => {
  test.skip(!process.env.E2E_SHELL_SHOTS, 'pictures only when asked for')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/how-it-works')
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.id = 'logo-compare'
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;padding:24px;font:600 13px Manrope,sans-serif;color:#1F1B16;overflow:auto'
    const row = (size: number) => {
      const r = document.createElement('div')
      r.style.cssText = 'display:flex;gap:28px;align-items:flex-end;margin-bottom:22px'
      const cell = (label: string, el: HTMLElement) => { const c = document.createElement('div'); c.append(el); const t = document.createElement('div'); t.textContent = label; t.style.marginTop = '6px'; c.append(t); return c }
      const header = document.createElement('span'); header.className = 'logo-mark'; header.style.cssText = `display:block;font-size:${size}px`
      const active = document.createElement('a'); active.className = 'bottom-bar-tab'; active.setAttribute('aria-current', 'page'); active.style.cssText = 'height:auto;display:inline-block'
      const markA = document.createElement('span'); markA.className = 'bottom-bar-mark'; markA.style.cssText = `height:${size}px;width:${Math.round(size * 646 / 384)}px`; active.append(markA)
      const idle = document.createElement('a'); idle.className = 'bottom-bar-tab'; idle.style.cssText = 'height:auto;display:inline-block'
      const markI = document.createElement('span'); markI.className = 'bottom-bar-mark'; markI.style.cssText = `height:${size}px;width:${Math.round(size * 646 / 384)}px`; idle.append(markI)
      r.append(cell(`header, ${size} px`, header), cell(`tab active, ${size} px`, active), cell(`tab inactive, ${size} px`, idle))
      return r
    }
    for (const size of [24, 28, 48]) box.append(row(size))
    document.body.append(box)
  })
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.locator('#logo-compare').screenshot({ path: path.join(SHOTS, 'logo-compare.png') })
})

/** For the report: the main pages at 360 and 390 px, signed out and signed in with an unread message */
test('pictures of the main pages at 360 and 390 px @core', async ({ page, world, signIn }) => {
  test.skip(!process.env.E2E_SHELL_SHOTS || !['iphone', 'android'].includes(test.info().project.name), 'pictures only when asked for, on the phones')
  test.setTimeout(240_000)
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome, the key is with the caretaker', bookingId })).status).toBe(201)
  const dir = path.join(SHOTS, 'pages')
  fs.mkdirSync(dir, { recursive: true })
  const take = async (width: number, name: string, url: string) => {
    await page.setViewportSize({ width, height: Math.round(width * 2.05) })
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(dir, `${test.info().project.name}-${width}-${name}.png`) })
  }
  for (const width of [360, 390]) {
    for (const [name, url] of [['explore-signed-out', '/'], ['search-signed-out', '/search?q=Accra'], ['how-it-works', '/how-it-works']]) await take(width, name, url)
  }
  await signIn(guest)
  for (const width of [360, 390]) {
    for (const [name, url] of [['explore-signed-in-badge', '/'], ['search', '/search?q=Accra'], ['trips', '/dashboard/guest'], ['wishlists', '/dashboard/guest/wishlist'], ['messages', '/dashboard/guest/messages'], ['profile', '/account']]) await take(width, name, url)
  }
})

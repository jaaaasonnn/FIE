import AxeBuilder from '@axe-core/playwright'
import { chromium, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import type { World } from '../../lib/world'
import { readPng } from '../../lib/png'
import { audit } from '../../lib/phoneFit'
import { recordShifts, shiftOf } from '../../lib/layoutShift'
import { APP, ISLAND, cachesOf, installedApp, setInsets, standalone, workerInControl } from '../../lib/installedApp'
import { openSheet } from '../../pages'

// App shell stage 4: FieGH installed on a phone's home screen. The manifest and icons, Chromium's own install check,
// the offline page's service worker (registered only in the installed app, keeping only /offline.html), the top
// spacing in the installed app and the browser's layout left as it was, and the install hint on /account.
// The installed app is a real app window (display-mode: standalone; lib/installedApp.ts). Chromium only: the app
// window and the safe-area override are Chromium's. What only a real phone can show is e2e/REAL-PHONE-CHECKLIST.md.

const WIDTHS = [320, 360, 390, 430]
const BACKGROUND: [number, number, number] = [0xFA, 0xF7, 0xF2]
const CACHE = 'fiegh-offline-v1'
const OFFLINE = 'You are offline'

test.beforeEach(() => { test.skip(test.info().project.name !== 'chromium', 'the app window and the safe-area override are Chromium\'s') })

/** Every pixel solid, and how far from the middle (as a share of the width) any pixel unlike the background lies */
function iconFacts(file: Buffer) {
  const png = readPng(file)
  let transparent = 0, reach = 0
  const mid = png.width / 2
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const [r, g, b, a] = png.at(x, y)
    if (a < 255) transparent++
    if (Math.abs(r - BACKGROUND[0]) + Math.abs(g - BACKGROUND[1]) + Math.abs(b - BACKGROUND[2]) > 24) reach = Math.max(reach, Math.hypot(x + 0.5 - mid, y + 0.5 - mid) / png.width)
  }
  return { width: png.width, height: png.height, transparent, reach, corner: png.at(0, 0) }
}

async function homesIn(world: World, n: number) {
  const host = await world.host()
  const city = `Ia${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const homes = []
  for (let i = 0; i < n; i++) homes.push(await world.listing(host, { city, priceNightly: 80 + i }))
  return { city, homes }
}

const topOf = (page: Page, selector: string) => page.locator(selector).filter({ visible: true }).first().evaluate((el) => el.getBoundingClientRect().top)

test.describe('the installed app: manifest and icons', () => {
  test('the manifest is as decided, every icon is there at its size and solid, the maskable mark is inside Android\'s circle, and every page links them', async ({ request }) => {
    const answer = await request.get('/manifest.webmanifest')
    expect(answer.status()).toBe(200)
    expect(answer.headers()['content-type']).toContain('application/manifest+json')
    const manifest = await answer.json()
    expect(manifest).toEqual({
      id: '/', name: 'FieGH', short_name: 'FieGH',
      description: 'Short stays, monthly lets, and long-term leases, with Ghanaian roots and warm hospitality. Find your perfect home or start hosting on FieGH.',
      start_url: '/', scope: '/', display: 'standalone', background_color: '#FAF7F2', theme_color: '#FAF7F2',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })
    for (const icon of manifest.icons as { src: string; sizes: string; purpose: string }[]) {
      const file = await request.get(icon.src)
      expect(file.status(), icon.src).toBe(200)
      expect(file.headers()['content-type']).toBe('image/png')
      const facts = iconFacts(await file.body())
      const [w, h] = icon.sizes.split('x').map(Number)
      expect({ width: facts.width, height: facts.height }, icon.src).toEqual({ width: w, height: h })
      expect(facts.transparent, `${icon.src}: no transparent pixel (an iPhone fills them with black)`).toBe(0)
      expect(facts.corner.slice(0, 3), `${icon.src}: the corners are the background`).toEqual(BACKGROUND)
      // Android keeps a circle of 40% of the width from the middle, whatever shape it cuts
      if (icon.purpose === 'maskable') expect(facts.reach, `${icon.src}: the mark reaches ${facts.reach.toFixed(3)} of the width from the middle`).toBeLessThanOrEqual(0.4)
    }

    for (const url of ['/', '/search', '/faq', '/login']) {
      const html = await (await request.get(url)).text()
      const head = html.slice(0, html.indexOf('</head>'))
      expect(head, `${url}: the manifest`).toContain('<link rel="manifest" href="/manifest.webmanifest"/>')
      expect(head, `${url}: the iPhone's name for it`).toContain('<meta name="apple-mobile-web-app-title" content="FieGH"/>')
      expect(head, `${url}: the iPhone's status bar drawn above the page`).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default"/>')
      expect(head, `${url}: no theme colour in the browser`).not.toMatch(/name="theme-color"/)
      const apple = /<link rel="apple-touch-icon" href="([^"]+)" sizes="180x180" type="image\/png"\/>/.exec(head)
      expect(apple, `${url}: the iPhone's icon`).not.toBeNull()
      const facts = iconFacts(await (await request.get(apple![1])).body())
      expect({ width: facts.width, height: facts.height, transparent: facts.transparent }).toEqual({ width: 180, height: 180, transparent: 0 })
    }
  })

  test('Chromium\'s own install check finds nothing missing', async () => {
    // Full Chromium in a profile of its own (an incognito window can never install, and the headless shell's check
    // reports nothing even with an icon missing)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiegh-install-'))
    const context = await chromium.launchPersistentContext(dir, { channel: 'chromium' })
    try {
      const page = context.pages()[0] ?? await context.newPage()
      await page.goto(`${APP}/faq`)
      const cdp = await context.newCDPSession(page)
      const manifest = await cdp.send('Page.getAppManifest', {})
      expect(manifest.url).toBe(`${APP}/manifest.webmanifest`)
      expect(manifest.errors).toEqual([])
      await expect.poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, { timeout: 15_000 }).toEqual([])
    } finally {
      await context.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('/sw.js is sent with no-cache, as JavaScript, from this origin only, and the offline page has no script and no data', async ({ request }) => {
    const sw = await request.get('/sw.js')
    expect(sw.status()).toBe(200)
    expect(sw.headers()['content-type']).toBe('text/javascript; charset=utf-8')
    expect(sw.headers()['cache-control']).toBe('no-cache')
    expect(sw.headers()['service-worker-allowed']).toBeUndefined()
    const body = await sw.text()
    expect(body).toContain(JSON.stringify(CACHE))
    expect(body).toContain('"/offline.html"')
    const offline = await request.get('/offline.html')
    expect(offline.status()).toBe(200)
    const html = await offline.text()
    expect(html).toContain(`<h1>${OFFLINE}</h1>`)
    expect(html).not.toMatch(/<script|<img|<link|url\(/)
  })
})

test.describe('the installed app: the offline page\'s service worker', () => {
  test.describe('a browser tab', () => {
    test.use({ serviceWorkers: 'allow' })
    test('never registers the worker, at a phone\'s width or a desktop\'s, and never asks for /sw.js', async ({ page, context }) => {
      const asked: string[] = []
      context.on('request', (r) => { if (new URL(r.url()).pathname === '/sw.js') asked.push(r.url()) })
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 })
        for (const url of ['/', '/search', '/faq', '/how-it-works']) {
          await page.goto(url, { waitUntil: 'load' })
          await page.waitForTimeout(1500)
          expect(await standalone(page)).toBe(false)
          expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), `${width}px ${url}`).toBe(0)
        }
      }
      expect(context.serviceWorkers()).toEqual([])
      expect(asked).toEqual([])
    })
  })

  test('installed: the worker keeps only /offline.html, and browsing pages, the API and a listing stores nothing else', async ({ world, problems }) => {
    const { city, homes } = await homesIn(world, 2)
    const { app, close } = await installedApp({ problems, path: '/' })
    try {
      expect(await workerInControl(app)).toBe(`${APP}/sw.js`)
      for (const url of [`/search?q=${city}`, `/listings/${homes[0].id}`, '/how-it-works', '/faq']) await app.goto(`${APP}${url}`, { waitUntil: 'load' })
      expect(await app.evaluate(async () => (await fetch('/api/listings?limit=2')).status)).toBe(200)
      expect(await app.evaluate(async () => (await fetch('/api/messages/unread')).status)).toBe(200)
      expect(await cachesOf(app)).toEqual({ [CACHE]: [`${APP}/offline.html`] })
    } finally {
      await close()
    }
    expect(problems.pageErrors).toEqual([])
  })

  test('installed, with no network: a page shows "You are offline", and Try again brings the page back once the network is there', async ({ problems }) => {
    const { app, context, close } = await installedApp({ problems, path: '/' })
    try {
      await workerInControl(app)
      await context.setOffline(true)
      await app.goto(`${APP}/search?q=Accra`)
      await expect(app.getByRole('heading', { name: OFFLINE })).toBeVisible()
      expect(new URL(app.url()).pathname).toBe('/search')
      await context.setOffline(false)
      await app.getByRole('link', { name: 'Try again' }).click()
      await expect(app.locator('[data-search-pill]:visible')).toHaveText('Accra')
      await expect(app.getByRole('heading', { name: OFFLINE })).toHaveCount(0)
    } finally {
      await close()
    }
  })

  test('installed: a price changed is shown at once (nothing is kept)', async ({ world, problems }) => {
    const host = await world.host()
    const home = await world.listing(host, { priceNightly: 80 })
    const { app, close } = await installedApp({ problems, path: '/' })
    try {
      await workerInControl(app)
      await app.goto(`${APP}/listings/${home.id}`, { waitUntil: 'load' })
      await expect(app.locator('main')).toContainText('$80')
      await db.listing.update({ where: { id: home.id }, data: { priceNightly: 137 } })
      await app.reload({ waitUntil: 'load' })
      await expect(app.locator('main')).toContainText('$137')
      await expect(app.locator('main')).not.toContainText('$80')
    } finally {
      await close()
    }
  })

  test('installed: an HTTP error is passed on as it came (the site\'s own 404, not the offline page)', async ({ problems }) => {
    const { app, close } = await installedApp({ problems, path: '/' })
    try {
      await workerInControl(app)
      // (an address the site does not have: a missing listing is drawn by the listing page itself, with a 200)
      const answer = await app.goto(`${APP}/no-such-page-${Date.now()}`)
      expect(answer?.status()).toBe(404)
      await expect(app.getByRole('heading', { name: OFFLINE })).toHaveCount(0)
      // The 404 is part of the run, not a problem of the page
      problems.failedRequests.splice(0)
    } finally {
      await close()
    }
  })

  test('installed: the worker deletes every other cache when it takes over', async ({ problems }) => {
    const { app, close } = await installedApp({ problems })
    try {
      // Before the app's first page: a cache of an older version, and one of someone else's
      await app.evaluate(async () => {
        await (await caches.open('fiegh-offline-v0')).put('/old', new Response('old'))
        await (await caches.open('something-else')).put('/x', new Response('x'))
      })
      await app.goto(`${APP}/`)
      await workerInControl(app)
      await expect.poll(() => cachesOf(app)).toEqual({ [CACHE]: [`${APP}/offline.html`] })
    } finally {
      await close()
    }
  })
})

test.describe('the installed app: the top of the screen', () => {
  test('room for a status bar drawn over the page: the header, the search bar under it, the map\'s top bar, Explore and the search sheet clear it; in a browser tab nothing moved', async ({ world, problems, page, context }) => {
    test.setTimeout(120_000)
    const { city } = await homesIn(world, 8)
    const { app, close } = await installedApp({ problems, insets: ISLAND, path: `/search?q=${city}` })
    try {
      const top = ISLAND.top
      await app.waitForFunction(() => document.documentElement.hasAttribute('data-sheet-ready'))
      expect(await topOf(app, '.site-header-bar'), 'the header below the status bar').toBeGreaterThanOrEqual(top)
      // Scrolled: the header steps aside and leaves a strip over the status bar; the search bar stops under it
      for (let i = 0; i < 8; i++) { await app.mouse.wheel(0, 200); await app.waitForTimeout(80) }
      await expect.poll(() => app.evaluate(() => document.documentElement.hasAttribute('data-header-hidden'))).toBe(true)
      await app.waitForTimeout(400)
      expect(await app.evaluate((y) => !!document.elementFromPoint(195, y)?.closest('.site-header'), Math.floor(top / 2)), 'the status bar\'s strip is the header\'s').toBe(true)
      expect(Math.round(await topOf(app, '.under-header')), 'the search bar under the strip').toBe(top)
      for (let i = 0; i < 3; i++) { await app.mouse.wheel(0, -200); await app.waitForTimeout(80) }
      await expect.poll(() => app.evaluate(() => document.documentElement.hasAttribute('data-header-hidden'))).toBe(false)
      await app.waitForTimeout(400)
      expect(await topOf(app, '.site-header-bar'), 'the header back, below the status bar').toBeGreaterThanOrEqual(top)

      // The map, full screen: its top bar clears the status bar
      await app.evaluate(() => window.scrollTo(0, 0))
      await app.getByRole('button', { name: 'Map', exact: true }).click()
      await expect(app.getByRole('button', { name: 'Close' })).toBeVisible()
      expect(await app.getByRole('button', { name: 'Close' }).evaluate((el) => el.getBoundingClientRect().top), 'the map\'s Close below the status bar').toBeGreaterThanOrEqual(top)
      await app.getByRole('button', { name: 'Close' }).click()

      // Explore and the search sheet (they always had the inset)
      await app.goto(`${APP}/`)
      expect(await topOf(app, '.explore-pill'), 'Explore\'s pill').toBeGreaterThanOrEqual(top)
      const sheet = await openSheet(app)
      expect(await sheet.getByRole('combobox', { name: 'Where' }).evaluate((el) => el.getBoundingClientRect().top), 'the sheet\'s first field').toBeGreaterThanOrEqual(top)
    } finally {
      await close()
    }

    // A browser tab with the same insets: the rules are the installed app's only, so the header is where it was
    await page.setViewportSize({ width: 390, height: 844 })
    await setInsets(context, page, ISLAND)
    await page.goto(`/search?q=${city}`)
    expect(await standalone(page)).toBe(false)
    expect(await topOf(page, '.site-header-bar'), 'a browser tab: the header at the top, as before').toBe(0)
    expect(await page.locator('.site-header').evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px')
  })

  test('installed: no layout shift on the bar\'s pages, and everything fits at 320, 360, 390 and 430 px', async ({ world, problems }) => {
    test.setTimeout(240_000)
    const { city, homes } = await homesIn(world, 3)
    const guest = await world.guest()
    await guest.signIn()
    const { app, context, close } = await installedApp({ problems, insets: ISLAND, cookie: guest.cookie! })
    try {
      await recordShifts(context)
      for (const url of ['/', `/search?q=${city}`, '/how-it-works', '/faq', '/dashboard/guest', '/dashboard/guest/wishlist', '/account']) {
        const shift = await shiftOf(app, `${APP}${url}`)
        expect(shift.total, `${url}: ${shift.worst.join('; ')}`).toBe(0)
      }
      const found: string[] = []
      for (const width of WIDTHS) {
        await app.setViewportSize({ width, height: 844 })
        for (const url of ['/', `/search?q=${city}`, `/listings/${homes[0].id}`, '/dashboard/guest', '/account', '/how-it-works']) {
          await app.goto(`${APP}${url}`, { waitUntil: 'load' })
          await app.waitForTimeout(800)
          found.push(...await audit(app, `installed ${width}px ${url}`))
        }
      }
      expect(found).toEqual([])
    } finally {
      await close()
    }
    expect(problems.pageErrors).toEqual([])
  })
})

test.describe('the install hint on /account', () => {
  test('a phone: a folded row that opens to the steps, fits at every width and passes the accessibility scan; hidden on a desktop and in the installed app', async ({ page, world, signIn, problems }) => {
    test.setTimeout(120_000)
    const guest = await world.guest()
    await signIn(guest)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/account')
    const row = page.getByText('Add FieGH to your home screen')
    await expect(row).toBeVisible()
    const steps = page.locator('.account-install-steps')
    await expect(steps).toBeHidden()
    await row.click()
    await expect(steps).toBeVisible()
    await expect(steps).toContainText('Add to Home Screen')
    await expect(steps).toContainText('Install app')
    const found: string[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      await page.waitForTimeout(200)
      found.push(...await audit(page, `${width}px /account, the hint open`))
    }
    expect(found).toEqual([])
    await page.setViewportSize({ width: 390, height: 844 })
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])

    await page.setViewportSize({ width: 1280, height: 844 })
    await expect(page.locator('.account-install')).toBeHidden()

    const { app, close } = await installedApp({ problems, cookie: guest.cookie!, path: '/account' })
    try {
      await expect(app.getByRole('heading', { name: 'Profile' })).toBeVisible()
      await expect(app.locator('.account-install'), 'not inside the installed app').toBeHidden()
    } finally {
      await close()
    }
  })

  test('the offline page fits at every width and passes the accessibility scan', async ({ page }) => {
    const found: string[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      // (a static page: no React to wait for)
      await page.goto('/offline.html', { waitUntil: 'commit' })
      await page.waitForLoadState('load')
      found.push(...await audit(page, `${width}px /offline.html`))
    }
    expect(found).toEqual([])
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
  })
})

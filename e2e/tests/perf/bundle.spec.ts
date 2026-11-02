import fs from 'fs'
import http from 'http'
import path from 'path'
import zlib from 'zlib'
import { devices, type Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// G5 (mobile speed): how much script each main page downloads before anyone touches it, at phone and
// desktop sizes, counted compressed as it crosses the wire (what a phone on a slow line pays for).
//
//   - every page: at most 350 KB of script on first load. On desktop search that is the load before the
//     map is asked for; the map then loads on its own, and the whole page has its own cap of 650 KB;
//   - map code (MapLibre) on no page but search at desktop size, and never on a phone until "Map" is pressed;
//   - date-picker code (react-datepicker) on no page until a date field is opened.
//
// The home page is left out of the date-picker rule: its hero is being redesigned and was not changed in
// the mobile-speed branch, so it still loads its picker at once.
//
// Run with no throttling: it counts bytes, not time. Lighthouse (e2e/load/lighthouse.mjs) measures time.

const BUDGET_KB = 350
// App shell, stage 1: the bottom bar's unread badge, loaded at phone widths only (src/lib/bottomBar.ts)
const BAR_SCRIPT = '/bar.js'
const PAGES_WITH_BAR = ['home', 'search', 'guest dashboard']
const SEARCH_WITH_MAP_KB = 650
// Markers found only in the libraries' own code, never in the app's
const MAP_CODE = /maplibregl|maplibre-gl/
const PICKER_CODE = /react-datepicker__month-container/

type Loaded = { totalKB: number; mapKB: number; pickerKB: number; files: { url: string; kb: number; map: boolean; picker: boolean }[] }

/** A file's size as the server sends it (gzip, as to a browser), and its text */
function overTheWire(url: string): Promise<{ bytes: number; text: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks)
        const text = (res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw).toString('utf8')
        resolve({ bytes: raw.length, text })
      })
    }).on('error', reject)
  })
}

/** Collects every script the page fetches from now on, with its size on the wire and what it holds. */
function collect(page: Page) {
  const pending: Promise<Loaded['files'][number] | null>[] = []
  page.on('response', (r) => {
    // (a script file fetched by code counts too: the chunk guard once fetched the polyfills on every page)
    const type = r.request().resourceType()
    // The phone's bottom bar has one script outside the bundle (public/bar.js): it counts too
    const barScript = new URL(r.url()).pathname === BAR_SCRIPT
    if (!barScript && (!r.url().includes('/_next/') || !(type === 'script' || (type === 'fetch' && /\.js(\?|$)/.test(r.url()))))) return
    pending.push((async () => {
      try {
        const [sizes, body] = await Promise.all([r.request().sizes(), r.text()])
        // The map's worker file (maplibre 6) is fetched by the worker, so the page sees the request but not its
        // bytes: those are counted from the file itself, compressed as the server sends it
        if (sizes.responseBodySize === 0 && /\.m?js(\?|$)/.test(r.url())) {
          const wire = await overTheWire(r.url())
          return { url: r.url().replace(/^https?:\/\/[^/]+/, ''), kb: wire.bytes / 1024, map: MAP_CODE.test(wire.text), picker: PICKER_CODE.test(wire.text) }
        }
        return { url: r.url().replace(/^https?:\/\/[^/]+/, ''), kb: sizes.responseBodySize / 1024, map: MAP_CODE.test(body), picker: PICKER_CODE.test(body) }
      } catch { return null }
    })())
  })
  return async (): Promise<Loaded> => {
    // Each file once: a file fetched and then added as a script is downloaded once in a real browser
    const byUrl = new Map<string, Loaded['files'][number]>()
    for (const f of await Promise.all(pending)) if (f && f.kb >= (byUrl.get(f.url)?.kb ?? 0)) byUrl.set(f.url, f)
    const files = [...byUrl.values()]
    const sum = (fs: typeof files) => Math.round(fs.reduce((s, f) => s + f.kb, 0))
    return { totalKB: sum(files), mapKB: sum(files.filter((f) => f.map)), pickerKB: sum(files.filter((f) => f.picker)), files }
  }
}

/**
 * Every file comes over the wire, as on a first visit (a page loaded earlier in the test would fill the
 * cache). And the router's prefetching of linked pages is turned off: after a page has loaded, Next fetches
 * the pages its links point at, at low priority, scripts included (every page links home through the logo).
 * Those bytes are the linked page's, and are counted there.
 */
async function noCache(page: Page) {
  await page.route('**/*', (route) => route.request().headers()['next-router-prefetch'] ? route.abort('aborted') : route.fallback())
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
}

/** Opens a page and waits until it has stopped fetching (the desktop map is fetched once the list has drawn). */
async function load(page: Page, url: string) {
  await noCache(page)
  const done = collect(page)
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.waitForLoadState('networkidle')
  return done()
}

// Each page's files, for reading when the guard fails: e2e/.reports/bundle/<size>.json
const OUT = path.join(__dirname, '..', '..', '.reports', 'bundle')
function report(size: string, all: Record<string, Loaded>) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `${size}.json`), JSON.stringify(all, null, 1))
  for (const [name, l] of Object.entries(all)) test.info().annotations.push({ type: 'js', description: `${name}: ${l.totalKB} KB (map ${l.mapKB}, picker ${l.pickerKB}) in ${l.files.length} files` })
}

type Setup = { url: string; who?: 'guest' | 'host' | 'admin' }
async function pages(world: import('../../lib/world').World) {
  const host = await world.host()
  const guest = await world.guest()
  const admin = await world.admin()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  const people = { guest, host, admin }
  const list: [string, Setup][] = [
    ['home', { url: '/' }],
    ['search', { url: '/search' }],
    ['listing', { url: `/listings/${home.id}` }],
    ['checkout', { url: `/checkout/${bookingId}`, who: 'guest' }],
    ['guest dashboard', { url: '/dashboard/guest', who: 'guest' }],
    ['host dashboard', { url: '/dashboard/host', who: 'host' }],
    ['admin', { url: '/admin', who: 'admin' }],
  ]
  return { list, people, listingId: home.id }
}

// The device settings without the browser choice, which a describe block may not set
const device = (name: string) => Object.fromEntries(Object.entries(devices[name]).filter(([key]) => key !== 'defaultBrowserType'))
const PHONE = device('Pixel 7')
const DESKTOP = device('Desktop Chrome')

for (const [size, device] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
  test.describe(`script sent on first load, ${size}`, () => {
    test.use(device)

    test(`every main page is within ${BUDGET_KB} KB, with no map or date-picker code it does not need`, async ({ page, world, signIn }) => {
      test.setTimeout(180_000)
      const { list, people } = await pages(world)
      const over: string[] = []
      const all: Record<string, Loaded> = {}
      for (const [name, { url, who }] of list) {
        await page.context().clearCookies()
        if (who) await signIn(people[who])
        const l = await load(page, url)
        all[name] = l
        const mapAllowed = name === 'search' && size === 'desktop'
        const initial = mapAllowed ? l.totalKB - l.mapKB : l.totalKB
        if (initial > BUDGET_KB) over.push(`${name}: ${initial} KB${mapAllowed ? " before the map" : ""}, budget ${BUDGET_KB}`)
        if (!mapAllowed && l.mapKB > 0) over.push(`${name}: ${l.mapKB} KB of map code`)
        if (mapAllowed && l.totalKB > SEARCH_WITH_MAP_KB) over.push(`${name}: ${l.totalKB} KB with the map, cap ${SEARCH_WITH_MAP_KB}`)
        if (name !== 'home' && l.pickerKB > 0) over.push(`${name}: ${l.pickerKB} KB of date-picker code before a date field was opened`)
        const bar = l.files.some((f) => f.url === BAR_SCRIPT)
        if (size === 'desktop' && bar) over.push(`${name}: the phone's bottom-bar script was downloaded on a desktop`)
        if (size === 'phone' && PAGES_WITH_BAR.includes(name) && !bar) over.push(`${name}: the bottom bar's script was not counted on a phone`)
      }
      report(size, all)
      expect(over).toEqual([])
    })
  })
}

test.describe('loaded when asked for', () => {
  test.use(PHONE)

  test('on a phone the map is fetched only when "Map" is pressed, and then it draws', async ({ page }) => {
    await noCache(page)
    const done = collect(page)
    await page.goto('/search')
    await page.waitForLoadState('networkidle')
    expect((await done()).mapKB, 'map code before "Map" was pressed').toBe(0)
    const after = collect(page)
    await page.getByRole('button', { name: /^map$/i }).click()
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20_000 })
    expect((await after()).mapKB).toBeGreaterThan(0)
  })

  test('on a phone, a map file that does not arrive gives "Try again", and trying again draws the map', async ({ page }) => {
    let down = true
    await page.route('**/_next/static/chunks/**/*.js', async (route) => {
      const answer = await route.fetch()
      if (down && MAP_CODE.test(await answer.text())) return route.abort('connectionreset')
      return route.fulfill({ response: answer })
    })
    await page.goto('/search')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /^map$/i }).click()
    const tryAgain = page.getByRole('alert').getByRole('button', { name: 'Try again' })
    await expect(tryAgain).toBeVisible({ timeout: 20_000 })
    down = false
    await tryAgain.click()
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20_000 })
    // SU8: a chunk the handler is still fetching must not outlive the test (it threw outside any test)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('on the listing page the date picker is fetched when a date field is opened, and then it opens', async ({ page, world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    await noCache(page)
    const done = collect(page)
    await page.goto(`/listings/${home.id}`)
    await page.waitForLoadState('networkidle')
    expect((await done()).pickerKB, 'date-picker code before a date field was opened').toBe(0)
    const after = collect(page)
    await page.getByLabel('Check-in date').click()
    await expect(page.locator('.react-datepicker').first()).toBeVisible({ timeout: 20_000 })
    expect((await after()).pickerKB).toBeGreaterThan(0)
  })

  test('on the listing page, a date-picker file that does not arrive gives "Try again", and trying again opens the calendar', async ({ page, world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    let down = true
    await page.route('**/_next/static/chunks/**/*.js', async (route) => {
      const answer = await route.fetch()
      if (down && PICKER_CODE.test(await answer.text())) return route.abort('connectionreset')
      return route.fulfill({ response: answer })
    })
    await page.goto(`/listings/${home.id}`)
    await page.getByLabel('Check-in date').click()
    const tryAgain = page.getByRole('alert').getByRole('button', { name: 'Try again' })
    await expect(tryAgain).toBeVisible({ timeout: 20_000 })
    down = false
    await tryAgain.click()
    // (the field was already opened: the calendar opens by itself once it has arrived)
    await expect(page.locator('.react-datepicker').first()).toBeVisible({ timeout: 20_000 })
    // SU8: a chunk the handler is still fetching must not outlive the test (it threw outside any test)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})

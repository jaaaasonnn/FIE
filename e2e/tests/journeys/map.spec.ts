import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// The search map (src/components/map/ListingsMap.tsx): pins, a popup that links to the home, clusters that
// zoom apart or list homes that share a spot, Escape, and the map's own files and worker arriving without
// errors. On a phone the map is behind the "Map" button.
//
// The test stack has no real MapTiler: the style is a plain background, so there are no streets. Pins,
// clusters and popups are the real thing. E2E_MAP_SHOTS=<label> saves screenshots to e2e/.reports/map-shots.

// The map opens on Accra at zoom 11.5; everything here is placed inside that first view.
const ACCRA = { lat: 5.55, lng: -0.187 }

test.skip(({ browserName }) => browserName === 'firefox', 'headless Firefox has no WebGL here, so the map does not draw')

/** Collects what would show the map broke: page errors, map or worker errors in the console, files that failed */
function watchForMapTrouble(page: Page) {
  const trouble: string[] = []
  // (in the Safari set-ups the page is on https and the fake Sentry on plain http, so WebKit refuses its
  // reports and raises that as a page error: not the map's)
  page.on('pageerror', (e) => { if (!e.message.includes('/api/1/envelope/')) trouble.push(`page error: ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error' && /maplibre|worker|webgl|style|tile|glyph/i.test(m.text())) trouble.push(`console: ${m.text()}`) })
  page.on('requestfailed', (r) => { if (/\/_next\/|maplibre|worker/.test(r.url())) trouble.push(`failed: ${r.url()} ${r.failure()?.errorText}`) })
  page.on('response', (r) => { if (r.status() >= 400 && /\/_next\/|maplibre|worker/.test(r.url())) trouble.push(`${r.status()}: ${r.url()}`) })
  return trouble
}

/** Searches for the test's own city, so only its homes are on the map */
async function openMap(page: Page, city: string, count: number) {
  await page.goto('/search')
  await page.getByPlaceholder('Search by city, neighbourhood...').fill(city)
  await page.keyboard.press('Enter')
  await expect(page.getByText(`${count} propert`)).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Map', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await expect(page.locator('canvas.maplibregl-canvas:visible').first()).toBeVisible({ timeout: 20_000 })
}

async function shot(page: Page, name: string) {
  const label = process.env.E2E_MAP_SHOTS
  if (!label) return
  const dir = path.join(__dirname, '..', '..', '.reports', 'map-shots')
  fs.mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(400) // let a pan or zoom finish
  await page.screenshot({ path: path.join(dir, `${label}-${test.info().project.name}-${name}.png`) })
}

test.describe('the search map', () => {
  test('shows a pin for each home, and a pin opens a popup that links to it; Escape closes it @core', async ({ page, world }) => {
    const trouble = watchForMapTrouble(page)
    const host = await world.host()
    const city = `Osu${crypto.randomBytes(5).toString('hex')}`
    const west = await world.listing(host, { city, region: 'Greater Accra', priceNightly: 60, lat: ACCRA.lat, lng: ACCRA.lng - 0.03 })
    const east = await world.listing(host, { city, region: 'Greater Accra', priceNightly: 95, lat: ACCRA.lat + 0.005, lng: ACCRA.lng + 0.03 })
    await openMap(page, city, 2)

    const westPin = page.locator(`[data-map-pin="${west.id}"]`)
    await expect(westPin).toBeVisible()
    await expect(page.locator(`[data-map-pin="${east.id}"]`)).toBeVisible()
    await expect(westPin).toHaveText('$60')
    await shot(page, 'pins')

    await westPin.click()
    const popup = page.locator('.maplibregl-popup.map-popup')
    await expect(popup).toBeVisible()
    await expect(popup.getByText(west.title)).toBeVisible()
    await expect(popup.getByRole('link').first()).toHaveAttribute('href', new RegExp(`^/listings/${west.id}(\\?|$)`))
    await expect(westPin).toHaveAttribute('aria-expanded', 'true')
    await shot(page, 'popup')

    await popup.getByRole('button', { name: 'Close' }).click()
    await expect(popup).toHaveCount(0)

    // From the keyboard: Enter opens it with the focus on its link, Escape closes it and gives the pin the focus back
    // (a pointer press on a pin does not move the focus: the map stops the default on its markers)
    await westPin.focus()
    await page.keyboard.press('Enter')
    await expect(popup.getByRole('link').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await expect(westPin).toBeFocused()
    expect(trouble).toEqual([])
  })

  test('two homes close together are one cluster that zooms apart when pressed', async ({ page, world }) => {
    const trouble = watchForMapTrouble(page)
    const host = await world.host()
    const city = `Labone${crypto.randomBytes(5).toString('hex')}`
    const homes = [
      await world.listing(host, { city, region: 'Greater Accra', lat: ACCRA.lat, lng: ACCRA.lng }),
      await world.listing(host, { city, region: 'Greater Accra', lat: ACCRA.lat + 0.0004, lng: ACCRA.lng + 0.0004 }),
    ]
    await openMap(page, city, 2)

    const cluster = page.getByRole('button', { name: '2 homes. Zoom in' })
    await expect(cluster).toBeVisible()
    for (const home of homes) await expect(page.locator(`[data-map-pin="${home.id}"]`)).toHaveCount(0)
    await shot(page, 'cluster')

    await cluster.click()
    for (const home of homes) await expect(page.locator(`[data-map-pin="${home.id}"]`)).toBeVisible({ timeout: 10_000 })
    await expect(cluster).toHaveCount(0)
    expect(trouble).toEqual([])
  })

  test('homes at the same spot are listed when their cluster is pressed, each a link', async ({ page, world }) => {
    const trouble = watchForMapTrouble(page)
    const host = await world.host()
    const city = `Ridge${crypto.randomBytes(5).toString('hex')}`
    const homes = []
    for (let i = 0; i < 3; i++) homes.push(await world.listing(host, { city, region: 'Greater Accra', lat: ACCRA.lat, lng: ACCRA.lng }))
    await openMap(page, city, 3)

    await page.getByRole('button', { name: '3 homes. Show list' }).click()
    const popup = page.locator('.maplibregl-popup.map-popup')
    await expect(popup.getByText('3 homes here')).toBeVisible()
    for (const home of homes) {
      await expect(popup.getByRole('link', { name: new RegExp(home.title) })).toHaveAttribute('href', new RegExp(`^/listings/${home.id}(\\?|$)`))
    }
    await shot(page, 'list')
    expect(trouble).toEqual([])
  })
})

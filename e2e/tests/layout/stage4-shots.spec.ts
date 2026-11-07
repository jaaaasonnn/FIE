import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { comparePng } from '../../lib/png'
import { measured } from '../../lib/race'

// App shell stage 4: in a browser tab, every page looks exactly as it did on main, pixel for pixel. Not a check of the
// normal runs: only with E2E_STAGE4_SHOTS=<label>, which saves e2e/.reports/stage4-shots/<label>/. With
// E2E_STAGE4_BASE=<label> as well, each picture is compared with that label's picture of the same name: same size,
// no pixel more than one colour level different (NOISE, below; a picture of the differences is saved beside it). Run once on a build of main, once on the
// branch. The same homes, people and words each time; the map's area and the person's email are the only parts
// covered (the map draws with the GPU; the email carries the run's id), and in WebKit the logo's mark (below).
// Phones: 320, 390 and 430 px in Chromium, and the iPhone and Android set-ups; desktop 1280 px.

const LABEL = process.env.E2E_STAGE4_SHOTS
const BASE = process.env.E2E_STAGE4_BASE
const ROOT = path.join(__dirname, '..', '..', '.reports', 'stage4-shots')
// Two shots of one build in Chromium differ by one colour level (of 255) at a few anti-aliased edges (83 pixels at the
// edge of the Explore chips' borders, 2026-11-07): that much is the browser's drawing, not the page. Anything more is
// a difference. The count of one-level pixels is printed for each picture.
const NOISE = 1
const PHOTO = (n: number) => `https://images.unsplash.com/photo-15026722602${String(n).padStart(2, '0')}-1c1ef2d93688?w=1200&q=80`

test.skip(!LABEL, 'pictures for the stage 4 comparison: E2E_STAGE4_SHOTS=<label>')
test.beforeEach(() => { test.skip(!['chromium', 'iphone', 'android'].includes(test.info().project.name), 'three set-ups') })

async function settle(page: Page) {
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)) } window.scrollTo(0, 0) })
  await page.waitForFunction(() => Array.from(document.images).every((img) => {
    const r = img.getBoundingClientRect()
    const shown = r.width > 0 && r.height > 0 && getComputedStyle(img).visibility !== 'hidden'
    return !shown || (img.complete && img.naturalWidth > 0)
  }), undefined, { timeout: 15_000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(600)
}

const differences: string[] = []
async function shoot(page: Page, name: string, clipToBottomOf?: string) {
  await settle(page)
  const file = `${test.info().project.name}-${page.viewportSize()!.width}-${name}.png`
  const dir = path.join(ROOT, LABEL!)
  fs.mkdirSync(dir, { recursive: true })
  // WebKit draws the logo's mark (a scaled PNG used as a mask) a little differently from one run to the next, on the
  // same build: proven by two runs of one build, where it was the only difference. Covered in the iPhone set-up only.
  const covered = ['.maplibregl-map', ...(test.info().project.name === 'iphone' ? ['.logo-mark', '.bottom-bar-mark'] : [])]
  const options = { fullPage: true, animations: 'disabled' as const, caret: 'hide' as const, mask: covered.map((c) => page.locator(c)) }
  let shot: Buffer
  if (clipToBottomOf) {
    const bottom = await page.locator(clipToBottomOf).evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY)
    shot = await page.screenshot({ ...options, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: Math.ceil(bottom) } })
  } else shot = await page.screenshot(options)
  fs.writeFileSync(path.join(dir, file), shot)
  if (!BASE) return
  const before = path.join(ROOT, BASE, file)
  if (!fs.existsSync(before)) { differences.push(`${file}: no picture in ${BASE}`); return }
  const compared = comparePng(fs.readFileSync(before), shot, NOISE)
  if (!compared) { differences.push(`${file}: a different size from ${BASE}`); return }
  if (compared.withinNoise) measured(`${file}: ${compared.withinNoise} pixels one colour level apart (edge noise)`)
  if (compared.differ > 0 || compared.withinNoise) fs.writeFileSync(path.join(dir, file.replace(/\.png$/, '.diff.png')), compared.picture)
  if (compared.differ > 0) differences.push(`${file}: ${compared.differ} pixels differ from ${BASE} by more than ${NOISE} colour level`)
}

test('a browser tab looks as it did on main: every page, signed out and signed in, at every width @core', async ({ page, world, signIn }) => {
  test.setTimeout(900_000)
  const host = await world.host({ name: 'Kofi Boateng' })
  const titles = ['Bright two-bedroom flat near the beach', 'Garden studio with a quiet porch', 'Family house by the lagoon', 'Sea-view flat, top floor']
  // Each a different rating: the home page's hero and rows pick by rating, and a tie is broken any way Postgres likes
  const ids: string[] = []
  for (const [i, title] of titles.entries()) {
    const home = await world.listing(host, { city: 'Stagefour', region: 'Western', title, priceNightly: 85 + i * 15 })
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify([PHOTO(i), PHOTO(i + 20), PHOTO(i + 40)]), neighbourhood: 'Beach Road', avgRating: 4.9 - i / 10, reviewCount: 3 + i } })
    ids.push(home.id)
  }
  const guest = await world.guest({ name: 'Ama Mensah' })
  differences.length = 0

  const project = test.info().project.name
  const widths = project === 'chromium' ? [320, 390, 430, 1280] : [page.viewportSize()!.width]
  for (const width of widths) {
    if (project === 'chromium') await page.setViewportSize({ width, height: 844 })
    const phone = width < 768
    await page.context().clearCookies()
    for (const [name, url] of [
      ['home', '/'], ['search', '/search?q=Stagefour'], ['listing', `/listings/${ids[0]}`], ['how-it-works', '/how-it-works'],
      ['faq', '/faq'], ['terms', '/terms'], ['privacy', '/privacy'], ['login', '/login'], ['not-found', '/no-such-page'],
    ]) {
      await page.goto(url, { waitUntil: 'load' })
      await shoot(page, name)
    }
    await signIn(guest)
    for (const [name, url] of [['trips', '/dashboard/guest'], ['wishlist', '/dashboard/guest/wishlist'], ['account', '/account']]) {
      await page.goto(url, { waitUntil: 'load' })
      // The email carries the run's id: the same words each time
      if (name === 'account') await page.locator('h1 + p').evaluate((el) => { el.textContent = 'Ama Mensah · ama@example.test' })
      // On a phone /account has the install hint under Help (stage 4, on purpose): compared down to the end of Help
      await shoot(page, name, name === 'account' && phone ? 'section[aria-labelledby="account-Help"]' : undefined)
    }
  }
  expect(differences).toEqual([])
})

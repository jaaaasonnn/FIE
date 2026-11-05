import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import type { Actor, World } from '../../lib/world'
import { openSheet } from '../../pages'

// App shell, stage 2: pictures for the owner's review, not a check. Runs only with E2E_STAGE2_SHOTS=<label>,
// and saves to e2e/.reports/stage2-shots/<label>/: phones at 320, 390 and 430 px (iPhone and Android set-ups),
// signed out and signed in, and desktop (Chromium). It makes homes in three cities with photos, prices of each
// kind, a long title and one with FieGH's check, at the front of Explore.

const LABEL = process.env.E2E_STAGE2_SHOTS
const OUT = path.join(__dirname, '..', '..', '.reports', 'stage2-shots', LABEL ?? 'none')
const PHONE_WIDTHS = [320, 390, 430]
const PHOTO = (n: number) => `https://images.unsplash.com/photo-15026722602${String(n).padStart(2, '0')}-1c1ef2d93688?w=1200&q=80`

/** Settled pictures, so before and after can be compared: every photo in view loaded, no animation running */
async function save(page: Page, name: string, fullPage = false) {
  fs.mkdirSync(OUT, { recursive: true })
  if (fullPage) {
    // Lazy photos load only once scrolled to
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } window.scrollTo(0, 0) })
  }
  await page.waitForFunction(() => Array.from(document.images).every((img) => {
    const r = img.getBoundingClientRect()
    const shown = r.width > 0 && r.height > 0 && getComputedStyle(img).visibility !== 'hidden'
    return !shown || (img.complete && img.naturalWidth > 0)
  }), undefined, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${name}.png`), fullPage, animations: 'disabled' })
}

type Seeded = { host: Actor; ids: string[] }
async function seed(world: World): Promise<Seeded> {
  const host = await world.host()
  const admin = await world.admin()
  const homes: [string, string, Record<string, unknown>][] = [
    ['Accra', 'Bright two-bedroom flat near Oxford Street with a balcony and a view over the rooftops', { rentalModes: ['SHORT_STAY'], priceNightly: 85 }],
    ['Accra', 'Garden studio in East Legon', { rentalModes: ['SHORT_STAY', 'TEMP_STAY'], priceNightly: 1250.5, priceMonthly: 900 }],
    ['Accra', 'Family house, Airport Residential', { rentalModes: ['TEMP_STAY'], priceMonthly: 2400 }],
    ['Accra', 'Quiet three-bedroom in Cantonments', { rentalModes: ['PERMANENT'], priceAnnual: 18000 }],
    ['Accra', 'Penthouse in Osu', { rentalModes: ['SHORT_STAY'], priceNightly: 210 }],
    ['Kumasi', 'Courtyard home in Ahodwo', { rentalModes: ['SHORT_STAY'], priceNightly: 60 }],
    ['Kumasi', 'Two rooms near Kejetia', { rentalModes: ['TEMP_STAY'], priceMonthly: 450 }],
    ['Kumasi', 'Nhyiaeso townhouse', { rentalModes: ['PERMANENT'], priceAnnual: 7200 }],
    ['Sekondi-Takoradi', 'Beach cottage, Takoradi', { rentalModes: ['SHORT_STAY'], priceNightly: 95 }],
    ['Sekondi-Takoradi', 'Sea-view flat in Beach Road', { rentalModes: ['SHORT_STAY'], priceNightly: 120 }],
    ['Sekondi-Takoradi', 'Harbour apartment', { rentalModes: ['TEMP_STAY'], priceMonthly: 700 }],
  ]
  const ids: string[] = []
  for (const [i, [city, title, over]] of homes.entries()) {
    const home = await world.listing(host, { city, region: city === 'Kumasi' ? 'Ashanti' : city === 'Accra' ? 'Greater Accra' : 'Western', ...over })
    await db.listing.update({ where: { id: home.id }, data: { title, photos: JSON.stringify([PHOTO(i), PHOTO(i + 20), PHOTO(i + 40)]), isFeatured: true, avgRating: i % 3 === 0 ? 0 : 4.6 + (i % 4) / 10, reviewCount: i % 3 === 0 ? 0 : 3 + i, neighbourhood: title.split(' ').at(-1) } })
    ids.push(home.id)
  }
  // The saved one (signed in) at the front of the first row, with FieGH's check standing
  await db.listing.update({ where: { id: ids[1] }, data: { avgRating: 4.99 } })
  await db.listingCheck.create({ data: { listingId: ids[1], checkedById: admin.id, expiresAt: new Date(Date.now() + 300 * 86_400_000), method: 'VIDEO_CALL', checks: '["ADDRESS","HOME","PHOTOS"]', note: 'Seen on a video call for the stage 2 pictures.', digitalAddress: 'GA-183-8164', photos: '[]' } })
  // An edit through the app, so the kept home page is drawn again
  expect((await host.call('PATCH', `/api/listings/${ids[0]}`, { title: homes[0][1] })).status).toBe(200)
  return { host, ids }
}

async function explore(page: Page, first: string) {
  await expect.poll(async () => { await page.goto('/'); return page.locator(`a[href="/listings/${first}"]`).count() }, { timeout: 75_000 }).toBeGreaterThan(0)
  await page.waitForLoadState('networkidle')
}

test.describe('stage 2 pictures', () => {
  test.skip(!LABEL, 'pictures only, with E2E_STAGE2_SHOTS=<label>')

  test('Explore and the hearts @core', async ({ page, world, signIn }) => {
    test.setTimeout(300_000)
    const project = test.info().project.name
    const { ids } = await seed(world)
    if (project === 'chromium') {
      await page.setViewportSize({ width: 1280, height: 900 })
      await explore(page, ids[1]).catch(() => {})
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      // The hero's entrance (hero-enter) has run its course
      await page.waitForTimeout(1500)
      await save(page, 'desktop-home', true)
      return
    }
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      await explore(page, ids[1])
      if (process.env.E2E_STAGE2_DEBUG) console.log(width, JSON.stringify(await page.evaluate(() => {
        const row = document.querySelector('.explore-row')!
        const all = [row, ...Array.from(row.querySelectorAll('*'))].map((el) => [el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : ''), Math.round(el.getBoundingClientRect().height)] as const)
        return all.filter(([, h]) => h > 300)
      })))
      await save(page, `${width}-explore-signed-out`)
      await save(page, `${width}-explore-signed-out-full`, true)
    }
    const guest = await world.guest()
    await db.wishlist.create({ data: { userId: guest.id, listingId: ids[1] } })
    await signIn(guest)
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      await explore(page, ids[1])
      await expect(page.locator(`.explore-phone [data-heart="${ids[1]}"]`).first()).toHaveAttribute('aria-pressed', 'true')
      await save(page, `${width}-explore-signed-in`)
    }
    // The bar over a card's text, at each width (the text of the first row's cards right behind the tab labels)
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      await explore(page, ids[1])
      await page.evaluate(() => {
        // The first card whose text starts below the bar's top: scrolled so its title sits behind the tab labels
        const bar = document.querySelector('[data-bottom-bar]')!.getBoundingClientRect()
        const text = Array.from(document.querySelectorAll('.explore-card-body')).find((el) => el.getBoundingClientRect().top > bar.top) ?? document.querySelector('.explore-card-body')!
        window.scrollBy({ top: text.getBoundingClientRect().top - bar.top - 28, behavior: 'instant' })
      })
      await save(page, `${width}-explore-bar-over-text`)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await save(page, `${width}-explore-end`)
    }
    // Swiped along the first row
    await page.locator('.explore-strip').first().evaluate((el) => el.scrollBy({ left: 600, behavior: 'instant' }))
    await page.waitForTimeout(300)
    await save(page, '430-explore-row-swiped')
  })
  test('Search, the sheet and the bar @core', async ({ page, world, signIn }) => {
    test.setTimeout(300_000)
    const project = test.info().project.name
    const { ids } = await seed(world)
    const [checkIn, checkOut] = [new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10), new Date(Date.now() + 23 * 86_400_000).toISOString().slice(0, 10)]
    if (project === 'chromium') {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto('/search?q=Accra')
      await page.waitForLoadState('networkidle')
      await save(page, 'desktop-search')
      await page.goto(`/search?q=Accra&checkIn=${checkIn}&checkOut=${checkOut}`)
      await page.waitForLoadState('networkidle')
      await save(page, 'desktop-search-dates')
      return
    }
    const guest = await world.guest()
    await db.wishlist.create({ data: { userId: guest.id, listingId: ids[1] } })
    for (const signedIn of [false, true]) {
      if (signedIn) await signIn(guest)
      const who = signedIn ? 'signed-in' : 'signed-out'
      for (const width of PHONE_WIDTHS) {
        await page.setViewportSize({ width, height: 844 })
        await page.goto('/search?q=Accra')
        await page.waitForLoadState('networkidle')
        await save(page, `${width}-search-${who}`)
        if (signedIn) continue
        await page.goto(`/search?q=Accra&mode=SHORT_STAY&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`)
        await page.waitForLoadState('networkidle')
        await save(page, `${width}-search-dates`)
        // The bar over a photo, and over card text
        await page.evaluate(() => { const photo = document.querySelector('.search-card-photo')!; const bar = document.querySelector('[data-bottom-bar]')!.getBoundingClientRect(); window.scrollBy(0, photo.getBoundingClientRect().bottom - bar.top - 40) })
        await save(page, `${width}-bar-over-photo`)
        await page.evaluate(() => { const text = document.querySelector('.search-card-text')!; const bar = document.querySelector('[data-bottom-bar]')!.getBoundingClientRect(); window.scrollBy(0, text.getBoundingClientRect().top - bar.top + 20) })
        await save(page, `${width}-bar-over-text`)
        // and over the footer
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(300)
        await save(page, `${width}-bar-over-footer`)
        // The sheet: from Explore, empty; on the search page, with the search shown
        await page.goto('/')
        await openSheet(page)
        await save(page, `${width}-sheet-explore`)
        await page.goto(`/search?q=Accra&mode=SHORT_STAY&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`)
        await openSheet(page)
        await save(page, `${width}-sheet-search`)
        await page.getByRole('dialog', { name: 'Search homes' }).getByRole('radio', { name: 'Monthly' }).check()
        await save(page, `${width}-sheet-monthly`)
      }
    }
  })

  test('Pages, the footer, the header @core', async ({ page, world, signIn }) => {
    test.setTimeout(300_000)
    const project = test.info().project.name
    const { ids, host } = await seed(world)
    const pages = ['/dashboard/guest', '/dashboard/guest/wishlist', '/dashboard/guest/messages', '/dashboard/guest/payments']
    const name = (url: string) => url === '/dashboard/guest' ? 'trips' : url.split('/').pop()!
    // A guest with nothing yet, and one with a saved home, a booking and a message
    const fresh = await world.guest()
    const busy = await world.guest()
    await db.wishlist.create({ data: { userId: busy.id, listingId: ids[1] } })
    const bookingId = await world.mustBook(busy, ids[0])
    expect((await host.call('POST', '/api/messages', { receiverId: busy.id, content: 'Welcome, the key is with the caretaker', bookingId })).status).toBe(201)
    if (project === 'chromium') {
      await page.setViewportSize({ width: 1280, height: 900 })
      for (const [who, person] of [['empty', fresh], ['full', busy]] as const) {
        await signIn(person)
        for (const url of pages) { await page.goto(url); await page.waitForLoadState('load'); await page.waitForTimeout(1500); await save(page, `desktop-${name(url)}-${who}`) }
      }
      await signIn(host)
      await page.goto('/dashboard/host/messages'); await page.waitForLoadState('load'); await page.waitForTimeout(1500); await save(page, 'desktop-host-messages')
      await page.goto('/faq'); await page.waitForLoadState('load'); await page.waitForTimeout(1500); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await save(page, 'desktop-footer')
      return
    }
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      // Signed out: the footer, folded and with a section open; the header stepped aside
      await page.context().clearCookies()
      await page.goto('/faq')
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await save(page, `${width}-footer`)
      await page.locator('footer summary', { hasText: 'Support' }).click()
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await save(page, `${width}-footer-open`)
      await page.goto('/how-it-works')
      await page.waitForFunction(() => (window as unknown as { __fieSheet?: boolean }).__fieSheet === true)
      for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy({ top: 80, behavior: 'instant' })); await page.waitForTimeout(40) }
      await page.waitForTimeout(400)
      await save(page, `${width}-header-hidden`)
      for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollBy({ top: -40, behavior: 'instant' })); await page.waitForTimeout(40) }
      await page.waitForTimeout(400)
      await save(page, `${width}-header-back`)
      // Signed in: empty, then with things in them
      for (const [who, person] of [['empty', fresh], ['full', busy]] as const) {
        await signIn(person)
        for (const url of pages) { await page.goto(url); await page.waitForLoadState('load'); await page.waitForTimeout(1500); await save(page, `${width}-${name(url)}-${who}`) }
      }
      // While they wait for their answers
      let release: () => void = () => {}
      const held = new Promise<void>((r) => { release = r })
      await page.route(/\/api\/(wishlists|payments|messages)(\?|$)/, async (route) => { await held; await route.fallback() })
      for (const url of pages.slice(1)) { await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(600); await save(page, `${width}-${name(url)}-loading`) }
      release()
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await signIn(host)
      await page.goto('/dashboard/host/messages'); await page.waitForLoadState('load'); await page.waitForTimeout(1500); await save(page, `${width}-host-messages`)
    }
  })
})

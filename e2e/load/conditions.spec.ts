import fs from 'fs'
import path from 'path'
import type { BrowserContext, CDPSession, Page } from '@playwright/test'
import { test, expect } from '../lib/test'
import { db } from '../lib/db'
import { problemsFence } from './fence'
import { expectInvariants } from '../lib/invariants'
import { CheckoutPage, FakePaystack, ListingPage } from '../pages'

// Stage B3: the site on bad connections and slow phones (Chromium only: the throttling is Chrome's).
// For each profile and page: when something first shows, when the main control first answers (the page is
// hydrated: React has attached to it), how long the screen stays blank, and screenshots over time.
// Then what happens to money when the connection fails in the middle of paying.
//   E2E_PERF=1 node e2e/run.mjs test --project=perf load/conditions.spec.ts
// Results: e2e/.reports/stageB/conditions.json and conditions-shots/.

type Profile = {
  name: string
  viewport?: { width: number; height: number }; mobile?: boolean; userAgent?: string
  network?: { latency: number; downloadThroughput: number; uploadThroughput: number }
  cpu?: number
  /** Extra delay per request, ms: [min, max] */
  jitter?: [number, number]
  /** Share of GET requests that stall for 3 to 8 s, and that are reset */
  stalls?: number; resets?: number
}
const kbps = (n: number) => (n * 1000) / 8
// DevTools' own presets: Slow 4G is Lighthouse's 150 ms / 1.6 Mbps at packet level; "3G" is DevTools' 3G
const SLOW_4G = { latency: 562.5, downloadThroughput: kbps(1440), uploadThroughput: kbps(675) }
const THREE_G = { latency: 300, downloadThroughput: kbps(750), uploadThroughput: kbps(250) }
const IPHONE = { viewport: { width: 390, height: 844 }, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
const LOW_ANDROID = { viewport: { width: 360, height: 640 }, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 11; moto e) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' }
const PROFILES: Profile[] = [
  { name: 'desktop, no throttling' },
  { name: 'slow 4G', network: SLOW_4G },
  { name: '3G', network: THREE_G },
  { name: 'latency 300-600 ms', jitter: [300, 600] },
  { name: 'stalls and resets', stalls: 0.05, resets: 0.02 },
  { name: 'CPU 4x slower', cpu: 4 },
  { name: 'iPhone size, slow 4G, CPU 4x', ...IPHONE, network: SLOW_4G, cpu: 4 },
  { name: 'low-end Android size, 3G, CPU 6x', ...LOW_ANDROID, network: THREE_G, cpu: 6 },
]
const RUNS = Number(process.env.E2E_CONDITION_RUNS ?? 3)
const out = path.join(__dirname, '..', '.reports', 'stageB')
const shots = path.join(out, 'conditions-shots')
fs.mkdirSync(shots, { recursive: true })
const results: Record<string, unknown>[] = []
const save = () => fs.writeFileSync(path.join(out, 'conditions.json'), JSON.stringify({ at: new Date().toISOString(), runs: RUNS, results }, null, 1))

async function apply(context: BrowserContext, page: Page, p: Profile): Promise<CDPSession> {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  if (p.network) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.network })
  if (p.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
  if (p.jitter || p.stalls || p.resets) {
    // Registered after the fence in lib/test.ts, so it runs first and then hands the request on to it
    let n = 0
    await context.route('**/*', async (route) => {
      const r = route.request()
      const x = Math.abs(Math.sin(++n * 12.9898) * 43758.5453) % 1 // the same sequence every run
      if (p.jitter) await new Promise((res) => setTimeout(res, p.jitter![0] + x * (p.jitter![1] - p.jitter![0])))
      if (r.method() === 'GET' && p.resets && x < p.resets) return route.abort('connectionreset')
      if (r.method() === 'GET' && p.stalls && x > 1 - p.stalls) await new Promise((res) => setTimeout(res, 3000 + x * 5000))
      return route.fallback()
    })
  }
  return cdp
}

/** Loads a page and measures it. `ready` is the control a person would use first. */
async function measure(page: Page, url: string, ready: string, label: string) {
  await page.addInitScript(() => {
    const w = window as unknown as { __m: Record<string, number> }
    w.__m = {}
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') w.__m.fcp = e.startTime }).observe({ type: 'paint', buffered: true })
    new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) w.__m.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    let cls = 0
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) cls += e.value; w.__m.cls = cls }).observe({ type: 'layout-shift', buffered: true })
  })
  const started = Date.now()
  const frames: string[] = []
  const shooter = (async () => {
    for (const at of [1000, 3000, 6000, 10000]) {
      await new Promise((r) => setTimeout(r, Math.max(0, started + at - Date.now())))
      if (page.isClosed()) return
      const file = `${label}-${at / 1000}s.png`.replace(/[^\w.-]+/g, '_')
      await page.screenshot({ path: path.join(shots, file), timeout: 5000 }).then(() => frames.push(file)).catch(() => {})
    }
  })()
  let error: string | null = null
  await page.goto(url, { waitUntil: 'commit', timeout: 90_000 }).catch((e) => { error = String(e).slice(0, 200) })
  const el = page.locator(ready).first()
  let visibleMs: number | null = null
  let interactiveMs: number | null = null
  try {
    await el.waitFor({ state: 'visible', timeout: 60_000 })
    visibleMs = Date.now() - started
    // React has hydrated the control: it carries React's own keys
    await expect.poll(async () => el.evaluate((e) => Object.keys(e).some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactProps'))), { timeout: 60_000, intervals: [100] }).toBe(true)
    interactiveMs = Date.now() - started
  } catch (e) { error ??= `never usable: ${String(e).split('\n')[0].slice(0, 160)}` }
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {})
  const m = await page.evaluate(() => (window as unknown as { __m: Record<string, number> }).__m).catch(() => ({} as Record<string, number>))
  await shooter
  return { fcpMs: m.fcp ?? null, lcpMs: m.lcp ?? null, cls: m.cls ?? 0, controlVisibleMs: visibleMs, interactiveMs, blankMs: m.fcp ?? visibleMs, frames, error }
}

for (const p of PROFILES) {
  test(`pages on ${p.name}`, async ({ browser, world }) => {
    test.setTimeout(900_000)
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { lat: 5.56, lng: -0.19 })
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80']) } })
    const bookingId = await world.mustBook(guest, home.id)
    await guest.signIn()
    const pages: [string, string, string, boolean][] = [
      ['home', '/', '#hero-where >> visible=true', false],
      ['search', '/search', 'input[placeholder^="Search by city"] >> visible=true', false],
      ['listing', `/listings/${home.id}`, 'input[placeholder="Add date"] >> visible=true', false],
      ['checkout', `/checkout/${bookingId}`, 'button:has-text("Debit / Credit Card") >> visible=true', true],
    ]
    for (const [name, url, ready, signedIn] of pages) {
      const runs: Awaited<ReturnType<typeof measure>>[] = []
      for (let i = 0; i < RUNS; i++) {
        const context = await browser.newContext({ baseURL: 'http://localhost:3200', viewport: p.viewport ?? { width: 1280, height: 800 }, isMobile: p.mobile, hasTouch: p.mobile, userAgent: p.userAgent, extraHTTPHeaders: { 'x-vercel-forwarded-for': guest.ip } })
        // the same fence every test has: no third party, map and photos answered locally
        await problemsFence(context)
        if (signedIn) await context.addCookies([{ name: 'fiegh_session', value: guest.cookie!, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
        const page = await context.newPage()
        await apply(context, page, p)
        runs.push(await measure(page, url, ready, `${p.name}-${name}-${i + 1}`))
        await context.close()
      }
      const med = (k: string) => { const xs = runs.map((r) => (r as Record<string, unknown>)[k]).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null }
      results.push({ profile: p.name, page: name, median: { fcpMs: med('fcpMs'), lcpMs: med('lcpMs'), controlVisibleMs: med('controlVisibleMs'), interactiveMs: med('interactiveMs'), cls: med('cls') }, runs })
      save()
    }
  })
}

// ── Money when the connection fails while paying ─────────────────────────────────────────────────

test('Pay pressed twice on slow 4G: one payment is started, and the guest reaches Paystack once', async ({ page, world, signIn, context }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await signIn(guest)
  await apply(context, page, { name: 'slow 4G', network: SLOW_4G })
  const checkout = new CheckoutPage(page)
  await checkout.goto(bookingId)
  await checkout.chooseCard()
  const posts: number[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/payments')) posts.push(Date.now()) })
  await checkout.payButton().dblclick()
  await checkout.payButton().click({ timeout: 2000 }).catch(() => {}) // a third press, if the button is still there
  await new FakePaystack(page).expectOpen()
  const payments = await db.payment.findMany({ where: { bookingId } })
  results.push({ check: 'Pay pressed three times on slow 4G', postsSent: posts.length, paymentRows: payments.length })
  save()
  expect(payments, 'one payment row however often Pay is pressed').toHaveLength(1)
  await expectInvariants()
})

test('the connection drops as Pay is pressed: the guest is told, nothing is charged, and paying again works once', async ({ page, world, signIn, context }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await signIn(guest)
  const checkout = new CheckoutPage(page)
  await checkout.goto(bookingId)
  await checkout.chooseCard()
  await expect(checkout.payButton()).toBeEnabled()
  await context.setOffline(true)
  await checkout.payButton().click()
  // What the guest sees with no connection
  const told = page.getByText(/network|connection|offline|try again/i).first()
  const toldVisible = await told.isVisible({ timeout: 10_000 }).catch(() => false) || await told.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
  await page.screenshot({ path: path.join(shots, 'offline-at-pay.png') })
  const whileOffline = await db.payment.count({ where: { bookingId } })
  await context.setOffline(false)
  // Recover: press Pay again
  await expect(checkout.payButton()).toBeEnabled({ timeout: 15_000 })
  await checkout.payButton().click()
  await new FakePaystack(page).expectOpen()
  await new FakePaystack(page).pay()
  await expect.poll(async () => (await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).paymentStatus, { timeout: 20_000 }).toBe('PAID')
  const payments = await db.payment.findMany({ where: { bookingId } })
  results.push({ check: 'offline at Pay', toldSomething: toldVisible, paymentRowsWhileOffline: whileOffline, paymentRowsAfter: payments.length, successful: payments.filter((x) => x.status === 'SUCCESS').length })
  save()
  expect(toldVisible, 'the guest is told the connection failed').toBe(true)
  expect(payments.filter((x) => x.status === 'SUCCESS')).toHaveLength(1)
  await expectInvariants()
})

test('the answer to Pay is lost on the way back (the server started the payment): pressing Pay again hands back the same payment', async ({ page, world, signIn, context }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await signIn(guest)
  const checkout = new CheckoutPage(page)
  await checkout.goto(bookingId)
  await checkout.chooseCard()
  let dropped = 0
  // The request reaches the server and is answered; the answer never reaches the browser
  await context.route('**/api/payments', async (route) => {
    if (route.request().method() !== 'POST' || dropped++ > 0) return route.fallback()
    await route.fetch()
    return route.abort('connectionreset')
  })
  await checkout.payButton().click()
  await expect.poll(() => dropped).toBe(1)
  const afterFirst = await db.payment.count({ where: { bookingId } })
  await expect(checkout.payButton()).toBeEnabled({ timeout: 15_000 })
  await checkout.payButton().click()
  await new FakePaystack(page).expectOpen()
  const payments = await db.payment.findMany({ where: { bookingId } })
  results.push({ check: 'answer to Pay lost', paymentRowsAfterLostAnswer: afterFirst, paymentRowsAfterRetry: payments.length })
  save()
  expect(payments, 'the retry is handed the same payment').toHaveLength(1)
  await expectInvariants()
})

test('the connection drops as the guest books: the guest can try again and ends with one booking', async ({ page, world, signIn, context }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  await signIn(guest)
  const { checkIn, checkOut } = world.dates(2)
  await page.goto(`/listings/${home.id}`)
  const listing = new ListingPage(page)
  await listing.chooseDates(checkIn, checkOut)
  let dropped = 0
  await context.route('**/api/bookings', async (route) => {
    if (route.request().method() !== 'POST' || dropped++ > 0) return route.fallback()
    await route.fetch() // the booking is made, the answer is lost
    return route.abort('connectionreset')
  })
  await listing.bookButton().click()
  await expect.poll(() => dropped).toBe(1)
  const toldVisible = await page.getByText(/network|connection|try again|went wrong|failed/i).first().isVisible({ timeout: 10_000 }).catch(() => false)
  await page.screenshot({ path: path.join(shots, 'reset-at-book.png') })
  await listing.bookButton().click()
  await page.waitForURL(/\/checkout\/|\/bookings\//, { timeout: 20_000 }).catch(() => {})
  const bookings = await db.booking.findMany({ where: { guestId: guest.id, listingId: home.id } })
  const shown = page.url()
  results.push({ check: 'answer to Book lost', toldSomething: toldVisible, bookingsMade: bookings.length, statuses: bookings.map((b) => b.status), endedOn: new URL(shown).pathname, textOnPage: (await page.locator('body').innerText()).slice(0, 300) })
  save()
  // The dates are taken by the first, unseen booking: the guest must not be stuck, and there must not be two
  expect(bookings.filter((b) => !['CANCELLED', 'DECLINED'].includes(b.status)), 'one live booking').toHaveLength(1)
  await expectInvariants()
})

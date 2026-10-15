import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../lib/test'
import { db } from '../lib/db'

// Stage B4: going from page to page. For each main pair: the time from the click until the next page's
// main content is visible, layout shift on the way, and any blank, flash or broken state seen in between
// (frames sampled every animation frame while the page changes). Cold: a fresh browser each run. Warm: the
// same browser, after the pair has been visited once. Then prefetching, back and forward, scroll
// restoration, and the order images load in on the search grid and a listing's gallery.
//   E2E_PERF=1 node e2e/run.mjs test --project=perf load/transitions.spec.ts
// Results: e2e/.reports/stageB/transitions.json

const RUNS = Number(process.env.E2E_TRANSITION_RUNS ?? 5)
const out = path.join(__dirname, '..', '.reports', 'stageB')
fs.mkdirSync(out, { recursive: true })
const results: Record<string, unknown>[] = []
const save = () => fs.writeFileSync(path.join(out, 'transitions.json'), JSON.stringify({ at: new Date().toISOString(), runs: RUNS, results }, null, 1))
const median = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }

/** Records, every animation frame, what a person would see: how much text the main area holds, whether a
 *  spinner or skeleton shows, and layout shifts. Lives as long as the document (client-side navigations). */
async function recorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __f: { t: number; text: number; busy: boolean; url: string }[]; __cls: number; __rec: boolean }
    w.__f = []; w.__cls = 0; w.__rec = false
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput && w.__rec) w.__cls += e.value }).observe({ type: 'layout-shift', buffered: false })
    const tick = () => {
      if (w.__rec) {
        const main = document.querySelector('main') ?? document.body
        w.__f.push({ t: performance.now(), text: (main as HTMLElement).innerText.trim().length, busy: !!document.querySelector('[class*="animate-spin"], [class*="animate-pulse"], [aria-busy="true"], [role="progressbar"]'), url: location.pathname })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
async function startRecording(page: Page) { await page.evaluate(() => { const w = window as unknown as { __f: unknown[]; __cls: number; __rec: boolean }; w.__f = []; w.__cls = 0; w.__rec = true }) }
async function stopRecording(page: Page) {
  return page.evaluate(() => { const w = window as unknown as { __f: { t: number; text: number; busy: boolean; url: string }[]; __cls: number; __rec: boolean }; w.__rec = false; return { frames: w.__f, cls: w.__cls } }).catch(() => ({ frames: [], cls: null }))
}

type Pair = { name: string; from: string; click: (p: Page) => Promise<void>; arrived: (p: Page) => Promise<void>; signIn?: 'guest' | 'host' }

test.describe.configure({ mode: 'serial' })

test('page-to-page: click to visible, layout shift, blank and flash states, cold and warm', async ({ browser, world }) => {
  test.setTimeout(1_500_000)
  const host = await world.host()
  const guest = await world.guest()
  const homes = await Promise.all([0, 1, 2].map((i) => world.listing(host, { lat: 5.56 + i * 0.01, lng: -0.19 })))
  for (const h of homes) await db.listing.update({ where: { id: h.id }, data: { photos: JSON.stringify(['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80', 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80']) } })
  const { id: paidId } = await world.paidBooking(guest, homes[0].id)
  await guest.signIn(); await host.signIn()

  const pairs: Pair[] = [
    { name: 'home → search (header search)', from: '/', click: async (p) => { await p.getByRole('link', { name: /search|explore|find/i }).or(p.getByRole('button', { name: /^search$/i })).first().click() }, arrived: async (p) => { await p.waitForURL(/\/search/); await p.locator('a[href^="/listings/"]').first().waitFor() } },
    { name: 'search → listing (card)', from: '/search', click: async (p) => { await p.locator('a[href^="/listings/"]').first().click() }, arrived: async (p) => { await p.waitForURL(/\/listings\//); await p.getByRole('heading', { level: 1 }).waitFor() } },
    { name: 'home → listing (card)', from: '/', click: async (p) => { await p.locator('a[href^="/listings/"]').first().click() }, arrived: async (p) => { await p.waitForURL(/\/listings\//); await p.getByRole('heading', { level: 1 }).waitFor() } },
    { name: 'home → how it works (nav)', from: '/', click: async (p) => { await p.getByRole('link', { name: 'How it Works' }).first().click() }, arrived: async (p) => { await p.waitForURL(/how-it-works/); await p.getByRole('heading', { level: 1 }).waitFor() } },
    { name: 'how it works → FAQ (nav)', from: '/how-it-works', click: async (p) => { await p.getByRole('link', { name: 'FAQ' }).first().click() }, arrived: async (p) => { await p.waitForURL(/\/faq/); await p.getByRole('heading', { level: 1 }).waitFor() } },
    { name: 'guest dashboard → booking', from: '/dashboard/guest', signIn: 'guest', click: async (p) => { await p.locator(`a[href="/bookings/${paidId}"]`).first().click() }, arrived: async (p) => { await p.waitForURL(/\/bookings\//); await p.getByText(homes[0].title).first().waitFor() } },
    { name: 'host dashboard → host bookings', from: '/dashboard/host', signIn: 'host', click: async (p) => { await p.locator('a[href^="/dashboard/host/bookings"]').first().click() }, arrived: async (p) => { await p.waitForURL(/\/dashboard\/host\/bookings/); await p.getByRole('heading').first().waitFor() } },
  ]

  for (const pair of pairs) {
    for (const cache of ['cold', 'warm'] as const) {
      const runs: Record<string, unknown>[] = []
      const context = await browser.newContext({ baseURL: 'http://localhost:3200', extraHTTPHeaders: { 'x-vercel-forwarded-for': guest.ip } })
      const { problemsFence } = await import('./fence')
      await problemsFence(context)
      const who = pair.signIn === 'guest' ? guest : pair.signIn === 'host' ? host : null
      if (who) await context.addCookies([{ name: 'fiegh_session', value: who.cookie!, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
      for (let i = 0; i < RUNS + (cache === 'warm' ? 1 : 0); i++) {
        // cold: a fresh page in a fresh context every run; warm: the same context, first round not counted
        const ctx = cache === 'cold' ? await browser.newContext({ baseURL: 'http://localhost:3200', extraHTTPHeaders: { 'x-vercel-forwarded-for': guest.ip } }) : context
        if (cache === 'cold') { await problemsFence(ctx); if (who) await ctx.addCookies([{ name: 'fiegh_session', value: who.cookie!, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]) }
        const page = await ctx.newPage()
        await recorder(page)
        const requests: string[] = []
        page.on('request', (r) => { if (r.url().includes('_rsc=') || r.resourceType() === 'document') requests.push(`${r.headers()['next-router-prefetch'] ? 'prefetch' : r.resourceType() === 'document' ? 'document' : 'rsc'} ${new URL(r.url()).pathname}`) })
        await page.goto(pair.from, { waitUntil: 'networkidle' })
        const before = requests.length
        await startRecording(page)
        const t0 = Date.now()
        let error: string | null = null
        await pair.click(page).catch((e) => { error = `click: ${String(e).split('\n')[0]}` })
        if (!error) await pair.arrived(page).catch((e) => { error = `arrive: ${String(e).split('\n')[0]}` })
        const ms = Date.now() - t0
        await page.waitForTimeout(300)
        const { frames, cls } = await stopRecording(page)
        const fullReload = requests.slice(before).some((r) => r.startsWith('document'))
        const blankFrames = frames.filter((f) => f.text < 20).length
        const spinnerFrames = frames.filter((f) => f.busy).length
        if (cache === 'cold' || i > 0) runs.push({ ms, cls, fullReload, blankFrames, spinnerFrames, frames: frames.length, afterClick: requests.slice(before), error })
        await page.close()
        if (cache === 'cold') await ctx.close()
      }
      await context.close()
      results.push({
        pair: pair.name, cache,
        median: { clickToVisibleMs: median(runs.map((r) => r.ms as number)), cls: median(runs.map((r) => (r.cls as number) ?? NaN)), blankFrames: median(runs.map((r) => r.blankFrames as number)), spinnerFrames: median(runs.map((r) => r.spinnerFrames as number)) },
        fullPageReloads: runs.filter((r) => r.fullReload).length, errors: runs.map((r) => r.error).filter(Boolean), runs,
      })
      save()
    }
  }
})

test('prefetching: which links on the home page and search grid are fetched before they are clicked', async ({ page }) => {
  const seen: { url: string; prefetch: boolean; at: number }[] = []
  const t0 = Date.now()
  page.on('request', (r) => { if (r.url().includes('_rsc=')) seen.push({ url: new URL(r.url()).pathname, prefetch: !!r.headers()['next-router-prefetch'], at: Date.now() - t0 }) })
  for (const from of ['/', '/search']) {
    seen.length = 0
    await page.goto(from, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const links = await page.locator('header a[href^="/"], nav a[href^="/"], a[href^="/listings/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')!))])
    const prefetched = new Set(seen.filter((s) => s.prefetch).map((s) => s.url))
    results.push({ check: `prefetch on ${from}`, linksOnPage: links.length, prefetched: links.filter((l) => prefetched.has(l.split('?')[0])).length, notPrefetched: links.filter((l) => !prefetched.has(l.split('?')[0])).slice(0, 15), prefetchRequests: seen.filter((s) => s.prefetch).length })
    save()
  }
})

test('back and forward, and scroll restoration on the search grid', async ({ page }) => {
  await page.goto('/search', { waitUntil: 'networkidle' })
  const cards = page.locator('a[href^="/listings/"]')
  const count = await cards.count()
  const target = cards.nth(Math.min(count - 1, 12))
  await target.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const scrolledTo = await page.evaluate(() => window.scrollY)
  const listScroll = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => ({ tag: e.tagName, cls: (e as HTMLElement).className?.toString().slice(0, 60), top: e.scrollTop })).slice(0, 3))
  const href = await target.getAttribute('href')
  await target.click()
  await page.waitForURL(/\/listings\//)
  const tBack = Date.now()
  await page.goBack()
  await page.waitForURL(/\/search/)
  await cards.first().waitFor()
  const backMs = Date.now() - tBack
  await page.waitForTimeout(800)
  const restoredTo = await page.evaluate(() => window.scrollY)
  const listScrollAfter = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => ({ tag: e.tagName, top: e.scrollTop })).slice(0, 3))
  const tFwd = Date.now()
  await page.goForward()
  await page.waitForURL(/\/listings\//)
  await page.getByRole('heading', { level: 1 }).waitFor()
  const forwardMs = Date.now() - tFwd
  results.push({ check: 'back to the search grid', cards: count, clicked: href, windowScrollBefore: scrolledTo, windowScrollAfter: restoredTo, innerScrollBefore: listScroll, innerScrollAfter: listScrollAfter, backMs, forwardMs })
  save()
})

test('image loading order and placeholders: the search grid and a listing gallery', async ({ page, world }) => {
  const host = await world.host()
  const home = await world.listing(host)
  await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80', 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80', 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80']) } })
  for (const [name, url] of [['search grid', '/search'], ['listing gallery', `/listings/${home.id}`]] as const) {
    const order: { url: string; at: number; bytes: number }[] = []
    const t0 = Date.now()
    page.removeAllListeners('response')
    page.on('response', async (r) => { if (r.request().resourceType() === 'image') order.push({ url: decodeURIComponent(r.url().replace(/^https?:\/\/[^/]+/, '')).slice(0, 110), at: Date.now() - t0, bytes: Number(r.headers()['content-length'] ?? 0) }) })
    await page.goto(url, { waitUntil: 'networkidle' })
    const imgs = await page.locator('main img').evaluateAll((els) => els.map((e) => {
      const i = e as HTMLImageElement; const r = i.getBoundingClientRect()
      return { src: (i.currentSrc || i.src).replace(/^https?:\/\/[^/]+/, '').slice(0, 90), loading: i.loading, fetchPriority: i.getAttribute('fetchpriority'), aboveFold: r.top < window.innerHeight && r.bottom > 0, placeholder: /blur|data:image/.test(i.style.backgroundImage || '') || i.getAttribute('data-nimg') !== null && /blur/.test(i.style.filter || ''), sized: !!(i.getAttribute('width') || i.style.width || i.sizes), optimised: (i.currentSrc || i.src).includes('/_next/image'), naturalWidth: i.naturalWidth, shownWidth: Math.round(r.width) }
    }))
    results.push({ check: `images: ${name}`, requested: order.slice(0, 20), images: imgs.slice(0, 20), aboveFoldLazy: imgs.filter((i) => i.aboveFold && i.loading === 'lazy').length, belowFoldEager: imgs.filter((i) => !i.aboveFold && i.loading !== 'lazy').length, notOptimised: imgs.filter((i) => !i.optimised).length, oversized: imgs.filter((i) => i.naturalWidth > 2 * i.shownWidth && i.shownWidth > 0).length })
    save()
  }
  expect(true).toBe(true)
})

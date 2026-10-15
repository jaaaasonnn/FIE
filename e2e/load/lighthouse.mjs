// Lighthouse 12.8.2 over the main pages, desktop and mobile, N runs each; medians against the budgets.
//   node e2e/run.mjs exec node e2e/load/lighthouse.mjs <label> [runs=5]
// <label> names the data set (empty | seeded); results go to e2e/.reports/stageB/lighthouse-<label>.json,
// with the full report of the median run of each page and form factor beside it.
//
// The browser cannot reach anything outside this machine: every host name resolves to nowhere except
// localhost, and api.maptiler.com / images.unsplash.com / e2e-storage.fiegh.test, which are sent to the
// local fake (blank map style, generated photos). The fake's certificate is accepted by this Chrome only.
//
// Mobile is Lighthouse's default: simulated slow 4G (150 ms, 1.6 Mbps down) and a CPU 4x slower.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import * as chromeLauncher from 'chrome-launcher'
import { chromium } from 'playwright'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const [label = 'adhoc', runsArg = '5'] = process.argv.slice(2)
const RUNS = Number(runsArg)
const APP = 'http://localhost:3200'
const out = path.join(here, '..', '.reports', 'stageB')
fs.mkdirSync(path.join(out, 'lighthouse-runs'), { recursive: true })
if (!/127\.0\.0\.1:54329\/fiegh_e2e/.test(process.env.DIRECT_URL ?? '')) throw new Error('not the local test database')
const db = new pg.Client({ connectionString: process.env.DIRECT_URL })
await db.connect()
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]

let ipCounter = 0
const ip = () => `10.66.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`
async function api(method, url, body, cookie) {
  const r = await fetch(APP + url, { method, redirect: 'manual', headers: { origin: APP, 'content-type': 'application/json', 'x-vercel-forwarded-for': ip(), ...(cookie ? { cookie: `fiegh_session=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, cookie: /fiegh_session=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] }
}
async function signIn(email, password) {
  const r = await api('POST', '/api/auth/signin', { identifier: email, password })
  if (!r.cookie) throw new Error(`sign-in failed for ${email}: ${r.status}`)
  return r.cookie
}

// ── Who and what to look at ──────────────────────────────────────────────────────────────────
// Seeded: the busiest load guest, a load host and a load admin, so the dashboards carry real volume.
// Empty: perf_ people made here through the app, removed at the end.
const made = []
async function actors() {
  const seeded = (await one(`select count(*)::int n from "Listing" where id like 'load\\_%'`)).n > 0
  if (seeded) {
    const guest = await one(`select "guestId" id from "Booking" where id like 'load\\_%' group by 1 order by count(*) desc, 1 limit 1`)
    const host = await one(`select "hostId" id from "Listing" where id like 'load\\_%' group by 1 order by count(*) desc, 1 limit 1`)
    const listing = await one(`select id from "Listing" where id like 'load\\_l\\_%' and "instantBook" and "rentalModes" = '["SHORT_STAY"]' order by id limit 1`)
    const email = async (id) => (await one(`select email from "User" where id = $1`, [id])).email
    return { seeded, guest: await signIn(await email(guest.id), 'Load-pass-2026'), guestId: guest.id, host: await signIn(await email(host.id), 'Load-pass-2026'), admin: await signIn('load-1@load.fiegh.test', 'Load-pass-2026'), listingId: listing.id }
  }
  const tag = Date.now().toString(36)
  const mk = async (role) => {
    const email = `perf-${role.toLowerCase()}-${tag}@fiegh.test`
    const r = await api('POST', '/api/auth/signup', { name: `Perf ${role} ${tag}`, email, password: `Perf-pass-${tag}`, role: role === 'HOST' ? 'HOST' : 'GUEST' })
    if (r.status >= 300) throw new Error(`sign-up failed: ${r.status} ${JSON.stringify(r.json)}`)
    const id = (await one(`select id from "User" where email = $1`, [email])).id
    made.push(id)
    if (role === 'ADMIN') await db.query(`update "User" set role = 'ADMIN' where id = $1`, [id])
    if (role === 'HOST') await db.query(`update "User" set role = 'HOST' where id = $1`, [id])
    return { id, cookie: await signIn(email, `Perf-pass-${tag}`) }
  }
  const [guest, host, admin] = [await mk('GUEST'), await mk('HOST'), await mk('ADMIN')]
  const listing = await api('POST', '/api/listings', { title: `Perf home ${tag}`, description: 'A home made by the Lighthouse runner. Not a real home.', propertyType: 'Apartment', region: 'Greater Accra', city: 'Accra', neighbourhood: 'Osu', bedrooms: 2, bathrooms: 1, maxGuests: 4, rentalModes: ['SHORT_STAY'], priceNightly: 80, instantBook: true, lat: 5.56, lng: -0.19 }, host.cookie)
  if (listing.status >= 300) throw new Error(`listing failed: ${listing.status} ${JSON.stringify(listing.json)}`)
  await db.query(`update "Listing" set photos = $2 where id = $1`, [listing.json.listing.id, JSON.stringify(['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80'])])
  return { seeded, guest: guest.cookie, guestId: guest.id, host: host.cookie, admin: admin.cookie, listingId: listing.json.listing.id }
}

const who = await actors()
// A fresh instant booking for the checkout page, on dates nobody holds (far enough ahead for any listing)
const offset = 300 + Math.floor(Math.random() * 200)
const iso = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const booking = await api('POST', '/api/bookings', { listingId: who.listingId, checkIn: iso(offset), checkOut: iso(offset + 2), rentalMode: 'SHORT_STAY', guests: 1 }, who.guest)
if (booking.status >= 300) throw new Error(`booking failed: ${booking.status} ${JSON.stringify(booking.json)}`)
const bookingId = booking.json.booking?.id ?? booking.json.id

const PAGES = [
  ['home', '/', null],
  ['search with map', '/search', null],
  ['listing', `/listings/${who.listingId}`, null],
  ['checkout', `/checkout/${bookingId}`, who.guest],
  ['guest dashboard', '/dashboard/guest', who.guest],
  ['host dashboard', '/dashboard/host', who.host],
  ['admin', '/admin', who.admin],
]
const MAP_CHUNKS = fs.readdirSync(path.join(here, '..', '..', '.next', 'static', 'chunks')).filter((f) => f.endsWith('.js') && fs.readFileSync(path.join(here, '..', '..', '.next', 'static', 'chunks', f), 'utf8').includes('maplibre'))

const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--ignore-certificate-errors', '--no-first-run',
    '--host-resolver-rules=MAP api.maptiler.com 127.0.0.1:4443, MAP images.unsplash.com 127.0.0.1:4443, MAP e2e-storage.fiegh.test 127.0.0.1:4443, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
})

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const results = []
try {
  for (const [name, url, cookie] of PAGES) {
    for (const formFactor of ['mobile', 'desktop']) {
      const runs = []
      for (let i = 0; i < RUNS; i++) {
        const flags = { port: chrome.port, output: 'json', logLevel: 'error', extraHeaders: { 'x-vercel-forwarded-for': ip(), ...(cookie ? { Cookie: `fiegh_session=${cookie}` } : {}) } }
        const r = await lighthouse(APP + url, flags, formFactor === 'desktop' ? desktopConfig : undefined)
        const lhr = r.lhr
        const items = lhr.audits['network-requests']?.details?.items ?? []
        const scripts = items.filter((x) => x.resourceType === 'Script')
        const js = scripts.reduce((s, x) => s + (x.transferSize ?? 0), 0)
        const mapJs = scripts.filter((x) => MAP_CHUNKS.some((f) => x.url.includes(f))).reduce((s, x) => s + (x.transferSize ?? 0), 0)
        const finalUrl = lhr.finalDisplayedUrl ?? lhr.finalUrl
        runs.push({
          score: Math.round((lhr.categories.performance.score ?? 0) * 100),
          lcp: lhr.audits['largest-contentful-paint'].numericValue, cls: lhr.audits['cumulative-layout-shift'].numericValue,
          tbt: lhr.audits['total-blocking-time'].numericValue, fcp: lhr.audits['first-contentful-paint'].numericValue,
          si: lhr.audits['speed-index'].numericValue, tti: lhr.audits.interactive?.numericValue ?? null,
          jsKB: js / 1024, mapJsKB: mapJs / 1024, totalKB: items.reduce((s, x) => s + (x.transferSize ?? 0), 0) / 1024, requests: items.length,
          finalUrl, lhr,
        })
        process.stdout.write(`${name} ${formFactor} run ${i + 1}: score ${runs.at(-1).score}, LCP ${Math.round(runs.at(-1).lcp)} ms, TBT ${Math.round(runs.at(-1).tbt)} ms, JS ${Math.round(runs.at(-1).jsKB)} KB${new URL(finalUrl).pathname !== url.split('?')[0] ? ` (ENDED ON ${finalUrl})` : ''}\n`)
      }
      // The run with the median score is kept in full; each metric is the median of its own runs
      const mid = [...runs].sort((a, b) => a.score - b.score)[Math.floor(runs.length / 2)]
      const file = `lighthouse-runs/${label}-${name.replace(/\s+/g, '-')}-${formFactor}.json`
      fs.writeFileSync(path.join(out, file), JSON.stringify(mid.lhr))
      const a = mid.lhr.audits
      const top = (items, n, f) => (items ?? []).slice(0, n).map(f)
      results.push({
        page: name, url, formFactor, runs: RUNS, endedOn: [...new Set(runs.map((r) => new URL(r.finalUrl).pathname))],
        median: Object.fromEntries(['score', 'lcp', 'cls', 'tbt', 'fcp', 'si', 'tti', 'jsKB', 'mapJsKB', 'totalKB', 'requests'].map((k) => [k, median(runs.map((r) => r[k] ?? 0))])),
        spread: { lcp: [Math.min(...runs.map((r) => r.lcp)), Math.max(...runs.map((r) => r.lcp))], tbt: [Math.min(...runs.map((r) => r.tbt)), Math.max(...runs.map((r) => r.tbt))] },
        contributors: {
          lcpElement: a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? null,
          biggestScripts: top([...(a['network-requests']?.details?.items ?? [])].filter((x) => x.resourceType === 'Script').sort((x, y) => y.transferSize - x.transferSize), 6, (x) => ({ url: x.url.replace(APP, ''), kb: Math.round(x.transferSize / 1024), map: MAP_CHUNKS.some((f) => x.url.includes(f)) })),
          biggestOther: top([...(a['network-requests']?.details?.items ?? [])].filter((x) => x.resourceType !== 'Script').sort((x, y) => y.transferSize - x.transferSize), 5, (x) => ({ url: x.url.replace(APP, '').slice(0, 100), type: x.resourceType, kb: Math.round(x.transferSize / 1024) })),
          renderBlocking: top(a['render-blocking-resources']?.details?.items, 5, (x) => ({ url: x.url.replace(APP, ''), ms: Math.round(x.wastedMs ?? 0) })),
          unusedJs: top(a['unused-javascript']?.details?.items, 5, (x) => ({ url: x.url.replace(APP, ''), unusedKB: Math.round((x.wastedBytes ?? 0) / 1024) })),
          bootup: top(a['bootup-time']?.details?.items, 5, (x) => ({ url: String(x.url).replace(APP, ''), ms: Math.round(x.total ?? 0) })),
          mainThread: top(a['mainthread-work-breakdown']?.details?.items, 4, (x) => ({ group: x.groupLabel ?? x.group, ms: Math.round(x.duration ?? 0) })),
          thirdParty: top(a['third-party-summary']?.details?.items, 5, (x) => ({ entity: typeof x.entity === 'string' ? x.entity : x.entity?.text, kb: Math.round((x.transferSize ?? 0) / 1024), blockingMs: Math.round(x.blockingTime ?? 0) })),
          fonts: (a['network-requests']?.details?.items ?? []).filter((x) => x.resourceType === 'Font').map((x) => ({ url: x.url.replace(APP, ''), kb: Math.round(x.transferSize / 1024) })),
          serverResponseMs: Math.round(a['server-response-time']?.numericValue ?? 0),
          layoutShifts: top(a['layout-shifts']?.details?.items, 3, (x) => ({ node: x.node?.snippet?.slice(0, 120), score: x.score })),
        },
      })
      fs.writeFileSync(path.join(out, `lighthouse-${label}.json`), JSON.stringify({ label, at: new Date().toISOString(), runs: RUNS, mapChunks: MAP_CHUNKS, results }, null, 1))
    }
  }
} finally {
  await chrome.kill()
  if (made.length) {
    await db.query(`delete from "Booking" where "guestId" = any($1)`, [made]).catch(() => {})
    await db.query(`delete from "Listing" where "hostId" = any($1)`, [made]).catch(() => {})
    for (const t of ['Session', 'AuthToken', 'MessageLog', 'Notification']) await db.query(`delete from "${t}" where "userId" = any($1)`, [made]).catch(() => {})
    await db.query(`delete from "User" where id = any($1)`, [made]).catch(() => {})
  }
  if (who.seeded && bookingId) {
    await db.query(`delete from "BlockedDate" where "listingId" = $1 and date >= now() + interval '290 days'`, [who.listingId]).catch(() => {})
    await db.query(`delete from "Booking" where id = $1`, [bookingId]).catch(() => {})
  }
  await db.end()
}
console.log(`done: e2e/.reports/stageB/lighthouse-${label}.json`)

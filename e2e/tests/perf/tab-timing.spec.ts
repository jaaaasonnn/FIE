import fs from 'fs'
import path from 'path'
import type { Page, Request } from '@playwright/test'
import { test } from '../../lib/test'
import { db } from '../../lib/db'
import { APP, LANE, type Actor } from '../../lib/world'
import { REALISTIC, setLaneLatency } from '../../lib/lane'

// A measurement, not a check (the real-phone finding of 2026-11-10: a bottom-bar tab showed nothing for a second
// or two). Runs only with E2E_TAB_TIMING=<label>. How long the server takes to answer each tab's page, signed in as
// a guest with a few bookings, on the contention lane (an app server whose database is as far away as the test
// says): 0 ms, then REALISTIC (5-15 ms a round trip, Vercel dub1 beside Supabase eu-west-1). Both the browser's
// move between pages (the RSC answer, header `RSC: 1`) and a full page load. The difference between the two
// distances divided by the mean round trip (10 ms) is how many trips to the database run one after another.
// The queries each makes are counted by pg_stat_statements. Written to e2e/load/results/tab-timing-<label>.md.

const LABEL = process.env.E2E_TAB_TIMING
const ROUNDS = 15
const TAP_ROUNDS = 6
const PAGES = [
  { name: 'Trips', path: '/dashboard/guest' },
  { name: 'Wishlists', path: '/dashboard/guest/wishlist' },
  { name: 'Messages', path: '/messages' },
  { name: 'Messages (after the redirect)', path: '/dashboard/guest/messages' },
  { name: 'Profile', path: '/account' },
  { name: 'Explore', path: '/' },
]
const APIS = [
  '/api/auth/session', '/api/notifications', '/api/bookings?guestId=ID', '/api/wishlists?userId=ID',
  '/api/reviews?reviewerId=ID', '/api/messages', '/api/reviews?mine=true', '/api/messages/unread',
]

async function timed(url: string, cookie: string, rsc: boolean): Promise<{ ms: number; status: number }> {
  const start = performance.now()
  const res = await fetch(url, { headers: { cookie: `fiegh_session=${cookie}`, ...(rsc ? { RSC: '1' } : {}) }, redirect: 'manual' })
  await res.arrayBuffer()
  return { ms: performance.now() - start, status: res.status }
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const p90 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length * 0.9)] }


test.describe.configure({ retries: 0 })

type Nav = { ms: number; commitMs: number; requests: string[] }

/** Taps a tab in the bottom bar and times the browser's move: until the last RSC answer for it has arrived (the
 *  server's part plus this machine's loopback), and until the new address is in place (React drew the page) */
async function tapTimed(page: Page, from: string, tab: string, to: RegExp): Promise<Nav> {
  await page.goto(from)
  await page.waitForLoadState('networkidle')
  const requests: string[] = []
  let last = 0
  const onFinished = (req: Request) => {
    const h = req.headers()
    if (!h['rsc'] || h['next-router-prefetch'] || h['next-router-segment-prefetch']) return
    const t = req.timing()
    last = Math.max(last, performance.now())
    requests.push(`${new URL(req.url()).pathname} ${(t.responseEnd - t.requestStart).toFixed(0)} ms`)
  }
  page.on('requestfinished', onFinished)
  const start = performance.now()
  await page.locator(`[data-bottom-bar] [data-tab="${tab}"]`).click()
  await page.waitForURL(to)
  const commitMs = performance.now() - start
  await page.waitForLoadState('networkidle')
  page.off('requestfinished', onFinished)
  return { ms: (last || performance.now()) - start, commitMs, requests }
}

test('how long each bottom-bar tab takes the server, and its queries', async ({ world, page, signIn }) => {
  test.skip(!LABEL, 'a measurement: only with E2E_TAB_TIMING=<label>')
  test.setTimeout(900_000)
  const host = await world.host()
  const guest: Actor = await world.guest()
  const homes = [await world.listing(host), await world.listing(host), await world.listing(host)]
  await world.paidBooking(guest, homes[0].id, { checkIn: '2027-03-01', checkOut: '2027-03-04' })
  await world.mustBook(guest, homes[1].id, { checkIn: '2027-04-01', checkOut: '2027-04-03' })
  await world.mustBook(guest, homes[2].id, { checkIn: '2027-05-01', checkOut: '2027-05-03' })
  for (const home of homes) await guest.call('POST', '/api/wishlists', { userId: guest.id, listingId: home.id })
  await guest.call('POST', '/api/messages', { receiverId: host.id, listingId: homes[0].id, content: 'Hello, is parking included?' })
  await guest.signIn()
  await signIn(guest)
  const cookie = guest.cookie!
  const base = APP[LANE]
  await page.setViewportSize({ width: 390, height: 844 })
  const out: string[] = [`# Bottom-bar tabs: server time (${LABEL})`, '', `Lane app ${base}, a guest with 3 bookings (1 paid), 3 saved homes, 1 conversation. Median / 90th percentile, ms.`, '']

  const TAPS = [
    { name: 'Trips', from: '/account', tab: 'trips', to: /\/dashboard\/guest$/ },
    { name: 'Wishlists', from: '/dashboard/guest', tab: 'wishlists', to: /\/dashboard\/guest\/wishlist$/ },
    { name: 'Messages', from: '/dashboard/guest', tab: 'messages', to: /\/dashboard\/guest\/messages$/ },
    { name: 'Profile', from: '/dashboard/guest', tab: 'profile', to: /\/account$/ },
    { name: 'Explore', from: '/dashboard/guest', tab: 'explore', to: /:3204\/$/ },
  ]
  const taps: Record<string, Record<string, Nav[]>> = {}
  const rows: Record<string, Record<string, number[]>> = {}
  for (const latency of ['0-0', REALISTIC] as const) {
    await setLaneLatency(latency as typeof REALISTIC)
    for (const t of TAPS) {
      await tapTimed(page, base + t.from, t.tab, t.to)
      for (let i = 0; i < TAP_ROUNDS; i++) ((taps[t.name] ??= {})[latency] ??= []).push(await tapTimed(page, base + t.from, t.tab, t.to))
    }
    for (const target of [...PAGES.map((p) => ({ key: `${p.name} (full load)`, url: p.path })), ...APIS.map((a) => ({ key: a, url: a.replace('ID', guest.id) }))]) {
      for (let i = 0; i < 2; i++) await timed(base + target.url, cookie, false)
      const ms: number[] = []
      for (let i = 0; i < ROUNDS; i++) ms.push((await timed(base + target.url, cookie, false)).ms)
      ;(rows[target.key] ??= {})[latency] = ms
    }
  }
  out.push('## A tap on the tab (390 px, Chromium; the RSC answers for the move, prefetches left out)', '',
    '| Tab | 0 ms: answers done / page drawn | 5-15 ms: answers done / page drawn | trips one after another | the RSC requests (one round at 5-15 ms) |', '|---|---|---|---|---|')
  for (const [name, by] of Object.entries(taps)) {
    const a = by['0-0'], b = by[REALISTIC]
    const m = (xs: Nav[], k: 'ms' | 'commitMs') => median(xs.map((x) => x[k])).toFixed(0)
    out.push(`| ${name} | ${m(a, 'ms')} / ${m(a, 'commitMs')} | ${m(b, 'ms')} / ${m(b, 'commitMs')} | ${((median(b.map((x) => x.ms)) - median(a.map((x) => x.ms))) / 10).toFixed(1)} | ${b[0].requests.join('; ')} |`)
  }
  out.push('', '## Full page loads and the API routes behind them (no browser)', '', '| What | 0 ms to the database | 5-15 ms (REALISTIC) | trips one after another (difference / 10 ms) |', '|---|---|---|---|')
  for (const [key, by] of Object.entries(rows)) {
    const a = by['0-0'], b = by[REALISTIC]
    out.push(`| ${key} | ${median(a).toFixed(0)} / ${p90(a).toFixed(0)} | ${median(b).toFixed(0)} / ${p90(b).toFixed(0)} | ${((median(b) - median(a)) / 10).toFixed(1)} |`)
  }

  await setLaneLatency(REALISTIC)
  // In a schema of its own, dropped straight after, so no other test (the grants and RLS checks) ever sees it
  await db.$executeRawUnsafe('create schema if not exists e2e_stats')
  await db.$executeRawUnsafe('create extension if not exists pg_stat_statements schema e2e_stats')
  out.push('', '## Queries (pg_stat_statements, one tap each, with what the page then fetches; Prisma joins the relations of an include into one query and batches the same findUnique made at once)', '')
  for (const t of TAPS) {
    await page.goto(base + t.from)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await db.$queryRawUnsafe('select e2e_stats.pg_stat_statements_reset()')
    await page.locator(`[data-bottom-bar] [data-tab="${t.tab}"]`).click()
    await page.waitForURL(t.to)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    const q = await db.$queryRawUnsafe<{ query: string; calls: bigint }[]>(
      `select query, calls from e2e_stats.pg_stat_statements where query not ilike '%pg_stat_statements%' and query !~* '^(begin|commit|deallocate|set |show )' order by calls desc, query`)
    out.push(`### ${t.name}: ${q.reduce((n, r) => n + Number(r.calls), 0)} statements (the page and what the browser then asks for)`, '', ...q.map((r) => `- ${r.calls} x \`${r.query.replace(/\s+/g, ' ').slice(0, 170)}\``), '')
  }
  await db.$executeRawUnsafe('drop extension if exists pg_stat_statements')
  await db.$executeRawUnsafe('drop schema if exists e2e_stats')
  const file = path.join(__dirname, '..', '..', 'load', 'results', `tab-timing-${LABEL}.md`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, out.join('\n') + '\n')
  console.log(out.join('\n'))
})

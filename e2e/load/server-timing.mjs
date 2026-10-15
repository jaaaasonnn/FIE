// Stage B5: how long the server takes, route by route, on the seeded database.
//   node e2e/run.mjs up --perf=explain        (in its own terminal; LOCAL stack only)
//   node e2e/run.mjs exec node e2e/load/server-timing.mjs <label> [n=50]
// Every API route a page uses and every page's HTML, one request at a time (no competing load), after three
// warm-up requests: p50, p95, p99 and the slowest. Then, from Postgres: the slowest statements
// (pg_stat_statements), their plans with real timings and buffers (auto_explain), tables read by
// sequential scan, and indexes never used. Results: e2e/.reports/stageB/server-timing-<label>.json
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const [label = 'adhoc', nArg = '50'] = process.argv.slice(2)
const N = Number(nArg)
const APP = 'http://localhost:3200'
const CRON = process.env.CRON_SECRET
if (!/127\.0\.0\.1:54329\/fiegh_e2e/.test(process.env.DIRECT_URL ?? '')) throw new Error('not the local test database')
const db = new pg.Client({ connectionString: process.env.DIRECT_URL })
await db.connect()
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
if ((await one(`select count(*)::int n from "Listing" where id like 'load\\_%'`)).n === 0) throw new Error('seed the load set first (e2e/load/seed.mjs)')
await db.query('create extension if not exists pg_stat_statements')

let ipN = 0
const ip = () => `10.77.${Math.floor(++ipN / 250) % 250}.${ipN % 250}`
async function call(method, url, { cookie, body, headers = {} } = {}) {
  const t = performance.now()
  const r = await fetch(APP + url, { method, redirect: 'manual', headers: { origin: APP, 'x-vercel-forwarded-for': ip(), ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie: `fiegh_session=${cookie}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  const ms = performance.now() - t
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: r.status, ms, json, bytes: text.length, cookie: /fiegh_session=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] }
}
const signIn = async (email) => { const r = await call('POST', '/api/auth/signin', { body: { identifier: email, password: 'Load-pass-2026' } }); if (!r.cookie) throw new Error(`sign-in ${email}: ${r.status}`); return r.cookie }
const emailOf = async (id) => (await one(`select email from "User" where id = $1`, [id])).email

// The people and things the requests are about: the busiest guest and host of the load set, and an admin
const G = (await one(`select "guestId" id from "Booking" where id like 'load\\_%' group by 1 order by count(*) desc, 1 limit 1`)).id
const H = (await one(`select "hostId" id from "Booking" where id like 'load\\_%' group by 1 order by count(*) desc, 1 limit 1`)).id
const B = (await one(`select id from "Booking" where "guestId" = $1 and status = 'CONFIRMED' order by "checkIn" limit 1`, [G]))?.id ?? (await one(`select id from "Booking" where "guestId" = $1 limit 1`, [G])).id
const L = (await one(`select "listingId" id from "Booking" where id = $1`, [B])).id
const guest = await signIn(await emailOf(G))
const host = await signIn(await emailOf(H))
const admin = await signIn('load-1@load.fiegh.test')
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

const GET = [
  ['public', '/api/listings?limit=50'], ['public', '/api/listings?limit=50&mode=SHORT_STAY'], ['public', '/api/listings?limit=50&region=Greater%20Accra'],
  ['public', '/api/listings?limit=50&city=Accra'], ['public', `/api/listings?limit=50&checkIn=${day(20)}&checkOut=${day(23)}`], ['public', '/api/listings?limit=50&page=60'],
  ['public', '/api/listings?featured=true&limit=8'], ['public', '/api/listings?limit=50&hostIdChecked=true&checked=true'], ['public', '/api/listings/region-counts'],
  ['public', `/api/listings/${L}`], ['public', `/api/listings/${L}/availability`], ['public', `/api/listings/${L}/blocked-dates`],
  ['public', `/api/reviews?listingId=${L}`], ['public', `/api/users/${H}`], ['public', '/api/exchange-rate'],
  ['guest', '/api/auth/session'], ['guest', `/api/bookings?guestId=${G}`], ['guest', `/api/bookings?id=${B}`], ['guest', `/api/bookings/${B}/cancellation`],
  ['guest', `/api/bookings/${B}/disputes`], ['guest', '/api/messages'], ['guest', `/api/messages?bookingId=${B}`], ['guest', `/api/payments?guestId=${G}`],
  ['guest', '/api/notifications'], ['guest', '/api/wishlists'], ['guest', '/api/users/me'], ['guest', `/api/reviews?reviewerId=${G}`], ['guest', '/api/verifications'],
  ['host', `/api/bookings?hostId=${H}`], ['host', '/api/payouts'], ['host', `/api/payouts?hostId=${H}`], ['host', '/api/users/me/payout-method'], ['host', '/api/payout-banks'],
  ['host', `/api/listings?hostId=${H}`], ['host', '/api/messages'], ['host', `/api/reviews?revieweeId=${H}`],
  ['admin', '/api/admin?type=stats'], ['admin', '/api/admin?type=exchange-rate'], ['admin', '/api/admin/users'], ['admin', '/api/admin/listings'], ['admin', '/api/admin/disputes'],
  ['admin', '/api/admin/rent'], ['admin', '/api/admin/messages'], ['admin', '/api/admin/listing-checks'], ['admin', '/api/admin/verifications'],
]
const PAGES = [
  ['public', '/'], ['public', '/search'], ['public', `/listings/${L}`], ['public', '/faq'], ['public', '/how-it-works'], ['public', '/terms'], ['public', '/privacy'],
  ['public', '/login'], ['public', '/become-a-host'], ['public', `/profile/${H}`], ['public', '/auth/forgot-password'],
  ['guest', '/dashboard/guest'], ['guest', '/dashboard/guest/messages'], ['guest', '/dashboard/guest/payments'], ['guest', '/dashboard/guest/wishlist'],
  ['guest', `/bookings/${B}`], ['guest', `/checkout/${B}`], ['guest', '/profile/edit'], ['guest', '/auth/verify-id'],
  ['host', '/dashboard/host'], ['host', '/dashboard/host/bookings'], ['host', '/dashboard/host/payouts'], ['host', '/dashboard/host/messages'],
  ['host', '/dashboard/host/listings/new'], ['host', `/dashboard/host/listings/${(await one(`select id from "Listing" where "hostId" = $1 limit 1`, [H])).id}/calendar`],
  ['admin', '/admin'],
]
const CRONS = ['complete-bookings', 'process-payouts', 'process-refunds', 'expire-bookings', 'rent-reminders', 'check-disputes', 'listing-check-reminders', 'send-messages', 'cleanup']
const cookieFor = { public: undefined, guest, host, admin }

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] }
const summary = (name, kind, samples, statuses, bytes) => ({ name, kind, n: samples.length, p50: +pct(samples, 50).toFixed(1), p95: +pct(samples, 95).toFixed(1), p99: +pct(samples, 99).toFixed(1), max: +Math.max(...samples).toFixed(1), statuses: [...new Set(statuses)], kb: Math.round(bytes / 1024) })
const results = []
const outDir = path.join(here, '..', '.reports', 'stageB')
fs.mkdirSync(outDir, { recursive: true })
const save = (extra = {}) => fs.writeFileSync(path.join(outDir, `server-timing-${label}.json`), JSON.stringify({ label, at: new Date().toISOString(), n: N, results, ...extra }, null, 1))

await db.query('select pg_stat_statements_reset()')
const tablesBefore = await all(`select relname, seq_scan, seq_tup_read, idx_scan from pg_stat_user_tables`)

const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null // time only the routes whose name matches
async function timeIt(name, kind, fn, n = N) {
  if (ONLY && !ONLY.test(name)) return
  for (let i = 0; i < 3; i++) await fn()
  const samples = []; const statuses = []; let bytes = 0
  for (let i = 0; i < n; i++) { const r = await fn(); samples.push(r.ms); statuses.push(r.status); bytes = r.bytes }
  results.push(summary(name, kind, samples, statuses, bytes))
  const s = results.at(-1)
  console.log(`${kind.padEnd(5)} ${name.padEnd(70)} p50 ${String(s.p50).padStart(7)}  p95 ${String(s.p95).padStart(7)}  p99 ${String(s.p99).padStart(7)} ms  ${s.statuses.join(',')}`)
  save()
}

for (const [who, url] of GET) await timeIt(`GET ${url.replace(/load_\w+/g, ':id')} (${who})`, 'api', () => call('GET', url, { cookie: cookieFor[who] }))
for (const [who, url] of PAGES) await timeIt(`page ${url.replace(/load_\w+/g, ':id')} (${who})`, 'page', () => call('GET', url, { cookie: cookieFor[who] }), Math.min(N, 30))
for (const job of CRONS) await timeIt(`cron ${job} ?dryRun=1`, 'cron', () => call('GET', `/api/cron/${job}?dryRun=1`, { headers: { authorization: `Bearer ${CRON}` } }), 5)

// Writes: each on its own load person or home so the per-person limits are not what is measured
const guests = (await all(`select id, email from "User" where id like 'load\\_u\\_%' and role = 'GUEST' order by id desc limit 60`))
const instant = (await all(`select id from "Listing" where id like 'load\\_l\\_%' and "instantBook" and "rentalModes" = '["SHORT_STAY"]' order by id limit 60`)).map((r) => r.id)
let w = 0
await timeIt('POST /api/auth/signin (bcrypt)', 'write', () => call('POST', '/api/auth/signin', { body: { identifier: guests[w++ % guests.length].email, password: 'Load-pass-2026' } }), 30)
let su = 0
await timeIt('POST /api/auth/signup (bcrypt)', 'write', () => call('POST', '/api/auth/signup', { body: { name: 'Load Signup', email: `load-signup-${Date.now()}-${su++}@load.fiegh.test`, password: 'Load-pass-2026', role: 'GUEST' } }), 30)
const gCookies = []
for (const g of guests.slice(0, 40)) gCookies.push(await signIn(g.email))
let bk = 0; const made = []
const runOffset = Math.floor(Math.random() * 3000) // fresh dates each run, so a rerun does not meet its own earlier bookings
await timeIt('POST /api/bookings (instant book)', 'write', async () => {
  const i = bk++; const r = await call('POST', '/api/bookings', { cookie: gCookies[i % gCookies.length], body: { listingId: instant[i % instant.length], checkIn: day(400 + runOffset + i * 3), checkOut: day(402 + runOffset + i * 3), rentalMode: 'SHORT_STAY', guests: 1 } })
  if (r.json?.booking?.id) made.push({ id: r.json.booking.id, cookie: gCookies[i % gCookies.length] })
  return r
}, 30)
let pm = 0
if (made.length) await timeIt('POST /api/payments (start a payment)', 'write', () => { const b = made[pm++ % made.length]; return call('POST', '/api/payments', { cookie: b.cookie, body: { bookingId: b.id, method: 'CARD' } }) }, Math.min(30, made.length))
let ms = 0
await timeIt('POST /api/messages', 'write', () => call('POST', '/api/messages', { cookie: guest, body: { receiverId: H, listingId: L, content: `Load timing message ${ms++}` } }), 25)
let wl = 0
await timeIt('POST /api/wishlists (toggle)', 'write', () => call('POST', '/api/wishlists', { cookie: guest, body: { listingId: instant[wl++ % instant.length] } }), 30)

// ── What Postgres saw ────────────────────────────────────────────────────────────────────────
const slowest = await all(`select queryid::text, calls::int, round(mean_exec_time::numeric, 2)::float mean_ms, round(max_exec_time::numeric, 2)::float max_ms, round(total_exec_time::numeric, 1)::float total_ms, rows::int, shared_blks_hit::int, shared_blks_read::int, left(regexp_replace(query, '\\s+', ' ', 'g'), 600) query
  from pg_stat_statements where dbid = (select oid from pg_database where datname = 'fiegh_e2e') and query !~* '^(begin|commit|set |show |select pg_stat|deallocate|discard|create extension)' order by mean_exec_time desc limit 25`)
const byTotal = await all(`select calls::int, round(mean_exec_time::numeric, 2)::float mean_ms, round(total_exec_time::numeric, 1)::float total_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 300) query
  from pg_stat_statements where dbid = (select oid from pg_database where datname = 'fiegh_e2e') order by total_exec_time desc limit 15`)
const tablesAfter = await all(`select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup::int rows from pg_stat_user_tables`)
const seqScans = tablesAfter.map((a) => { const b = tablesBefore.find((x) => x.relname === a.relname) ?? { seq_scan: 0, seq_tup_read: 0, idx_scan: 0 }; return { table: a.relname, rows: a.rows, seqScans: Number(a.seq_scan) - Number(b.seq_scan), rowsReadBySeqScan: Number(a.seq_tup_read) - Number(b.seq_tup_read), indexScans: Number(a.idx_scan ?? 0) - Number(b.idx_scan ?? 0) } })
  .filter((t) => t.seqScans > 0).sort((a, b) => b.rowsReadBySeqScan - a.rowsReadBySeqScan)
const unusedIndexes = await all(`select relname "table", indexrelname "index", idx_scan::int scans, pg_size_pretty(pg_relation_size(indexrelid)) size from pg_stat_user_indexes where idx_scan = 0 order by pg_relation_size(indexrelid) desc`)

// The plans auto_explain wrote for statements over 20 ms (with --perf=explain), the slowest first
const logDir = path.join(here, '..', '.state', 'pglog')
const plans = []
if (fs.existsSync(logDir)) {
  const text = fs.readdirSync(logDir).sort().map((f) => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n')
  for (const m of text.matchAll(/duration: ([\d.]+) ms\s+plan:\n([\s\S]*?)(?=\n\d{4}-\d\d-\d\d \d\d:\d\d:\d\d|\n?$)/g)) plans.push({ ms: Number(m[1]), plan: m[2].slice(0, 6000) })
  plans.sort((a, b) => b.ms - a.ms)
}
// One plan per distinct statement: the slowest time it ran
const seen = new Set(); const topPlans = []
for (const p of plans) { const key = (/Query Text: ([\s\S]{0,200})/.exec(p.plan)?.[1] ?? p.plan.slice(0, 200)).replace(/\$\d+|'[^']*'|\d+/g, '?'); if (seen.has(key)) continue; seen.add(key); topPlans.push(p); if (topPlans.length >= 15) break }
save({ guest: G, host: H, booking: B, listing: L, postgres: { slowestByMean: slowest, slowestByTotal: byTotal, seqScans, unusedIndexes, plans: topPlans, plansLogged: plans.length } })
console.log(`done: e2e/.reports/stageB/server-timing-${label}.json (${plans.length} plans logged)`)
await db.end()

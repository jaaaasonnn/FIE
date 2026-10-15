// Seeds (or removes) the load-test data set in the LOCAL test database.
//   node e2e/run.mjs exec node e2e/load/seed.mjs            seed (removes an earlier load set first)
//   node e2e/run.mjs exec node e2e/load/seed.mjs --remove   remove every load_ row
// Refuses anything but 127.0.0.1:54329/fiegh_e2e with the e2e marker row, like lib/db.ts.
// Writes sizes and timings to e2e/.reports/stageB/seed.json.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const url = process.env.DIRECT_URL ?? ''
if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/fiegh_e2e(\?|$)/.test(url)) throw new Error(`not the local test database: refusing (${url.replace(/:[^:@]+@/, ':***@')})`)
const db = new pg.Client({ connectionString: url })
await db.connect()
if ((await db.query(`select to_regclass('public.e2e_marker') t`)).rows[0].t === null) throw new Error('no e2e_marker table: refusing')

const TABLES = ['User', 'Verification', 'Listing', 'Booking', 'Instalment', 'Payment', 'Payout', 'BlockedDate', 'Message', 'Review', 'Wishlist']
const count = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await db.query(`select count(*)::int n from "${t}" where id like 'load\\_%'`)).rows[0].n])))
const timed = async (what, fn) => { const t = Date.now(); await fn(); const s = (Date.now() - t) / 1000; console.log(`${what}: ${s.toFixed(1)} s`); return s }

const report = { at: new Date().toISOString() }
report.removeSeconds = await timed('remove earlier load rows', () => db.query(fs.readFileSync(path.join(here, 'unseed.sql'), 'utf8')))
if (process.argv.includes('--remove')) { console.log(await count()); await db.end(); process.exit(0) }

report.seedSeconds = await timed('seed', () => db.query(fs.readFileSync(path.join(here, 'seed.sql'), 'utf8')))
report.analyzeSeconds = await timed('ANALYZE', () => db.query('ANALYZE'))
report.rows = await count()
report.bookingsByStatus = Object.fromEntries((await db.query(`select status, count(*)::int n from "Booking" where id like 'load\\_%' group by 1 order by 1`)).rows.map((r) => [r.status, r.n]))
report.tableSizes = Object.fromEntries((await db.query(`select relname, pg_size_pretty(pg_total_relation_size(c.oid)) size from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' order by pg_total_relation_size(c.oid) desc limit 15`)).rows.map((r) => [r.relname, r.size]))
report.databaseSize = (await db.query(`select pg_size_pretty(pg_database_size('fiegh_e2e')) s`)).rows[0].s
console.log(JSON.stringify(report, null, 1))
const out = path.join(here, '..', '.reports', 'stageB')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'seed.json'), JSON.stringify(report, null, 1))
await db.end()

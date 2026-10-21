// Samples the machine, the app servers and Postgres while a load scenario runs. LOCAL ONLY.
//   node e2e/run.mjs exec node e2e/load/sampler.mjs <scenario> [everySeconds=5] [apps=3200,3201]
// Writes one JSON line per sample to e2e/.reports/stageC/<scenario>-samples.jsonl until it gets SIGTERM.
// Per app process: CPU % and memory (RSS). Postgres: connections by state, connections waiting for a lock,
// the longest running statement, transactions per second. The machine: load average, free memory, thermal
// warnings (pmset), free disk. It also stops the run (writes a STOP line) if free disk < 5 GB.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const [scenario = 'adhoc', every = '5', appsArg = '3200,3201'] = process.argv.slice(2)
const apps = appsArg.split(',').map(Number)
// STAGE_C_OUT (from stage-c.sh, relative to the repository): where a later run's samples go
const out = process.env.STAGE_C_OUT ? path.resolve(here, '..', '..', process.env.STAGE_C_OUT) : path.join(here, '..', '.reports', 'stageC')
fs.mkdirSync(out, { recursive: true })
const file = path.join(out, `${scenario}-samples.jsonl`)
// Straight to the real Postgres port when the latency proxy is in front, so sampling adds no proxy traffic
const realPort = process.env.E2E_SAMPLER_PG_PORT ?? '54329'
const db = new pg.Client({ connectionString: `postgresql://postgres:e2e@127.0.0.1:${realPort}/fiegh_e2e` })
await db.connect()
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }) } catch { return '' } }
const pidOf = (port) => Number(sh('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).trim().split('\n')[0]) || null
let lastXact = null

async function sample() {
  const at = new Date().toISOString()
  const procs = apps.map((port) => {
    const pid = pidOf(port)
    if (!pid) return { port, up: false }
    const [cpu, rss] = sh('ps', ['-o', '%cpu=,rss=', '-p', String(pid)]).trim().split(/\s+/).map(Number)
    return { port, pid, cpu, rssMB: Math.round((rss || 0) / 1024) }
  })
  const pgState = (await db.query(`select coalesce(state, 'none') state, count(*)::int n from pg_stat_activity where datname = 'fiegh_e2e' and pid <> pg_backend_pid() group by 1`)).rows
  const waiting = (await db.query(`select count(*)::int n from pg_stat_activity where datname = 'fiegh_e2e' and wait_event_type = 'Lock'`)).rows[0].n
  const longest = (await db.query(`select coalesce(max(extract(epoch from now() - query_start)) filter (where state = 'active'), 0)::float s from pg_stat_activity where datname = 'fiegh_e2e' and pid <> pg_backend_pid()`)).rows[0].s
  const total = (await db.query(`select count(*)::int n from pg_stat_activity where backend_type = 'client backend'`)).rows[0].n
  const x = (await db.query(`select xact_commit::bigint + xact_rollback::bigint n, xact_rollback::bigint rb, deadlocks::bigint dl from pg_stat_database where datname = 'fiegh_e2e'`)).rows[0]
  const tps = lastXact ? (Number(x.n) - lastXact.n) / ((Date.now() - lastXact.t) / 1000) : null
  lastXact = { n: Number(x.n), t: Date.now() }
  const load = sh('sysctl', ['-n', 'vm.loadavg']).trim()
  const vm = sh('vm_stat', [])
  const pageSize = Number(/page size of (\d+)/.exec(vm)?.[1] ?? 16384)
  const freePages = Number(/Pages free:\s+(\d+)/.exec(vm)?.[1] ?? 0) + Number(/Pages inactive:\s+(\d+)/.exec(vm)?.[1] ?? 0)
  const therm = sh('pmset', ['-g', 'therm']).split('\n').filter((l) => /level|CPU_Speed_Limit|Scheduler_Limit/i.test(l) && !/No .* recorded/.test(l)).join('; ')
  const diskFreeGB = Number(sh('df', ['-g', '/']).trim().split('\n')[1]?.split(/\s+/)[3] ?? 0)
  const row = { at, apps: procs, pg: { total, byState: Object.fromEntries(pgState.map((r) => [r.state, r.n])), waitingForLock: waiting, longestActiveS: +longest.toFixed(2), tps: tps === null ? null : +tps.toFixed(1), rollbacks: Number(x.rb), deadlocks: Number(x.dl) }, machine: { load, freeMemMB: Math.round((freePages * pageSize) / 1048576), thermal: therm || 'none', diskFreeGB } }
  fs.appendFileSync(file, JSON.stringify(row) + '\n')
  if (diskFreeGB > 0 && diskFreeGB < 5) { fs.appendFileSync(file, JSON.stringify({ at, STOP: 'free disk under 5 GB' }) + '\n'); process.exit(3) }
}

let stopping = false
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, async () => { stopping = true; await db.end().catch(() => {}); process.exit(0) })
while (!stopping) {
  await sample().catch((e) => fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), error: String(e).slice(0, 200) }) + '\n'))
  await new Promise((r) => setTimeout(r, Number(every) * 1000))
}

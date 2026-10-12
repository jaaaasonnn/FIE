#!/usr/bin/env node
// The one way into the end-to-end tests. Every process it starts gets the
// fake environment from lib/env.mjs and nothing from .env.
//
//   node e2e/run.mjs up            start Postgres, the fakes and two app servers; stays running
//   node e2e/run.mjs test [args]   run Playwright (args go to `playwright test`)
//   node e2e/run.mjs exec <cmd>    run any command with the guarded environment
//   node e2e/run.mjs build         build the app with the fake environment
//   node e2e/run.mjs db:reset      drop and re-create the test database
//   node e2e/run.mjs app:kill 3201 / app:start 3201   kill one app server (SIGKILL) and bring it back
//   node e2e/run.mjs down          stop everything `up` started
import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import EmbeddedPostgres from 'embedded-postgres'
import { E2E_DIR, ROOT, PORTS, HOST_MAP, FAKE, e2eEnv, GuardError } from './lib/env.mjs'

const STATE = path.join(E2E_DIR, '.state')
const PIDS = path.join(STATE, 'pids.json')
const EGRESS_LOG = path.join(STATE, 'egress-blocked.log')
const DB_NAME = 'fiegh_e2e'
// A self-signed certificate for the two made-up photo hosts, trusted by the app's server process only
const TLS = { key: path.join(STATE, 'tls-key.pem'), cert: path.join(STATE, 'tls-cert.pem') }
function ensureCertificate() {
  if (fs.existsSync(TLS.cert)) return
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=fiegh-e2e-local', '-addext', 'subjectAltName=DNS:images.unsplash.com,DNS:e2e-storage.fiegh.test', '-keyout', TLS.key, '-out', TLS.cert], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`could not make the local certificate: ${r.stderr}`)
}
fs.mkdirSync(STATE, { recursive: true })
const [command, ...rest] = process.argv.slice(2)
const log = (...a) => console.log('[e2e]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const postgres = () => new EmbeddedPostgres({
  databaseDir: path.join(STATE, 'pgdata'), user: 'postgres', password: 'e2e', port: PORTS.pg, persistent: true,
  // The connection limit of the smallest Supabase computes, so running out shows up here too
  postgresFlags: ['-c', 'max_connections=60', '-c', 'listen_addresses=127.0.0.1', '-c', 'log_min_duration_statement=500'],
  onLog: () => {}, onError: (e) => { const text = String(e); if (!/database system is|listening on|LOG:/.test(text)) fs.appendFileSync(path.join(STATE, 'postgres.log'), text + '\n') },
})

async function reachable(url) { try { return (await fetch(url, { redirect: 'manual' })).status > 0 } catch { return false } }
async function waitFor(url, what, seconds = 90) {
  for (let i = 0; i < seconds * 4; i++) { if (await reachable(url)) return; await sleep(250) }
  throw new Error(`${what} did not come up at ${url}`)
}

/** Creates the roles Supabase has, the tables from the Prisma schema, and the same security state as production. */
async function setupDatabase(pg, { fresh }) {
  const admin = pg.getPgClient(); await admin.connect()
  const exists = (await admin.query('select 1 from pg_database where datname=$1', [DB_NAME])).rowCount > 0
  if (exists && fresh) { await admin.query(`DROP DATABASE ${DB_NAME} WITH (FORCE)`); log('dropped the old test database') }
  if (!exists || fresh) await admin.query(`CREATE DATABASE ${DB_NAME}`)
  for (const role of ['anon NOLOGIN', 'authenticated NOLOGIN', 'service_role NOLOGIN BYPASSRLS']) {
    if ((await admin.query('select 1 from pg_roles where rolname=$1', [role.split(' ')[0]])).rowCount === 0) await admin.query(`CREATE ROLE ${role}`)
  }
  await admin.end()
  const db = pg.getPgClient(DB_NAME); await db.connect()
  const hasMarker = (await db.query(`select to_regclass('public.e2e_marker') as t`)).rows[0].t !== null
  if (!hasMarker) {
    log('creating tables from prisma/schema.prisma')
    const push = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], { cwd: ROOT, env: e2eEnv(), encoding: 'utf8' })
    if (push.status !== 0) throw new Error(`prisma db push failed:\n${push.stdout}\n${push.stderr}`)
    // The same two files production was given, unchanged
    for (const file of ['prisma/enable_rls.sql', 'prisma/constraints.sql']) await db.query(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    // The row that says "this is the throwaway test database". Nothing destructive runs without it.
    await db.query('CREATE TABLE e2e_marker (id int PRIMARY KEY); INSERT INTO e2e_marker VALUES (1); ALTER TABLE e2e_marker ENABLE ROW LEVEL SECURITY;')
    await db.query(`INSERT INTO "ExchangeRate" (id, "usdToGhs", "updatedBy", "updatedAt") VALUES ('e2e_rate', 15.5, 'e2e', now())`).catch((e) => log('note: exchange rate row not seeded:', e.message))
    log('test database ready')
  }
  await db.end()
}

function build() {
  log('building the app with the fake environment (no Sentry upload, no real keys)')
  fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true })
  const r = spawnSync('npx', ['next', 'build'], { cwd: ROOT, env: e2eEnv(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  fs.writeFileSync(path.join(STATE, 'build.log'), r.stdout + r.stderr)
  if (r.status !== 0) throw new Error(`build failed, see e2e/.state/build.log\n${(r.stdout + r.stderr).slice(-1500)}`)
  fs.writeFileSync(path.join(ROOT, '.next', 'E2E_BUILD'), new Date().toISOString())
}

export function startApp(port, extraEnv = {}) {
  const env = e2eEnv({ appPort: port, extra: { NODE_OPTIONS: `--require ${path.join(E2E_DIR, 'preload/egress.cjs')}`, E2E_HOST_MAP: JSON.stringify(HOST_MAP), E2E_EGRESS_LOG: EGRESS_LOG, E2E_TLS_PORT: String(PORTS.tls), NODE_EXTRA_CA_CERTS: TLS.cert, PORT: String(port), ...extraEnv } })
  const out = fs.openSync(path.join(STATE, `app-${port}.log`), 'a')
  return spawn('npx', ['next', 'start', '-p', String(port)], { cwd: ROOT, env, stdio: ['ignore', out, out], detached: true })
}

async function up() {
  if (fs.existsSync(PIDS)) await down()
  fs.writeFileSync(EGRESS_LOG, '')
  ensureCertificate()
  const pg = postgres()
  if (!fs.existsSync(path.join(STATE, 'pgdata', 'PG_VERSION'))) { log('creating a local Postgres 17 in e2e/.state/pgdata'); await pg.initialise() }
  await pg.start()
  await setupDatabase(pg, { fresh: rest.includes('--fresh-db') })
  const fakes = spawn('node', [path.join(E2E_DIR, 'fakes/server.mjs')], { env: { ...e2eEnv(), E2E_FAKES_PORT: String(PORTS.fakes), E2E_STORAGE_PORT: String(PORTS.storage), E2E_TLS_PORT: String(PORTS.tls), E2E_TLS_KEY: TLS.key, E2E_TLS_CERT: TLS.cert }, stdio: ['ignore', fs.openSync(path.join(STATE, 'fakes.log'), 'a'), fs.openSync(path.join(STATE, 'fakes.log'), 'a')], detached: true })
  await waitFor(`${FAKE}/__control/health`, 'the fake services', 20)
  if (rest.includes('--build') || !fs.existsSync(path.join(ROOT, '.next', 'E2E_BUILD'))) build()
  const apps = PORTS.app.map((port) => startApp(port))
  fs.writeFileSync(PIDS, JSON.stringify({ runner: process.pid, fakes: fakes.pid, apps: Object.fromEntries(PORTS.app.map((p, i) => [p, apps[i].pid])) }))
  for (const port of PORTS.app) await waitFor(`http://localhost:${port}/api/auth/session`, `the app on ${port}`)
  log(`up: app on ${PORTS.app.map((p) => `http://localhost:${p}`).join(' and ')}, Postgres on ${PORTS.pg}, fakes on ${PORTS.fakes}/${PORTS.storage}`)
  const stop = async () => { killGroup(fakes.pid); for (const port of PORTS.app) killPort(port); await pg.stop().catch(() => {}); fs.rmSync(PIDS, { force: true }); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  setInterval(() => {}, 1 << 30) // stay up until told to stop
}

function killGroup(pid) { try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} } }
// Only the process LISTENING on the port: a test with a request open to it must not be killed with it
function killPort(port) { const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }); for (const pid of r.stdout.split('\n').filter(Boolean)) { try { process.kill(Number(pid), 'SIGKILL') } catch {} } }
async function down() {
  if (!fs.existsSync(PIDS)) return log('nothing is up')
  const pids = JSON.parse(fs.readFileSync(PIDS, 'utf8'))
  if (pids.runner !== process.pid) { try { process.kill(pids.runner, 'SIGTERM') } catch {} }
  for (let i = 0; i < 40 && fs.existsSync(PIDS); i++) await sleep(250)
  killGroup(pids.fakes); for (const port of [...PORTS.app, PORTS.fakes, PORTS.storage, PORTS.tls]) killPort(port)
  fs.rmSync(PIDS, { force: true })
  log('down')
}

try {
  if (command === 'up') await up()
  else if (command === 'down') await down()
  else if (command === 'build') build()
  else if (command === 'app:kill') { killPort(Number(rest[0])); log(`killed the app on ${rest[0]}`) }
  else if (command === 'app:start') { startApp(Number(rest[0])).unref(); await waitFor(`http://localhost:${rest[0]}/api/auth/session`, `the app on ${rest[0]}`); log(`the app on ${rest[0]} is back`); process.exit(0) }
  else if (command === 'db:reset') { const pg = postgres(); await pg.start(); await setupDatabase(pg, { fresh: true }); await pg.stop() }
  else if (command === 'suite') {
    // Everything in Chromium, then the tests that break things, which must run alone. Both always run.
    const env = e2eEnv({ extra: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('E2E_'))), E2E_EGRESS_LOG: EGRESS_LOG, E2E_STATE_DIR: STATE } })
    const play = (...args) => spawnSync('npx', ['playwright', 'test', '-c', path.join(E2E_DIR, 'playwright.config.ts'), ...args, ...rest], { cwd: ROOT, env, stdio: 'inherit' }).status ?? 1
    const main = play('--project=chromium')
    const chaos = play('--project=chaos')
    process.exit(main || chaos)
  }
  else if (command === 'test' || command === 'exec') {
    // E2E_ROUNDS, E2E_WORKERS and the like are passed on; nothing else from this shell is
    const passed = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('E2E_')))
    const env = e2eEnv({ extra: { ...passed, E2E_EGRESS_LOG: EGRESS_LOG, E2E_STATE_DIR: STATE } })
    const [bin, args] = command === 'test' ? ['npx', ['playwright', 'test', '-c', path.join(E2E_DIR, 'playwright.config.ts'), ...rest]] : [rest[0], rest.slice(1)]
    const r = spawnSync(bin, args, { cwd: ROOT, env, stdio: 'inherit' })
    process.exit(r.status ?? 1)
  } else { console.log('usage: node e2e/run.mjs up|down|build|test|exec|db:reset'); process.exit(command ? 1 : 0) }
} catch (error) {
  console.error(error instanceof GuardError ? `[e2e] GUARD: ${error.message}` : error)
  process.exit(1)
}

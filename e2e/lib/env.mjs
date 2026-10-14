// Builds the environment every end-to-end process runs with, and refuses to
// go on unless it points at this machine only. See README.md, "Guards".
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ROOT = path.resolve(E2E_DIR, '..')
export const PORTS = { pg: 54329, fakes: 4010, storage: 4011, tls: 4443, app: [3200, 3201] }
export const FAKE = `http://127.0.0.1:${PORTS.fakes}`
/** Hosts the app has written into its code, and where the preload sends them instead. */
export const HOST_MAP = {
  'api.paystack.co': `${FAKE}/paystack`,
  'api.resend.com': `${FAKE}/resend`,
  'sms.arkesel.com': `${FAKE}/arkesel`,
  'v6.exchangerate-api.com': `${FAKE}/rate`,
  'images.unsplash.com': `http://127.0.0.1:${PORTS.storage}/unsplash`,
  'e2e-storage.fiegh.test': `http://127.0.0.1:${PORTS.storage}`,
}
const PLACEHOLDER = 'e2e-unset'

const parse = (file) => Object.fromEntries(
  fs.readFileSync(file, 'utf8').split('\n').map((l) => /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
)
/** Only the NAMES of the keys in .env are read, never their values. */
const namesIn = (file) => (fs.existsSync(file) ? Object.keys(parse(file)) : [])

export class GuardError extends Error {}

/**
 * The environment for one process. Starts from the fake values in env.e2e,
 * then gives every key that any .env file has a fake value or a placeholder:
 * Next and Prisma only read a key from .env when the process has none.
 */
export function e2eEnv({ appPort = PORTS.app[0], extra = {} } = {}) {
  const fake = parse(path.join(E2E_DIR, 'env.e2e'))
  const env = {}
  // The few things a child process needs from this shell, and nothing else
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG', 'TERM', 'TZ', 'CI']) if (process.env[key] !== undefined) env[key] = process.env[key]
  Object.assign(env, fake)
  const real = new Set(['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local'].flatMap((f) => namesIn(path.join(ROOT, f))))
  for (const key of real) if (!(key in env)) env[key] = PLACEHOLDER
  env.NEXTAUTH_URL = `http://localhost:${appPort}`
  env.NODE_ENV = 'production'
  env.E2E = '1'
  Object.assign(env, extra)
  assertLocal(env, real)
  return env
}

/** Throws unless the environment can only reach this machine. */
export function assertLocal(env, realKeys = new Set()) {
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    let url
    try { url = new URL(env[key]) } catch { throw new GuardError(`${key} is not a URL: refusing to start`) }
    if (url.hostname !== '127.0.0.1' || url.port !== String(PORTS.pg) || url.pathname !== '/fiegh_e2e') throw new GuardError(`${key} does not point at the local test database: refusing to start`)
  }
  for (const key of realKeys) if (env[key] === undefined) throw new GuardError(`${key} is in .env but has no test value: refusing to start`)
  if (!String(env.PAYSTACK_SECRET_KEY).startsWith('sk_test_e2e_')) throw new GuardError('PAYSTACK_SECRET_KEY is not the fake key: refusing to start')
  if (env.RESEND_API_KEY !== 're_e2e_fake') throw new GuardError('RESEND_API_KEY is not the fake key: refusing to start')
  if (env.ARKESEL_API_KEY !== 'ark_e2e_fake') throw new GuardError('ARKESEL_API_KEY is not the fake key: refusing to start')
  if (env.SENTRY_AUTH_TOKEN) throw new GuardError('SENTRY_AUTH_TOKEN is set: refusing to start')
  const dsn = env.NEXT_PUBLIC_SENTRY_DSN ? new URL(env.NEXT_PUBLIC_SENTRY_DSN).hostname : '127.0.0.1'
  if (dsn !== '127.0.0.1') throw new GuardError('The Sentry DSN is not the local fake: refusing to start')
  if (new URL(env.SUPABASE_URL).hostname !== 'e2e-storage.fiegh.test') throw new GuardError('SUPABASE_URL is not the fake host: refusing to start')
}

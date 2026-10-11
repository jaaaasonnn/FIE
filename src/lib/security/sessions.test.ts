import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './harness'

// Sessions and passwords: what is stored for a sign-in, how one ends, and
// changing a password while signed in.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
const jar = vi.hoisted(() => ({ token: null as string | null }))
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/messaging/notify', () => ({ notify }))
// The request's cookie jar: the browser's copy of the session token
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'fiegh_session' && jar.token ? { value: jar.token } : undefined) }) }))

import { NOW, json, person, reset } from './harness'
import {
  SESSION_TTL_MS, createSession, endAllSessions, getSessionUser, getUserFromToken, hashSessionToken, purgeExpiredSessions,
} from '@/lib/session'
import { COUNTS_KEPT_MS, runCleanup } from '@/lib/cleanup'
import { cronAuthorised } from '@/lib/cronAuth'
import { POST as signIn } from '@/app/api/auth/signin/route'
import { POST as signOut } from '@/app/api/auth/signout/route'
import { GET as whoAmI } from '@/app/api/auth/session/route'
import { POST as changePassword } from '@/app/api/users/me/password/route'
import { GET as cleanupCron } from '@/app/api/cron/cleanup/route'

const PASSWORD = 'correct horse battery'
const HASH = bcrypt.hashSync(PASSWORD, 4)
const sessions = () => (state.tables.session ??= [])
const cookieOf = (res: Response) => /fiegh_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null
/** Signs in through the route, as a browser would, and keeps the cookie */
async function login(email = 'ama@example.test', password = PASSWORD) {
  const res = await signIn(json('POST', { identifier: email, password }))
  const token = cookieOf(res)
  if (res.status === 200) jar.token = token
  return { res, token: token! }
}
const change = (currentPassword: unknown, newPassword: unknown) => changePassword(json('POST', { currentPassword, newPassword }))

beforeEach(() => {
  reset(state)
  jar.token = null
  notify.mockReset()
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'ama', 'GUEST', { email: 'ama@example.test', passwordHash: HASH })
  person(state, 'kofi', 'GUEST', { email: 'kofi@example.test', passwordHash: HASH })
})

describe('what is stored for a session', () => {
  it('only the hash of the token is stored, never the token', async () => {
    const { res, token } = await login()
    expect(res.status).toBe(200)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(sessions()).toHaveLength(1)
    const stored = sessions()[0].token as string
    expect(stored).not.toBe(token)
    expect(stored).toBe(crypto.createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(state.tables)).not.toContain(token)
    // And the cookie still signs the person in
    expect((await getSessionUser())?.id).toBe('ama')
    expect((await whoAmI()).status).toBe(200)
  })

  it('a value copied from the Session table does not sign anyone in', async () => {
    await login()
    const stored = sessions()[0].token as string
    expect(await getUserFromToken(stored)).toBeNull()
    jar.token = stored
    expect(await getSessionUser()).toBeNull()
    expect((await whoAmI()).status).toBe(401)
  })

  it('a session made before tokens were hashed no longer works: everyone signs in again once', async () => {
    const old = 'a'.repeat(64)
    sessions().push({ id: 's_old', userId: 'ama', token: old, expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS) })
    expect(await getUserFromToken(old)).toBeNull()
  })

  it('refuses anything that is not shaped like a token without looking it up', async () => {
    const odd = ['abc', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), "' OR 1=1 --"]
    // Even if a row somehow matched one of them, it is not looked up
    for (const [i, bad] of odd.entries()) sessions().push({ id: `odd_${i}`, userId: 'ama', token: hashSessionToken(bad), expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS) })
    for (const bad of ['', ...odd]) expect(await getUserFromToken(bad), bad).toBeNull()
  })

  it('sets the cookie HttpOnly, SameSite=Lax, for 30 days, and Secure in production', async () => {
    const dev = (await login()).res.headers.get('set-cookie')!.toLowerCase()
    expect(dev).toContain('httponly')
    expect(dev).toContain('samesite=lax')
    expect(dev).toContain('path=/')
    expect(dev).not.toContain('secure')
    expect(sessions()[0].expiresAt).toEqual(new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000))
    vi.stubEnv('NODE_ENV', 'production')
    expect((await login()).res.headers.get('set-cookie')!.toLowerCase()).toContain('secure')
  })

  it('a session that has run out is refused and removed', async () => {
    const { token } = await login()
    vi.setSystemTime(new Date(NOW.getTime() + SESSION_TTL_MS + 1000))
    expect(await getUserFromToken(token)).toBeNull()
    expect(sessions()).toHaveLength(0)
  })
})

describe('signing out', () => {
  it('ends this session and leaves the others', async () => {
    const first = (await login()).token
    const second = (await login()).token
    expect(sessions()).toHaveLength(2)
    jar.token = first
    const res = await signOut(json('POST', {}))
    expect(cookieOf(res)).toBe('')
    expect(await getUserFromToken(first)).toBeNull()
    expect((await getUserFromToken(second))?.id).toBe('ama')
  })

  it('"sign out on every device" ends every session the person has, and nobody else\'s', async () => {
    const tokens = [(await login()).token, (await login()).token, (await login()).token]
    const other = (await login('kofi@example.test')).token
    jar.token = tokens[1]
    const res = await signOut(json('POST', { everywhere: true }))
    expect(await res.json()).toMatchObject({ everywhere: true, ended: 3 })
    for (const token of tokens) expect(await getUserFromToken(token)).toBeNull()
    expect((await getUserFromToken(other))?.id).toBe('kofi')
  })

  it('"everywhere" from a cookie that is not a session ends nothing', async () => {
    const real = (await login()).token
    jar.token = 'f'.repeat(64)
    await signOut(json('POST', { everywhere: true }))
    expect((await getUserFromToken(real))?.id).toBe('ama')
  })
})

describe('changing a password while signed in', () => {
  it('needs the current password', async () => {
    await login()
    for (const wrong of ['not it', '', undefined, ['x'], 'x'.repeat(201)]) expect((await change(wrong, 'a brand new password')).status).toBeGreaterThanOrEqual(400)
    expect(state.tables.user[0].passwordHash).toBe(HASH)
    expect(notify).not.toHaveBeenCalled()
  })

  it('needs to be signed in', async () => {
    expect((await change(PASSWORD, 'a brand new password')).status).toBe(401)
    expect(state.tables.user[0].passwordHash).toBe(HASH)
  })

  it('sets the new password, signs every other device out and keeps this one', async () => {
    const elsewhere = (await login()).token
    const here = (await login()).token
    const other = (await login('kofi@example.test')).token
    jar.token = here
    const res = await change(PASSWORD, 'a brand new password')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ended: 1 })

    const stored = state.tables.user[0].passwordHash as string
    expect(stored).toMatch(/^\$2[aby]\$12\$/)
    expect(await bcrypt.compare('a brand new password', stored)).toBe(true)
    expect(await getUserFromToken(elsewhere)).toBeNull()
    expect((await getUserFromToken(here))?.id).toBe('ama')
    expect((await getUserFromToken(other))?.id).toBe('kofi')
    expect(notify).toHaveBeenCalledWith('account.password_updated', { userId: 'ama', at: NOW.getTime() })

    // The old password no longer signs in; the new one does
    jar.token = null
    expect((await login('ama@example.test', PASSWORD)).res.status).toBe(401)
    expect((await login('ama@example.test', 'a brand new password')).res.status).toBe(200)
  })

  it('refuses a new password that is too short, too long, not text, or the same', async () => {
    await login()
    for (const next of ['short', 'x'.repeat(201), 12345678, ['a long password'], PASSWORD]) expect((await change(PASSWORD, next)).status, String(next).slice(0, 20)).toBe(400)
    expect(state.tables.user[0].passwordHash).toBe(HASH)
  })

  it('allows 5 wrong guesses at the current password in 15 minutes, then none, right or wrong', async () => {
    await login()
    for (let i = 0; i < 5; i++) expect((await change('wrong guess', 'a brand new password')).status).toBe(403)
    expect((await change(PASSWORD, 'a brand new password')).status).toBe(429)
    expect(state.tables.user[0].passwordHash).toBe(HASH)
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60 * 1000 + 1000))
    expect((await change(PASSWORD, 'a brand new password')).status).toBe(200)
  })

  it('cancels reset links asked for before the change', async () => {
    await login()
    ;(state.tables.authToken ??= []).push({ id: 't1', userId: 'ama', purpose: 'RESET_PASSWORD', usedAt: null }, { id: 't2', userId: 'kofi', purpose: 'RESET_PASSWORD', usedAt: null })
    await change(PASSWORD, 'a brand new password')
    expect(state.tables.authToken[0].usedAt).toEqual(NOW)
    expect(state.tables.authToken[1].usedAt).toBeNull()
  })
})

describe('the daily clean-up', () => {
  const day = 24 * 60 * 60 * 1000
  beforeEach(() => {
    sessions().push(
      { id: 's1', userId: 'ama', token: 'h1', expiresAt: new Date(NOW.getTime() - 1000) },
      { id: 's2', userId: 'ama', token: 'h2', expiresAt: new Date(NOW.getTime() + day) },
      { id: 's3', userId: 'kofi', token: 'h3', expiresAt: new Date(NOW.getTime() - 40 * day) },
    )
    ;(state.tables.authRequest ??= []).push(
      { id: 'r1', kind: 'SIGN_IN_FAILED', createdAt: new Date(NOW.getTime() - COUNTS_KEPT_MS - 1000) },
      { id: 'r2', kind: 'SIGN_IN_FAILED', createdAt: new Date(NOW.getTime() - 60 * 1000) },
    )
  })

  it('removes sessions that have run out and counts over a week old, and nothing else', async () => {
    expect(await runCleanup()).toEqual({ mode: 'live', expiredSessions: 2, oldCounts: 1 })
    expect(sessions().map((s) => s.id)).toEqual(['s2'])
    expect(state.tables.authRequest.map((r) => r.id)).toEqual(['r2'])
  })

  it('only counts in a dry run', async () => {
    expect(await runCleanup({ dryRun: true })).toEqual({ mode: 'dry-run', expiredSessions: 2, oldCounts: 1 })
    expect(sessions()).toHaveLength(3)
    expect(state.tables.authRequest).toHaveLength(2)
    expect(await purgeExpiredSessions(NOW, { dryRun: true })).toBe(2)
  })

  it('clears a person\'s own run-out sessions when they sign in', async () => {
    await createSession('ama')
    expect(sessions().map((s) => s.id).filter((id) => ['s1', 's2', 's3'].includes(id as string))).toEqual(['s2', 's3'])
    expect(await endAllSessions('ama')).toBe(2)
  })

  it('runs only for the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-value')
    expect((await cleanupCron(new Request('http://x/api/cron/cleanup?dryRun=1'))).status).toBe(401)
    expect((await cleanupCron(new Request('http://x/api/cron/cleanup?dryRun=1', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
    const ok = await cleanupCron(new Request('http://x/api/cron/cleanup?dryRun=1', { headers: { authorization: 'Bearer cron-secret-value' } }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ mode: 'dry-run' })
    expect(sessions()).toHaveLength(3)
  })
})

describe('the cron secret', () => {
  const ask = (authorization?: string) => cronAuthorised(new Request('http://x', { headers: authorization === undefined ? {} : { authorization } }))
  it('lets in only the exact secret, and nobody when none is set', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-value')
    expect(ask('Bearer cron-secret-value')).toBe(true)
    for (const bad of [undefined, '', 'Bearer', 'Bearer ', 'Bearer cron-secret-valu', 'Bearer cron-secret-valuex', 'bearer cron-secret-value', 'cron-secret-value', 'Bearer undefined']) expect(ask(bad), String(bad)).toBe(false)
    vi.stubEnv('CRON_SECRET', '')
    expect(ask('Bearer ')).toBe(false)
    expect(ask('Bearer')).toBe(false)
    // Not set at all: "Bearer undefined" must not be the secret
    delete process.env.CRON_SECRET
    expect(ask('Bearer undefined')).toBe(false)
    expect(ask('Bearer')).toBe(false)
  })

  it('compares in constant time, on every cron route', async () => {
    const fs = await import('fs')
    const path = await import('path')
    expect(fs.readFileSync(path.resolve(__dirname, '../cronAuth.ts'), 'utf8')).toContain('crypto.timingSafeEqual(')
    const dir = path.resolve(__dirname, '../../app/api/cron')
    const routes = fs.readdirSync(dir).map((name) => path.join(dir, name, 'route.ts'))
    expect(routes.length).toBeGreaterThanOrEqual(10)
    for (const file of routes) {
      const source = fs.readFileSync(file, 'utf8')
      // Every handler asks the shared check first (itself, or through one shared `handle`), and none compares the secret itself
      const CHECK = "if (!cronAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })"
      const firstLines = [...source.matchAll(/export async function (?:GET|POST)\(req: Request\) \{\n {2}(.*)\n/g)].map((m) => m[1])
      expect(firstLines.length, file).toBeGreaterThanOrEqual(1)
      for (const line of firstLines) expect([CHECK, 'return handle(req)'], file).toContain(line)
      if (firstLines.includes('return handle(req)')) expect(source, file).toMatch(/async function handle\(req: Request\) \{\n {2}if \(!cronAuthorised\(req\)\) return/)
      expect(source, file).not.toMatch(/process\.env\.CRON_SECRET|=== `Bearer/)
    }
  })
})

describe('the session token hash', () => {
  it('is a plain SHA-256 of the token', () => {
    expect(hashSessionToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Email verification, email change and password reset, end to end: the real
// routes, the real notify and the real send-messages job, run against an
// in-memory stand-in for the database and a fake email adapter. Nothing here
// can reach Resend, Paystack or a real database, and no email is sent.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  users: [] as Row[], sessions: [] as Row[], tokens: [] as Row[], requests: [] as Row[],
  logs: [] as Row[], notifications: [] as Row[],
  user: null as Row | null,
  pending: [] as Promise<unknown>[],
}))
const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
const fake = vi.hoisted(() => ({ email: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)
// Fast, and still one-way enough for a test: the hash is never the password
vi.mock('bcryptjs', () => ({ default: { hash: async (p: string) => `hashed(${p})`, compare: async (p: string, h: string) => h === `hashed(${p})` } }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))
// The only adapter the code under test can find is this fake
vi.mock('@/lib/messaging/providers', () => ({
  PROVIDERS: { 'fake-email': { name: 'fake-email', channel: 'EMAIL', send: fake.email } },
}))
// notify() normally runs after the response; here its work is kept so a test can wait for it
vi.mock('@/lib/messaging/notify', async (original) => {
  const real = await original<typeof import('@/lib/messaging/notify')>()
  return { ...real, notify: (event: never, ids: never) => { state.pending.push(real.writeMessages(event, ids)) } }
})

vi.mock('@/lib/db', async () => {
  const { Prisma } = await import('@prisma/client')
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' })
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
      const value = row[key] ?? null
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; gt?: Date; gte?: Date; lte?: Date }
        if ('in' in c && !c.in!.includes(value)) return false
        if ('gt' in c && !(value instanceof Date && value > c.gt!)) return false
        if ('gte' in c && !(value instanceof Date && value >= c.gte!)) return false
        if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
        return true
      }
      return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond
    })
  const apply = (row: Row, data: Row) => {
    for (const [key, v] of Object.entries(data)) {
      row[key] = v !== null && typeof v === 'object' && !(v instanceof Date) && 'increment' in v ? (row[key] as number) + (v as { increment: number }).increment : v
    }
  }
  const db = {
    user: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = state.users.find((u) => matches(u, where))
        return row ? { ...row } : null
      },
      findMany: async ({ where }: { where: Row }) => state.users.filter((u) => matches(u, where)).map((u) => ({ ...u })),
      create: async ({ data }: { data: Row }) => {
        const row = { id: `user_${state.users.length + 1}`, emailVerifiedAt: null, optionalEmails: true, ...data }
        state.users.push(row)
        return { ...row }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.users.find((u) => u.id === where.id)!
        // The unique index on email
        if (data.email && state.users.some((u) => u !== row && u.email === data.email)) throw known('P2002')
        apply(row, data)
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.users.filter((u) => matches(u, where))
        rows.forEach((r) => apply(r, data))
        return { count: rows.length }
      },
    },
    session: {
      deleteMany: async ({ where }: { where: Row }) => {
        const keep = state.sessions.filter((s) => !matches(s, where))
        const count = state.sessions.length - keep.length
        state.sessions.splice(0, state.sessions.length, ...keep)
        return { count }
      },
    },
    authToken: {
      create: async ({ data }: { data: Row }) => {
        if (state.tokens.some((t) => t.tokenHash === data.tokenHash)) throw known('P2002')
        const row = { id: `token_${state.tokens.length + 1}`, usedAt: null, ...data }
        state.tokens.push(row)
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        // A yield between two callers reading and writing, as a real database would give
        await tick()
        const rows = state.tokens.filter((t) => matches(t, where))
        rows.forEach((r) => apply(r, data))
        return { count: rows.length }
      },
      findUnique: async ({ where }: { where: Row }) => {
        const row = state.tokens.find((t) => matches(t, where))
        return row ? { ...row, user: { ...state.users.find((u) => u.id === row.userId) } } : null
      },
      findFirst: async ({ where }: { where: Row }) => {
        const row = [...state.tokens].reverse().find((t) => matches(t, where))
        return row ? { ...row } : null
      },
    },
    authRequest: {
      count: async ({ where }: { where: Row }) => state.requests.filter((r) => matches(r, where)).length,
      create: async ({ data }: { data: Row }) => { state.requests.push({ ...data }); return data },
    },
    messageLog: {
      create: async ({ data }: { data: Row }) => {
        if (state.logs.some((l) => l.dedupeKey === data.dedupeKey)) throw known('P2002')
        const row = { id: `msg_${state.logs.length + 1}`, attempts: 0, claimedAt: null, nextAttemptAt: null, sentAt: null, alertedAt: null, providerMessageId: null, sealed: null, createdAt: new Date(), ...data }
        state.logs.push(row)
        return { ...row }
      },
      findMany: async ({ where, take }: { where: Row; take?: number }) => state.logs.filter((l) => matches(l, where)).slice(0, take).map((l) => ({ ...l })),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.logs.filter((l) => matches(l, where))
        rows.forEach((r) => apply(r, data))
        return { count: rows.length }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.logs.find((l) => l.id === where.id)!
        apply(row, data)
        return { ...row }
      },
    },
    notification: { create: async ({ data }: { data: Row }) => { state.notifications.push(data); return data } },
    listing: { findUnique: async () => null },
    exchangeRate: { findFirst: async () => ({ usdToGhs: 15 }) },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  }
  return { db }
})

import {
  BAD_LINK, EMAIL_CHANGE_REQUESTED, EMAIL_NEEDED, EMAIL_NOT_VERIFIED, IP_LIMIT_PER_HOUR, RESET_REQUESTED, TOKEN_TTL_MS,
  USER_LIMIT_PER_HOUR, VERIFICATION_REQUESTED, confirmEmail, consumeToken, hashToken, ipHashOf, issueToken,
} from '@/lib/authTokens'
import { runMessages } from '@/lib/messaging/deliver'
import { unseal } from '@/lib/sealed'
import { POST as forgotRoute } from '@/app/api/auth/forgot-password/route'
import { POST as resetRoute } from '@/app/api/auth/reset-password/route'
import { POST as confirmRoute } from '@/app/api/auth/confirm-email/route'
import { POST as resendRoute } from '@/app/api/auth/resend-verification/route'
import { POST as signupRoute } from '@/app/api/auth/signup/route'
import { GET as sessionlessProfile, PATCH as patchProfile } from '@/app/api/users/me/route'
import { POST as changeEmailRoute } from '@/app/api/users/me/email/route'
import { POST as bookRoute } from '@/app/api/bookings/route'
import { POST as listRoute } from '@/app/api/listings/route'
import { POST as payRoute } from '@/app/api/payments/route'

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2027-03-01T10:00:00Z')
const MIN = 60 * 1000
const HOUR = 60 * MIN
const later = (ms: number) => { vi.setSystemTime(new Date(NOW.getTime() + ms)) }
/** Waits for every message notify() was asked to write. */
const settled = async () => { while (state.pending.length) await state.pending.shift() }

const post = (route: (req: Request) => Promise<Response>, body: unknown, ip = '41.66.1.1') =>
  route(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } }))
const forgot = (email: unknown, ip?: string) => post(forgotRoute, { email }, ip)
const answer = async (res: Response) => ({ status: res.status, body: await res.text() })

const ama = () => state.users.find((u) => u.id === 'ama')!
const tokens = (where: Row = {}) => state.tokens.filter((t) => Object.entries(where).every(([k, v]) => t[k] === v))
const mails = (event?: string) => state.logs.filter((l) => l.channel === 'EMAIL' && (!event || l.event === event))
const signIn = (id = 'ama') => { state.user = { ...state.users.find((u) => u.id === id)! } }
/** A raw token for a user, as the email would carry it. */
const mint = async (purpose: 'VERIFY_EMAIL' | 'CHANGE_EMAIL' | 'RESET_PASSWORD', email = 'ama@example.test', userId = 'ama') =>
  (await issueToken({ userId, purpose, email })).raw
const live = () => { vi.stubEnv('MESSAGING_ENABLED', 'true'); vi.stubEnv('EMAIL_PROVIDER', 'fake-email') }
const sent = () => fake.email.mock.calls.map(([m]) => m as { to: string; subject: string; text: string; html: string })

beforeEach(() => {
  for (const key of ['users', 'sessions', 'tokens', 'requests', 'logs', 'notifications', 'pending'] as const) state[key].length = 0
  state.users.push(
    { id: 'ama', name: 'Ama Owusu', email: 'ama@example.test', phone: null, role: 'GUEST', passwordHash: 'hashed(old-password)', emailVerifiedAt: null, optionalEmails: true },
    { id: 'kofi', name: 'Kofi Mensah', email: 'kofi@example.test', phone: null, role: 'HOST', passwordHash: 'hashed(kofi-password)', emailVerifiedAt: new Date('2027-01-01T00:00:00Z'), optionalEmails: true },
  )
  state.sessions.push({ id: 's1', userId: 'ama', token: 'a' }, { id: 's2', userId: 'ama', token: 'b' }, { id: 's3', userId: 'kofi', token: 'c' })
  state.user = null
  sentry.captureMessage.mockReset()
  sentry.captureException.mockReset()
  fake.email.mockReset()
  fake.email.mockResolvedValue({ ok: true, providerMessageId: 'em_1' })
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_URL', 'https://fiegh.com')
  vi.stubEnv('NEXTAUTH_SECRET', 'a-test-secret-that-is-long-enough')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

// ─── Tokens ─────────────────────────────────────────────────────────────────

describe('a token', () => {
  it('is stored only as its SHA-256 hash, never as itself', async () => {
    const raw = await mint('RESET_PASSWORD')
    expect(raw.length).toBeGreaterThanOrEqual(40)
    expect(tokens()[0].tokenHash).toBe(hashToken(raw))
    expect(tokens()[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(state.tokens)).not.toContain(raw)
  })

  it('is different every time', async () => {
    const made = new Set([await mint('RESET_PASSWORD'), await mint('RESET_PASSWORD'), await mint('VERIFY_EMAIL')])
    expect(made.size).toBe(3)
  })

  it('works once', async () => {
    const raw = await mint('VERIFY_EMAIL')
    expect(await consumeToken(raw, ['VERIFY_EMAIL'])).toMatchObject({ userId: 'ama', purpose: 'VERIFY_EMAIL' })
    expect(await consumeToken(raw, ['VERIFY_EMAIL'])).toBeNull()
  })

  it('is won by one of two requests that arrive together', async () => {
    const raw = await mint('VERIFY_EMAIL')
    const results = await Promise.all([confirmEmail(raw), confirmEmail(raw), confirmEmail(raw)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('expires: a reset link after one hour, the others after 24', async () => {
    expect(TOKEN_TTL_MS).toEqual({ VERIFY_EMAIL: 24 * HOUR, CHANGE_EMAIL: 24 * HOUR, RESET_PASSWORD: 1 * HOUR })
    const reset = await mint('RESET_PASSWORD')
    const verify = await mint('VERIFY_EMAIL')
    later(HOUR + 1000)
    expect(await consumeToken(reset, ['RESET_PASSWORD'])).toBeNull()
    later(24 * HOUR - 1000)
    expect(await consumeToken(verify, ['VERIFY_EMAIL'])).not.toBeNull()
    const second = await mint('VERIFY_EMAIL')
    later(48 * HOUR + 1000)
    expect(await consumeToken(second, ['VERIFY_EMAIL'])).toBeNull()
  })

  it('is cancelled when a newer one of the same kind is made, and not by one of another kind', async () => {
    const first = await mint('RESET_PASSWORD')
    const verify = await mint('VERIFY_EMAIL')
    const second = await mint('RESET_PASSWORD')
    expect(await consumeToken(first, ['RESET_PASSWORD'])).toBeNull()
    expect(await consumeToken(second, ['RESET_PASSWORD'])).not.toBeNull()
    expect(await consumeToken(verify, ['VERIFY_EMAIL'])).not.toBeNull()
  })

  it('cannot be used for a purpose it was not made for', async () => {
    const verify = await mint('VERIFY_EMAIL')
    expect((await answer(await post(resetRoute, { token: verify, password: 'a-new-password' }))).status).toBe(400)
    const reset = await mint('RESET_PASSWORD')
    expect((await post(confirmRoute, { token: reset })).status).toBe(400)
    // And neither attempt used the tokens up
    expect(tokens({ usedAt: null })).toHaveLength(2)
  })

  it('gives the same answer for every kind of bad link', async () => {
    const used = await mint('VERIFY_EMAIL')
    await consumeToken(used, ['VERIFY_EMAIL'])
    const expired = await mint('CHANGE_EMAIL', 'new@example.test')
    later(25 * HOUR)
    const answers = []
    for (const token of [used, expired, 'x'.repeat(43), '', null, 12345, { $ne: null }, 'y'.repeat(5000)]) {
      answers.push(await answer(await post(confirmRoute, { token })))
    }
    expect(new Set(answers.map((a) => `${a.status} ${a.body}`)).size).toBe(1)
    expect(answers[0]).toEqual({ status: 400, body: JSON.stringify({ error: BAD_LINK }) })
  })
})

// ─── Rate limits ────────────────────────────────────────────────────────────

describe('asking for links', () => {
  it('is limited to one a minute for one person', async () => {
    await forgot('ama@example.test')
    await forgot('ama@example.test')
    expect(tokens({ purpose: 'RESET_PASSWORD' })).toHaveLength(1)
    later(61 * 1000)
    await forgot('ama@example.test')
    expect(tokens({ purpose: 'RESET_PASSWORD' })).toHaveLength(2)
  })

  it('is limited to five an hour for one person, whatever address they come from', async () => {
    for (let i = 0; i < 9; i++) {
      later(i * 2 * MIN)
      await forgot('ama@example.test', `41.66.2.${i}`)
    }
    expect(tokens({ purpose: 'RESET_PASSWORD' })).toHaveLength(USER_LIMIT_PER_HOUR)
    // An hour after the first, there is room again
    later(HOUR + 30 * MIN)
    await forgot('ama@example.test', '41.66.3.1')
    expect(tokens({ purpose: 'RESET_PASSWORD' })).toHaveLength(USER_LIMIT_PER_HOUR + 1)
  })

  it('is limited to ten an hour from one IP address, across every account and unknown address', async () => {
    for (let i = 0; i < IP_LIMIT_PER_HOUR; i++) await forgot(`nobody${i}@example.test`, '41.66.9.9')
    await forgot('ama@example.test', '41.66.9.9')
    expect(tokens()).toHaveLength(0)
    // The same person from elsewhere is not held up by it
    await forgot('kofi@example.test', '41.66.9.10')
    expect(tokens({ userId: 'kofi' })).toHaveLength(1)
  })

  it('answers exactly the same when the limit has been reached', async () => {
    const first = await answer(await forgot('ama@example.test'))
    const limited = await answer(await forgot('ama@example.test'))
    expect(limited).toEqual(first)
  })

  it('records every request, with the IP address hashed and never as itself', async () => {
    await forgot('nobody@example.test', '41.66.7.7')
    await forgot('ama@example.test', '41.66.7.7')
    expect(state.requests).toHaveLength(2)
    expect(state.requests.map((r) => r.userId)).toEqual([null, 'ama'])
    expect(JSON.stringify(state.requests)).not.toContain('41.66.7.7')
    expect(state.requests[0].ipHash).toBe(ipHashOf(new Request('http://x', { headers: { 'x-forwarded-for': '41.66.7.7, 10.0.0.1' } })))
    expect(ipHashOf(new Request('http://x'))).toBeNull()
  })

  it('limits sending the verification link again, with the same answer', async () => {
    signIn()
    const first = await answer(await post(resendRoute, {}))
    const second = await answer(await post(resendRoute, {}))
    expect(first).toEqual({ status: 200, body: JSON.stringify({ message: VERIFICATION_REQUESTED }) })
    expect(second).toEqual(first)
    expect(tokens({ purpose: 'VERIFY_EMAIL' })).toHaveLength(1)
  })
})

// ─── Forgotten passwords ────────────────────────────────────────────────────

describe('forgot password', () => {
  it('answers the same whether the address has an account, has none, or is not an address', async () => {
    const answers = []
    for (const [i, email] of ['ama@example.test', 'nobody@example.test', 'not an email', '', null, 42, { email: 'x' }].entries()) {
      answers.push(await answer(await forgot(email, `41.66.4.${i}`)))
    }
    expect(new Set(answers.map((a) => `${a.status} ${a.body}`)).size).toBe(1)
    expect(answers[0]).toEqual({ status: 200, body: JSON.stringify({ message: RESET_REQUESTED }) })
  })

  it('makes a link only for an address that has an account, and finds it whatever the capitals', async () => {
    await forgot('nobody@example.test')
    expect(tokens()).toHaveLength(0)
    await forgot('  Ama@Example.TEST ')
    await settled()
    expect(tokens()).toMatchObject([{ userId: 'ama', purpose: 'RESET_PASSWORD', email: 'ama@example.test' }])
    expect(mails('account.password_reset')).toHaveLength(1)
  })

  it('still answers the same when something breaks', async () => {
    const res = await forgotRoute(new Request('http://x/api', { method: 'POST', body: '{not json' }))
    expect(await answer(res)).toEqual({ status: 200, body: JSON.stringify({ message: RESET_REQUESTED }) })
    // Even with the database down
    const { db } = await import('@/lib/db')
    const down = vi.spyOn(db.authRequest, 'create').mockRejectedValueOnce(new Error('database is down'))
    expect(await answer(await forgot('ama@example.test'))).toEqual({ status: 200, body: JSON.stringify({ message: RESET_REQUESTED }) })
    expect(down).toHaveBeenCalledTimes(1)
    down.mockRestore()
  })

  describe('following the link', () => {
    const reset = (token: unknown, password: unknown = 'a-new-password') => post(resetRoute, { token, password })

    it('sets the new password and signs the account out everywhere', async () => {
      const raw = await mint('RESET_PASSWORD')
      const res = await reset(raw)
      expect(res.status).toBe(200)
      expect(ama().passwordHash).toBe('hashed(a-new-password)')
      // Both of the account's sessions are gone; nobody else's is touched
      expect(state.sessions).toEqual([{ id: 's3', userId: 'kofi', token: 'c' }])
    })

    it('works once', async () => {
      const raw = await mint('RESET_PASSWORD')
      await reset(raw)
      const again = await reset(raw, 'another-password')
      expect(await answer(again)).toEqual({ status: 400, body: JSON.stringify({ error: BAD_LINK }) })
      expect(ama().passwordHash).toBe('hashed(a-new-password)')
    })

    it('refuses a short password without using the link up', async () => {
      const raw = await mint('RESET_PASSWORD')
      expect((await reset(raw, 'short')).status).toBe(400)
      expect((await reset(raw, null)).status).toBe(400)
      expect(ama().passwordHash).toBe('hashed(old-password)')
      expect(state.sessions).toHaveLength(3)
      expect((await reset(raw)).status).toBe(200)
    })

    it('counts as confirming the email, since the link went to it', async () => {
      expect(ama().emailVerifiedAt).toBeNull()
      await reset(await mint('RESET_PASSWORD'))
      expect(ama().emailVerifiedAt).toEqual(NOW)
    })

    it('cancels every other link still out for the account', async () => {
      const change = await mint('CHANGE_EMAIL', 'new@example.test')
      await reset(await mint('RESET_PASSWORD'))
      expect((await post(confirmRoute, { token: change })).status).toBe(400)
      expect(ama().email).toBe('ama@example.test')
    })

    it('tells the account its password was changed', async () => {
      await reset(await mint('RESET_PASSWORD'))
      await settled()
      expect(mails('account.password_changed')).toMatchObject([{ userId: 'ama', subject: 'Your FieGH password was changed' }])
    })
  })
})

// ─── Confirming the email on an account ─────────────────────────────────────

describe('signing up', () => {
  const signup = (body: Row) => post(signupRoute, { name: 'Efua', password: 'a-good-password', ...body })

  it('sends a link to confirm the address, and leaves the account unconfirmed until it is followed', async () => {
    const res = await signup({ email: 'Efua@Example.test' })
    await settled()
    expect(res.status).toBe(201)
    const efua = state.users.find((u) => u.email === 'efua@example.test')!
    expect(efua.emailVerifiedAt).toBeNull()
    expect(tokens({ userId: efua.id })).toMatchObject([{ purpose: 'VERIFY_EMAIL', email: 'efua@example.test' }])
    expect(mails('account.verify_email')).toMatchObject([{ userId: efua.id, subject: 'Confirm your email address for FieGH', recipientMasked: 'e***@example.test' }])
  })

  it('sends no link to an account with only a phone number', async () => {
    await signup({ phone: '0241234567' })
    await settled()
    expect(tokens()).toHaveLength(0)
    expect(mails('account.verify_email')).toHaveLength(0)
  })

  it('still creates the account if the link cannot be made', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', '')
    const res = await signup({ email: 'efua@example.test' })
    expect(res.status).toBe(201)
  })
})

describe('confirming an email address', () => {
  it('marks the address confirmed when the link is followed', async () => {
    const raw = await mint('VERIFY_EMAIL')
    const res = await post(confirmRoute, { token: raw })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ kind: 'VERIFIED' })
    expect(ama().emailVerifiedAt).toEqual(NOW)
  })

  it('proves nothing about a different address the account has since moved to', async () => {
    const raw = await mint('VERIFY_EMAIL')
    ama().email = 'moved@example.test'
    expect((await post(confirmRoute, { token: raw })).status).toBe(400)
    expect(ama().emailVerifiedAt).toBeNull()
  })

  it('needs no sign-in: the link is the proof', async () => {
    state.user = null
    expect((await post(confirmRoute, { token: await mint('VERIFY_EMAIL') })).status).toBe(200)
  })

  it('sends nothing to an address that is already confirmed', async () => {
    signIn('kofi')
    expect((await post(resendRoute, {})).status).toBe(200)
    expect(tokens()).toHaveLength(0)
  })

  it('will not send the link again to someone who is not signed in', async () => {
    expect((await post(resendRoute, {})).status).toBe(401)
  })
})

// ─── Changing email ─────────────────────────────────────────────────────────

describe('changing email', () => {
  const change = (email: unknown, password: unknown = 'old-password') => post(changeEmailRoute, { email, password })
  beforeEach(() => signIn())

  it('needs the current password', async () => {
    for (const password of ['wrong', '', null, 12345678, 'hashed(old-password)']) {
      const res = await change('new@example.test', password)
      expect(res.status, String(password)).toBe(403)
    }
    expect(tokens()).toHaveLength(0)
    expect(state.requests).toHaveLength(0)
  })

  it('needs a sign-in', async () => {
    state.user = null
    expect((await change('new@example.test')).status).toBe(401)
  })

  it('refuses something that is not an email address', async () => {
    expect((await change('not an email')).status).toBe(400)
    expect(tokens()).toHaveLength(0)
  })

  it('changes nothing on the account until the link is followed', async () => {
    const res = await change(' New@Example.test ')
    await settled()
    expect(await answer(res)).toEqual({ status: 200, body: JSON.stringify({ message: EMAIL_CHANGE_REQUESTED }) })
    expect(ama().email).toBe('ama@example.test')
    expect(tokens()).toMatchObject([{ purpose: 'CHANGE_EMAIL', email: 'new@example.test', userId: 'ama' }])
  })

  it('sends the link to the new address and tells the old one', async () => {
    await change('new@example.test')
    await settled()
    expect(mails('account.confirm_new_email')).toMatchObject([{ userId: 'ama', recipientMasked: 'n***@example.test', subject: 'Confirm your new email address for FieGH' }])
    expect(mails('account.email_change_requested')).toMatchObject([{ userId: 'ama', recipientMasked: 'a***@example.test' }])
    expect(mails('account.email_change_requested')[0].body).toContain('asked to change its email to n***@example.test')
    // The old address is told the address only in masked form, and never the link
    expect(mails('account.email_change_requested')[0].body).not.toContain('new@example.test')
    expect(mails('account.email_change_requested')[0].body).not.toContain('token=')
  })

  it('answers the same for an address someone else already has, and sends nothing', async () => {
    const free = await answer(await change('new@example.test'))
    later(2 * MIN)
    const taken = await answer(await change('kofi@example.test'))
    await settled()
    expect(taken).toEqual(free)
    expect(tokens({ email: 'kofi@example.test' })).toHaveLength(0)
    expect(mails().filter((m) => (m.body as string).includes('k***@example.test'))).toHaveLength(0)
  })

  it('answers the same for the address the account already has, and when over the limit', async () => {
    const same = await answer(await change('ama@example.test'))
    const first = await answer(await change('new@example.test'))
    expect(same).toEqual(first)
    // Two requests inside a minute: only the first could have made a link, and it was for the same address
    expect(tokens()).toHaveLength(0)
  })

  it('makes the new address the account\'s email, confirmed, when the link is followed, and keeps the person signed in', async () => {
    const raw = await mint('CHANGE_EMAIL', 'new@example.test')
    const res = await post(confirmRoute, { token: raw })
    await settled()
    expect(await res.json()).toMatchObject({ kind: 'CHANGED' })
    expect(ama()).toMatchObject({ email: 'new@example.test', emailVerifiedAt: NOW })
    expect(state.sessions.filter((s) => s.userId === 'ama')).toHaveLength(2)
    // The old address hears that it is no longer the account's email
    expect(mails('account.email_changed')).toMatchObject([{ userId: 'ama', recipientMasked: 'a***@example.test', subject: 'The email on your FieGH account has changed' }])
  })

  it('is refused at the last moment if someone else took the address in the meantime', async () => {
    const raw = await mint('CHANGE_EMAIL', 'new@example.test')
    state.users.push({ id: 'efua', email: 'new@example.test', role: 'GUEST' })
    expect(await answer(await post(confirmRoute, { token: raw }))).toEqual({ status: 400, body: JSON.stringify({ error: BAD_LINK }) })
    expect(ama()).toMatchObject({ email: 'ama@example.test', emailVerifiedAt: null })
    await settled()
    expect(mails('account.email_changed')).toHaveLength(0)
  })

  it('lets an account with no email add one the same way, with nobody to tell', async () => {
    Object.assign(ama(), { email: null, phone: '+233241234567' })
    signIn()
    await change('first@example.test')
    await settled()
    expect(ama().email).toBeNull()
    expect(mails('account.confirm_new_email')).toHaveLength(1)
    expect(mails('account.email_change_requested')).toHaveLength(0)
    const raw = await mint('CHANGE_EMAIL', 'first@example.test')
    await post(confirmRoute, { token: raw })
    expect(ama()).toMatchObject({ email: 'first@example.test', emailVerifiedAt: NOW })
  })

  it('cannot be done through the profile form any more', async () => {
    const res = await patchProfile(new Request('http://x/api/users/me', { method: 'PATCH', body: JSON.stringify({ name: 'Ama', email: 'sneaky@example.test' }) }))
    expect(res.status).toBe(200)
    expect(ama().email).toBe('ama@example.test')
    Object.assign(ama(), { email: null, phone: '+233241234567' })
    signIn()
    await patchProfile(new Request('http://x/api/users/me', { method: 'PATCH', body: JSON.stringify({ name: 'Ama', phone: '0241234567', email: 'sneaky@example.test' }) }))
    expect(ama().email).toBeNull()
  })

  it('shows the profile what is waiting, masked', async () => {
    await change('new@example.test')
    const profile = (await (await sessionlessProfile()).json()).user
    expect(profile).toMatchObject({ email: 'ama@example.test', emailVerified: false, pendingEmail: 'n***@example.test' })
  })
})

// ─── The link in the message log ────────────────────────────────────────────

describe('a link in the message log', () => {
  const stored = () => JSON.stringify([state.logs, state.tokens, state.notifications])

  it('is never readable while messaging is off: no token, nothing sealed', async () => {
    signIn()
    await forgot('ama@example.test')
    await post(changeEmailRoute, { email: 'new@example.test', password: 'old-password' })
    await settled()
    expect(mails()).toHaveLength(3)
    for (const row of mails()) expect(row).toMatchObject({ status: 'LOGGED', sealed: null })
    expect(mails('account.password_reset')[0].body).toContain('Choose a new password: https://fiegh.com/auth/reset-password?token=[token]')
    expect(mails('account.confirm_new_email')[0].body).toContain('https://fiegh.com/auth/confirm-email?token=[token]')
    // Nothing stored anywhere can be used to follow a link
    expect(stored()).not.toMatch(/token=[A-Za-z0-9_-]{20,}/)
  })

  it('is sealed, not readable, while it waits to be sent', async () => {
    live()
    const { raw, id } = await issueToken({ userId: 'ama', purpose: 'RESET_PASSWORD', email: 'ama@example.test' })
    const { notify } = await import('@/lib/messaging/notify')
    notify('account.password_reset', { tokenId: id, token: raw })
    await settled()
    const row = mails('account.password_reset')[0]
    expect(row.status).toBe('QUEUED')
    expect(row.body).toContain('token=[token]')
    expect(typeof row.sealed).toBe('string')
    expect(stored()).not.toContain(raw)
    expect(unseal(row.sealed as string)).toEqual({ token: raw, to: 'ama@example.test' })
  })

  it('is put into the email only as it is sent, and the seal is thrown away afterwards', async () => {
    live()
    await forgot('ama@example.test')
    await settled()
    await runMessages()
    expect(sent()).toHaveLength(1)
    const [mail] = sent()
    expect(mail.to).toBe('ama@example.test')
    const link = /https:\/\/fiegh\.com\/auth\/reset-password\?token=([A-Za-z0-9_-]{40,})/.exec(mail.text)!
    expect(link).not.toBeNull()
    expect(mail.html).toContain(link[1])
    expect(mail.text).not.toContain('[token]')
    // The link in the email really works
    expect((await post(resetRoute, { token: link[1], password: 'a-new-password' })).status).toBe(200)
    expect(mails('account.password_reset')[0]).toMatchObject({ status: 'SENT', sealed: null })
    expect(stored()).not.toContain(link[1])
  })

  it('goes to the new address for a change of email, and the notice to the old one, even if the change has already happened', async () => {
    live()
    signIn()
    await post(changeEmailRoute, { email: 'new@example.test', password: 'old-password' })
    await settled()
    // The person follows the link before the job has sent the notice
    ama().email = 'new@example.test'
    await runMessages()
    const byTo = Object.fromEntries(sent().map((m) => [m.to, m.subject]))
    expect(byTo).toEqual({
      'new@example.test': 'Confirm your new email address for FieGH',
      'ama@example.test': 'A change of email was asked for on your FieGH account',
    })
    expect(sent().find((m) => m.to === 'ama@example.test')!.text).not.toMatch(/token=/)
  })

  it('keeps its seal for a retry, and loses it when the message is given up', async () => {
    live()
    fake.email.mockResolvedValue({ ok: false, retryable: true, error: 'down' })
    await forgot('ama@example.test')
    await settled()
    await runMessages()
    expect(mails()[0]).toMatchObject({ status: 'FAILED' })
    expect(mails()[0].sealed).not.toBeNull()
    fake.email.mockResolvedValue({ ok: false, retryable: false, error: 'refused' })
    later(6 * MIN)
    await runMessages()
    expect(mails()[0]).toMatchObject({ status: 'GAVE_UP', sealed: null })
  })

  it('is not written at all when there is no secret to seal it with', async () => {
    live()
    vi.stubEnv('NEXTAUTH_SECRET', 'short')
    await forgot('ama@example.test')
    await settled()
    expect(mails()[0]).toMatchObject({ status: 'SKIPPED', sealed: null })
    await runMessages()
    expect(fake.email).not.toHaveBeenCalled()
  })

  it('is skipped, with an alert and nothing sent, if the secret changed before it was sent', async () => {
    live()
    await forgot('ama@example.test')
    await settled()
    vi.stubEnv('NEXTAUTH_SECRET', 'a-different-secret-entirely-000')
    await runMessages()
    expect(fake.email).not.toHaveBeenCalled()
    expect(mails()[0]).toMatchObject({ status: 'SKIPPED', sealed: null })
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
  })

  it('is dropped if messaging is switched off before it is sent', async () => {
    live()
    await forgot('ama@example.test')
    await settled()
    vi.stubEnv('MESSAGING_ENABLED', '')
    await runMessages()
    expect(fake.email).not.toHaveBeenCalled()
    expect(mails()[0]).toMatchObject({ status: 'LOGGED', sealed: null })
  })
})

// ─── What an unconfirmed account can do ─────────────────────────────────────

describe('an account whose email is not confirmed', () => {
  const call = (route: (req: Request) => Promise<Response>, body: Row = {}) => route(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }))
  const gates: [string, () => Promise<Response>][] = [
    ['booking', () => call(bookRoute, { listingId: 'l1', rentalMode: 'SHORT_STAY', checkIn: '2027-04-01', checkOut: '2027-04-03' })],
    ['listing a home', () => call(listRoute, { title: 'A home' })],
    ['paying', () => call(payRoute, { bookingId: 'b1', method: 'CARD' })],
  ]
  const required = () => vi.stubEnv('EMAIL_VERIFICATION_REQUIRED', 'true')
  beforeEach(() => { vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_x'); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests') })) })

  it.each(gates)('is not held back from %s while the rule is switched off', async (_name, go) => {
    signIn()
    ama().role = 'HOST'
    signIn()
    const res = await go()
    expect(res.status).not.toBe(403)
  })

  it.each(gates)('is refused %s once the rule is on, before anything is written or sent', async (_name, go) => {
    required()
    ama().role = 'HOST'
    signIn()
    const res = await go()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: EMAIL_NOT_VERIFIED, code: 'EMAIL_NOT_VERIFIED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(gates)('can go on to %s once the address is confirmed', async (_name, go) => {
    required()
    Object.assign(ama(), { role: 'HOST', emailVerifiedAt: NOW })
    signIn()
    expect((await go()).status).not.toBe(403)
  })

  it('is on only when the switch is exactly "true"', async () => {
    signIn()
    for (const value of ['1', 'TRUE', 'yes', 'true ']) {
      vi.stubEnv('EMAIL_VERIFICATION_REQUIRED', value)
      expect((await gates[0][1]()).status, value).not.toBe(403)
    }
  })

  it('is asked to add an email first when it has none', async () => {
    required()
    Object.assign(ama(), { email: null, phone: '+233241234567' })
    signIn()
    expect(await (await gates[0][1]()).json()).toEqual({ error: EMAIL_NEEDED, code: 'EMAIL_NOT_VERIFIED' })
  })

  it('can still read and edit its own profile, and is told why it is held back', async () => {
    required()
    signIn()
    const profile = await sessionlessProfile()
    expect(profile.status).toBe(200)
    expect((await profile.json()).user).toMatchObject({ emailVerified: false, mustVerifyEmail: true })
    expect((await patchProfile(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Ama O.' }) }))).status).toBe(200)
  })

  it('is let through as soon as the link is followed', async () => {
    required()
    signIn()
    expect((await gates[0][1]()).status).toBe(403)
    await post(confirmRoute, { token: await mint('VERIFY_EMAIL') })
    signIn()
    expect((await gates[0][1]()).status).not.toBe(403)
  })
})

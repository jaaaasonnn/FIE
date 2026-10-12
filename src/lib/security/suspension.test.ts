import bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './harness'

// Suspending an account: who may do it, what it stops, and the record kept.
// The payout side is in cronRuns.test.ts, payouts.test.ts and rentInstalments.test.ts.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
const jar = vi.hoisted(() => ({ token: null as string | null }))
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/messaging/notify', () => ({ notify }))
// The request's cookie jar: the browser's copy of the session token
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'fiegh_session' && jar.token ? { value: jar.token } : undefined) }) }))

import { NOW, home, json, params, person, reset, stay } from './harness'
import { createSession, getSessionUser, getUserFromToken } from '@/lib/session'
import { SUSPENDED_SIGN_IN, REASON_MIN } from '@/lib/suspension'
import { listingVisible, profileVisible } from '@/lib/privacy'
import { TEMPLATES, type Facts, type Piece, type Template } from '@/lib/messaging/templates'
import { POST as signIn } from '@/app/api/auth/signin/route'
import { GET as adminUsers, POST as adminAct } from '@/app/api/admin/users/route'
import { GET as search } from '@/app/api/listings/route'
import { GET as openListing } from '@/app/api/listings/[id]/route'
import { GET as openProfile } from '@/app/api/users/[id]/route'
import { POST as book } from '@/app/api/bookings/route'

const PASSWORD = 'correct horse battery'
const HASH = bcrypt.hashSync(PASSWORD, 4)
const REASON = 'Reported by three guests for taking payment outside FieGH.'
const users = () => state.tables.user
const row = (id: string) => users().find((u) => u.id === id)!
const sessions = () => (state.tables.session ??= [])
const notices = () => (state.tables.notification ??= [])

/** Puts a person's session token in the cookie jar, as if they had signed in on this browser */
async function as(id: string | null) {
  jar.token = id ? (await createSession(id)).token : null
}
const act = (userId: unknown, action: unknown, ...why: unknown[]) => adminAct(json('POST', { userId, action, reason: why.length ? why[0] : REASON }))
const render = (event: string, facts: Facts): Piece[] => (TEMPLATES as Record<string, Template>)[event].render(facts)
const login = (email: string, password = PASSWORD) => signIn(json('POST', { identifier: email, password }))
const found = async () => ((await (await search(new Request('http://localhost/api/listings'))).json()).listings as { id: string }[]).map((l) => l.id)
const bookIt = () => book(json('POST', { listingId: 'home', rentalMode: 'SHORT_STAY', checkIn: '2027-03-20', checkOut: '2027-03-22' }))

beforeEach(() => {
  reset(state)
  jar.token = null
  notify.mockReset()
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'admin', 'ADMIN', { name: 'Akua Admin', passwordHash: HASH })
  person(state, 'admin2', 'ADMIN', { name: 'Yaw Admin', passwordHash: HASH })
  person(state, 'host', 'HOST', { name: 'Kojo Host', passwordHash: HASH })
  person(state, 'ama', 'GUEST', { passwordHash: HASH })
  home(state, 'home', 'host')
  home(state, 'other', 'host2')
  person(state, 'host2', 'HOST')
})

describe('who may suspend an account', () => {
  it('is for admins only', async () => {
    expect((await act('host', 'suspend')).status).toBe(401)
    for (const id of ['ama', 'host']) {
      await as(id)
      expect((await act('host2', 'suspend')).status).toBe(403)
      expect((await adminUsers()).status).toBe(403)
    }
    expect(users().some((u) => u.suspendedAt)).toBe(false)
    expect(notices()).toHaveLength(0)
  })

  it('needs a reason, to suspend and to restore', async () => {
    await as('admin')
    for (const reason of [undefined, null, '', '   ', 'too short', 42, ['a long enough reason'], 'x'.repeat(501)]) {
      expect((await act('host', 'suspend', reason)).status).toBe(400)
    }
    expect(row('host').suspendedAt ?? null).toBeNull()
    expect((await act('host', 'suspend', 'x'.repeat(REASON_MIN))).status).toBe(200)
    for (const reason of [undefined, '', 'short']) expect((await act('host', 'restore', reason)).status).toBe(400)
    expect(row('host').suspendedAt).toBeInstanceOf(Date)
  })

  it('does not let an admin suspend or restore themselves', async () => {
    await as('admin')
    expect((await act('admin', 'suspend')).status).toBe(400)
    expect(row('admin').suspendedAt ?? null).toBeNull()
    expect(sessions()).toHaveLength(1)
    expect(notices()).toHaveLength(0)
  })

  it('never suspends the last admin who can sign in', async () => {
    // Two admins: one may suspend the other
    await as('admin')
    expect((await act('admin2', 'suspend')).status).toBe(200)
    expect((await act('admin2', 'restore')).status).toBe(200)
    // The only other admin is already suspended (set straight in the table):
    // the one who is left cannot be suspended by anyone
    row('admin').suspendedAt = NOW
    const refused = await (await import('@/lib/suspension')).setSuspension({ adminId: 'admin', userId: 'admin2', action: 'suspend', reason: REASON })
    expect(refused).toMatchObject({ ok: false, status: 409 })
    expect(row('admin2').suspendedAt ?? null).toBeNull()
  })

  it('refuses an account that is not there, one already suspended, one not suspended, and anything but suspend or restore', async () => {
    await as('admin')
    expect((await act('nobody', 'suspend')).status).toBe(404)
    expect((await act('host', 'restore')).status).toBe(409)
    expect((await act('host', 'delete')).status).toBe(400)
    expect((await act({ id: 'host' }, 'suspend')).status).toBe(400)
    expect((await act('host', 'suspend')).status).toBe(200)
    expect((await act('host', 'suspend')).status).toBe(409)
    // One suspension, one record for each admin
    expect(notices().filter((n) => n.type === 'ACCOUNT_SUSPENDED')).toHaveLength(2)
  })
})

describe('what a suspension records', () => {
  it('writes who, whom, when and why to every admin, and stores it on the account', async () => {
    await as('admin')
    expect((await act('host', 'suspend')).status).toBe(200)
    expect(row('host')).toMatchObject({ suspendedAt: NOW, suspendedById: 'admin', suspendedReason: REASON })
    const written = notices().filter((n) => n.type === 'ACCOUNT_SUSPENDED')
    expect(written.map((n) => n.userId).sort()).toEqual(['admin', 'admin2'])
    for (const n of written) {
      expect(n.title).toBe('An account was suspended')
      expect(n.body).toContain('Akua Admin (admin)')
      expect(n.body).toContain('Kojo Host (host, HOST)')
      expect(n.body).toContain(NOW.toISOString())
      expect(n.body).toContain(`Reason: ${REASON}`)
    }
  })

  it('records a restoral the same way, and clears the account', async () => {
    await as('admin')
    await act('host', 'suspend')
    expect((await act('host', 'restore', 'Checked with the host: the reports were about another account.')).status).toBe(200)
    expect(row('host')).toMatchObject({ suspendedAt: null, suspendedById: null, suspendedReason: null })
    const written = notices().filter((n) => n.type === 'ACCOUNT_RESTORED')
    expect(written.map((n) => n.userId).sort()).toEqual(['admin', 'admin2'])
    expect(written[0].body).toContain('Akua Admin (admin) restored Kojo Host (host, HOST)')
    expect(written[0].body).toContain('Reason: Checked with the host')
    // The record of the suspension is still there
    expect(notices().filter((n) => n.type === 'ACCOUNT_SUSPENDED')).toHaveLength(2)
  })

  it('keeps a reason on one line', async () => {
    await as('admin')
    await act('host', 'suspend', 'First line of the reason\nView: https://evil.example/x')
    expect(row('host').suspendedReason).toBe('First line of the reason View: https://evil.example/x')
  })

  it('tells the person by email, once for each time', async () => {
    await as('admin')
    await act('host', 'suspend')
    expect(notify.mock.calls).toEqual([['account.suspended', { userId: 'host', at: NOW.getTime() }]])
    await act('host', 'restore')
    expect(notify.mock.calls[1]).toEqual(['account.restored', { userId: 'host', at: NOW.getTime() }])
    // Nothing is sent for an action that was refused
    await act('host', 'restore')
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('the emails say what has happened, and never the admin\'s reason or name', () => {
    const facts: Facts = { appUrl: 'https://fiegh.com', supportEmail: 'support@fiegh.com', userName: 'Kojo Host' }
    const [suspended] = render('account.suspended', facts)
    expect(suspended.to).toBe('user')
    expect(suspended.email!.subject).toBe('Your FieGH account has been suspended')
    const text = suspended.email!.lines.join(' ')
    expect(text).toContain('You cannot sign in')
    expect(text).toContain('support@fiegh.com')
    expect(suspended.sms).toBeUndefined()
    const [restored] = render('account.restored', facts)
    expect(restored.email!.subject).toBe('Your FieGH account has been restored')
    expect(restored.email!.link).toEqual({ label: 'Sign in', path: '/login' })
    expect(Object.keys(TEMPLATES)).toEqual(expect.arrayContaining(['account.suspended', 'account.restored']))
  })

  it('shows admins who is suspended and why, and nobody a password hash', async () => {
    await as('admin')
    await act('host', 'suspend')
    const list = (await (await adminUsers()).json()).users as Record<string, unknown>[]
    expect(list.find((u) => u.id === 'host')).toMatchObject({ suspendedReason: REASON })
    expect(list.find((u) => u.id === 'host')!.suspendedAt).toBeTruthy()
    expect(list.find((u) => u.id === 'ama')!.suspendedAt ?? null).toBeNull()
    expect(JSON.stringify(list)).not.toContain(HASH)
  })
})

describe('a suspended account cannot sign in', () => {
  it('is signed out everywhere at once', async () => {
    await createSession('host')
    await createSession('host')
    await createSession('ama')
    await as('admin')
    const res = await act('host', 'suspend')
    expect((await res.json()).sessionsEnded).toBe(2)
    expect(sessions().filter((s) => s.userId === 'host')).toHaveLength(0)
    // Nobody else's session was touched
    expect(sessions().map((s) => s.userId).sort()).toEqual(['admin', 'ama'])
  })

  it('a session that somehow still exists does not sign a suspended person in', async () => {
    const { token } = await createSession('host')
    expect((await getUserFromToken(token))?.id).toBe('host')
    row('host').suspendedAt = NOW
    expect(await getUserFromToken(token)).toBeNull()
    jar.token = token
    expect(await getSessionUser()).toBeNull()
    // And the session user never carries the suspension columns
    row('host').suspendedAt = null
    expect(Object.keys((await getUserFromToken(token))!)).not.toContain('suspendedAt')
  })

  it('is refused at sign-in with a plain message, and no session is made', async () => {
    await as('admin')
    await act('host', 'suspend')
    jar.token = null
    const before = sessions().length
    const res = await login('host@example.test')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: SUSPENDED_SIGN_IN, code: 'ACCOUNT_SUSPENDED' })
    expect(SUSPENDED_SIGN_IN).toContain('suspended')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(sessions()).toHaveLength(before)
  })

  it('says nothing about the suspension to someone with the wrong password', async () => {
    row('host').suspendedAt = NOW
    const res = await login('host@example.test', 'not the password')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid credentials' })
  })

  it('can sign in again once restored', async () => {
    await as('admin')
    await act('host', 'suspend')
    await act('host', 'restore')
    jar.token = null
    const res = await login('host@example.test')
    expect(res.status).toBe(200)
    const body = JSON.stringify(await res.json())
    for (const key of ['suspendedAt', 'suspendedById', 'suspendedReason', 'passwordHash']) expect(body).not.toContain(key)
  })
})

describe('a suspended host\'s homes', () => {
  it('leave search, and come back when the account is restored', async () => {
    expect((await found()).sort()).toEqual(['home', 'other'])
    row('host').suspendedAt = NOW
    expect(await found()).toEqual(['other'])
    // With the host filters too
    const filtered = await (await search(new Request('http://localhost/api/listings?hostIdChecked=true&superhost=true'))).json()
    expect(filtered.listings).toEqual([])
    row('host').isVerified = true
    expect(((await (await search(new Request('http://localhost/api/listings?hostIdChecked=true'))).json()).listings)).toEqual([])
    row('host').suspendedAt = null
    expect((await found()).sort()).toEqual(['home', 'other'])
  })

  it('are not listed for the public under the host either, but an admin still sees them', async () => {
    row('host').suspendedAt = NOW
    const mine = async () => ((await (await search(new Request('http://localhost/api/listings?hostId=host'))).json()).listings as { id: string }[]).map((l) => l.id)
    expect(await mine()).toEqual([])
    await as('ama')
    expect(await mine()).toEqual([])
    await as('admin')
    expect(await mine()).toEqual(['home'])
  })

  it('cannot be opened by the public, only by an admin or a guest who booked there', async () => {
    const open = async () => (await openListing(new Request('http://localhost/api/listings/home'), params('home')))
    expect((await open()).status).toBe(200)
    row('host').suspendedAt = NOW
    expect((await open()).status).toBe(404)
    await as('ama')
    expect((await open()).status).toBe(404)
    stay(state, 'b1', 'home', 'ama', 'host')
    const mine = await open()
    expect(mine.status).toBe(200)
    // Nothing about the suspension is sent with the listing
    expect(JSON.stringify(await mine.json())).not.toContain('suspended')
    await as('admin')
    expect((await open()).status).toBe(200)
    expect(listingVisible({ hostId: 'host', isActive: true, moderationHold: false, hostSuspended: true }, null, false)).toBe(false)
  })

  it('cannot be booked', async () => {
    await as('ama')
    row('host').suspendedAt = NOW
    const res = await bookIt()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Listing is not available')
    expect(state.tables.booking ?? []).toHaveLength(0)
    expect(state.tables.blockedDate ?? []).toHaveLength(0)
    row('host').suspendedAt = null
    expect((await bookIt()).status).toBe(201)
  })

  it('the host\'s profile is for admins only', async () => {
    const open = async () => (await openProfile(new Request('http://localhost/api/users/host'), params('host'))).status
    expect(await open()).toBe(200)
    row('host').suspendedAt = NOW
    expect(await open()).toBe(404)
    await as('ama')
    expect(await open()).toBe(404)
    await as('admin')
    expect(await open()).toBe(200)
    expect(profileVisible({ id: 'host', role: 'HOST', suspended: true }, null, false)).toBe(false)
  })
})

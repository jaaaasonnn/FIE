import { beforeEach, describe, expect, it, vi } from 'vitest'

// One session read per page drawn (lib/session.ts, getUserFromToken = React's cache). A server-first page checks the
// session and then calls each route's GET, every one of which checks it again: inside one render they must share one
// read. React's cache lasts one server render and is a plain call anywhere else (a route handler); vitest has no
// server render, so here it is stood in by a memo that lives while `render.memo` is set.

const render = vi.hoisted(() => ({ memo: null as Map<unknown, unknown> | null }))
const reads = vi.hoisted(() => ({ n: 0 }))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <A, R>(fn: (arg: A) => R) => (arg: A): R => {
    if (!render.memo) return fn(arg)
    const key = `${String(fn.name)}:${String(arg)}`
    if (!render.memo.has(key)) render.memo.set(key, fn(arg))
    return render.memo.get(key) as R
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    session: {
      findUnique: async () => {
        reads.n++
        return {
          expiresAt: new Date(Date.now() + 86_400_000),
          user: { id: 'u1', name: 'Ama', email: 'ama@example.test', phone: null, role: 'GUEST', profilePhoto: null, trustScore: 0, isVerified: false, isSuperhost: false, emailVerifiedAt: null, suspendedAt: null },
        }
      },
    },
  },
}))
const TOKEN = 'a'.repeat(64)
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'fiegh_session' ? { value: TOKEN } : undefined) }) }))

import { getSessionUser, getUserFromToken } from '@/lib/session'

beforeEach(() => { reads.n = 0; render.memo = null })

describe('the session is read once per page drawn', () => {
  it('inside one render: the page\'s check and every route\'s check share one read, with the same answer', async () => {
    render.memo = new Map()
    const page = await getUserFromToken(TOKEN)
    const routes = await Promise.all([getSessionUser(), getSessionUser(), getSessionUser(), getSessionUser(), getSessionUser(), getSessionUser()])
    expect(reads.n).toBe(1)
    for (const user of routes) expect(user).toEqual(page)
    expect(page?.id).toBe('u1')
  })

  it('a new render reads again', async () => {
    render.memo = new Map()
    await getSessionUser()
    render.memo = new Map()
    await getSessionUser()
    expect(reads.n).toBe(2)
  })

  it('outside a render (a route handler) every call reads, as before', async () => {
    await getSessionUser()
    await getSessionUser()
    await getUserFromToken(TOKEN)
    expect(reads.n).toBe(3)
  })
})

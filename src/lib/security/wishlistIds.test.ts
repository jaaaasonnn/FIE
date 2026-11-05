import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './harness'

// App shell, stage 2: GET /api/wishlists?only=ids gives the hearts on a page of cards which homes the
// signed-in person has saved. Their own list only, ids only, read only.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))

import { as, home, person, reset } from './harness'
import { GET } from '@/app/api/wishlists/route'

const ask = (query: string) => GET(new Request(`http://localhost/api/wishlists${query}`))

beforeEach(() => {
  reset(state)
  person(state, 'host', 'HOST')
  person(state, 'me')
  person(state, 'other')
  home(state, 'h1', 'host')
  home(state, 'h2', 'host')
  state.tables.wishlist = [
    { id: 'w1', userId: 'me', listingId: 'h1', createdAt: new Date() },
    { id: 'w2', userId: 'other', listingId: 'h2', createdAt: new Date() },
  ]
})

describe('GET /api/wishlists?only=ids', () => {
  it('gives the signed-in person their own saved ids and nothing else', async () => {
    as(state, 'me')
    const res = await ask('?only=ids&userId=other')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ids: ['h1'] })
  })

  it('is refused when signed out', async () => {
    expect((await ask('?only=ids')).status).toBe(401)
  })

  it('a null byte in the address is 400', async () => {
    as(state, 'me')
    expect((await ask('?only=%00')).status).toBe(400)
  })
})

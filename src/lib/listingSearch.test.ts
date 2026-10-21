import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './security/harness'

// G2: the search box's words were matched in the browser over the first 50
// homes the API sent, so with more than 50 a home in the typed city was found
// only if it happened to be among them. They are matched on the server now.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))

import { NOW, home, person, reset } from './security/harness'
import { GET as search } from '@/app/api/listings/route'

const find = async (query: string) => {
  const res = await search(new Request(`http://localhost/api/listings?limit=50&${query}`))
  const body = await res.json()
  return { status: res.status, ids: (body.listings as { id: string }[]).map((l) => l.id), total: body.total as number }
}

beforeEach(() => {
  reset(state)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST')
  // The one home in Tamale is the oldest, so never among the newest 50
  home(state, 'tamale', 'host', { city: 'Tamale', region: 'Northern', neighbourhood: 'Lamashegu', title: 'Quiet compound house', createdAt: new Date('2026-01-01T00:00:00Z') })
  for (let i = 0; i < 60; i++) home(state, `accra-${i}`, 'host', { city: 'Accra', neighbourhood: 'Osu', createdAt: new Date(Date.UTC(2026, 5, 1, 0, i)) })
})

describe('the search box', () => {
  it('finds a home in the typed city however many homes there are, in any case', async () => {
    for (const typed of ['Tamale', 'tamale', 'TAMALE', 'tama']) {
      const found = await find(`q=${encodeURIComponent(typed)}`)
      expect(found.ids, typed).toEqual(['tamale'])
      expect(found.total).toBe(1)
    }
  })

  it('matches the neighbourhood, the region and the title too, as the box always did', async () => {
    expect((await find('q=lamashegu')).ids).toEqual(['tamale'])
    expect((await find('q=northern')).ids).toEqual(['tamale'])
    expect((await find('q=compound')).ids).toEqual(['tamale'])
  })

  it('counts every match, not only the first page', async () => {
    const accra = await find('q=accra')
    expect(accra.total).toBe(60)
    expect(accra.ids).toHaveLength(50)
  })

  it('the city filter is no longer case-sensitive', async () => {
    expect((await find('city=tamale')).ids).toEqual(['tamale'])
  })
})

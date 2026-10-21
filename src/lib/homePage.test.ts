import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './security/harness'

// G10: the home page is kept ready made between visits, and its hero links to live listings. A home switched
// off, put on hold or whose host is suspended stayed on it for up to an hour. Each such change now has the page
// drawn again on its next visit.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath }))

import { NOW, as, home, json, params, person, reset } from './security/harness'
import { refreshHomePage } from '@/lib/homePage'
import { DELETE as switchOff, PATCH as edit } from '@/app/api/listings/[id]/route'
import { POST as adminAct } from '@/app/api/admin/route'
import { POST as accountAct } from '@/app/api/admin/users/route'

beforeEach(() => {
  reset(state)
  revalidatePath.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST')
  person(state, 'admin', 'ADMIN')
  person(state, 'admin2', 'ADMIN')
  home(state, 'home', 'host')
})

const refreshed = () => revalidatePath.mock.calls.filter(([path]) => path === '/').length

describe('the home page is drawn again after a change that could take a home off it', () => {
  it('a host switching a home off', async () => {
    as(state, 'host')
    expect((await switchOff(json('DELETE'), params('home'))).status).toBe(200)
    expect(refreshed()).toBe(1)
  })

  it('a host editing a home', async () => {
    as(state, 'host')
    expect((await edit(json('PATCH', { isActive: false }), params('home'))).status).toBe(200)
    expect(refreshed()).toBe(1)
  })

  it('an admin holding a home, and clearing the hold', async () => {
    as(state, 'admin')
    expect((await adminAct(json('POST', { type: 'hold-listing', listingId: 'home' }))).status).toBe(200)
    expect(refreshed()).toBe(1)
    expect((await adminAct(json('POST', { type: 'clear-hold', listingId: 'home' }))).status).toBe(200)
    expect(refreshed()).toBe(2)
  })

  it('an admin suspending the host', async () => {
    as(state, 'admin')
    const res = await accountAct(json('POST', { userId: 'host', action: 'suspend', reason: 'Listed a home that is not theirs.' }))
    expect(res.status).toBe(200)
    expect(refreshed()).toBe(1)
  })

  it('never fails the change it follows', () => {
    revalidatePath.mockImplementationOnce(() => { throw new Error('no store') })
    expect(() => refreshHomePage()).not.toThrow()
  })
})

/* eslint-disable @typescript-eslint/no-explicit-any -- stand-ins for the worker's global scope and its events */
import { describe, expect, it, vi } from 'vitest'
import { OFFLINE_CACHE, OFFLINE_PAGE, OFFLINE_WORKER, OFFLINE_WORKER_OFF } from './offlineWorker'

// The installed app's service worker, run from the text /sw.js serves, in a stand-in for the worker's global scope:
// what it keeps, what it answers, and that it answers nothing else (stage 4).

type Listener = (e: any) => void

function scope(o: { keys?: string[]; network?: (r: any) => Promise<any> } = {}) {
  const listeners: Record<string, Listener> = {}
  const stores = new Map<string, Map<string, any>>()
  for (const k of o.keys ?? []) stores.set(k, new Map([['/old', { old: true }]]))
  const writes: string[] = []
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      add: vi.fn(async (req: any) => { writes.push(`${name} add ${req.url}`); store.set(req.url, { body: `kept ${req.url}` }) }),
      put: vi.fn(async (req: any) => { writes.push(`${name} put ${typeof req === 'string' ? req : req.url}`) }),
      addAll: vi.fn(async () => { writes.push(`${name} addAll`) }),
      match: vi.fn(async (url: string) => store.get(url)),
    }
  }
  const self: any = {
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
    caches: {
      open: vi.fn(async (name: string) => cacheFor(name)),
      keys: vi.fn(async () => [...stores.keys()]),
      delete: vi.fn(async (name: string) => stores.delete(name)),
      match: vi.fn(async () => { throw new Error('the worker must read only its own cache') }),
    },
    Request: class { url: string; init: any; constructor(url: string, init: any) { this.url = url; this.init = init } },
    Response: { error: () => ({ error: true }) },
    fetch: vi.fn(o.network ?? (async (r: any) => ({ status: 200, from: 'network', url: r.url }))),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    registration: { navigationPreload: { enable: vi.fn(async () => {}) }, unregister: vi.fn(async () => true) },
  }
  return { self, listeners, stores, writes }
}

function run(source: string, s: ReturnType<typeof scope>) {
  // Its own scope: the text must not lean on anything of the app's
  new Function('self', source)(s.self)
}

async function extend(fire: Listener, e: Record<string, unknown> = {}) {
  let waited: Promise<unknown> | undefined
  fire({ ...e, waitUntil: (p: Promise<unknown>) => { waited = p } })
  await waited
}

function request(mode: string, method = 'GET', url = 'https://fiegh.test/listings/abc') {
  return { mode, method, url }
}

async function fetchEvent(s: ReturnType<typeof scope>, req: any, preloadResponse: Promise<any> = Promise.resolve(undefined)) {
  let answer: Promise<any> | undefined
  s.listeners.fetch({ request: req, preloadResponse, respondWith: (p: Promise<any>) => { answer = p } })
  return answer
}

describe('the installed app\'s service worker (/sw.js)', () => {
  it('keeps exactly one file, the offline page, in its one cache, asked for afresh, then takes over at once', async () => {
    const s = scope()
    run(OFFLINE_WORKER, s)
    await extend(s.listeners.install)
    expect(s.writes).toEqual([`${OFFLINE_CACHE} add ${OFFLINE_PAGE}`])
    expect(s.self.caches.open).toHaveBeenCalledWith(OFFLINE_CACHE)
    expect(s.self.skipWaiting).toHaveBeenCalled()
    expect(OFFLINE_CACHE).toBe('fiegh-offline-v1')
    expect(OFFLINE_PAGE).toBe('/offline.html')
  })

  it('deletes every other cache when it takes over, turns on navigation preload and takes the open pages', async () => {
    const s = scope({ keys: ['fiegh-offline-v0', 'someone-else', OFFLINE_CACHE] })
    run(OFFLINE_WORKER, s)
    await extend(s.listeners.activate)
    expect([...s.stores.keys()]).toEqual([OFFLINE_CACHE])
    expect(s.self.registration.navigationPreload.enable).toHaveBeenCalled()
    expect(s.self.clients.claim).toHaveBeenCalled()
  })

  it('never answers anything but a GET page load: the API, scripts, photos, Next\'s own fetches, a POST', async () => {
    const s = scope()
    run(OFFLINE_WORKER, s)
    for (const req of [
      request('cors', 'GET', 'https://fiegh.test/api/listings'),
      request('no-cors', 'GET', 'https://fiegh.test/_next/static/chunks/a.js'),
      request('no-cors', 'GET', 'https://images.unsplash.com/photo'),
      request('same-origin', 'GET', 'https://fiegh.test/search?_rsc=1'),
      request('navigate', 'POST', 'https://fiegh.test/login'),
      request('cors', 'POST', 'https://fiegh.test/api/payments'),
    ]) expect(await fetchEvent(s, req), `${req.method} ${req.url} (${req.mode})`).toBeUndefined()
    expect(s.self.fetch).not.toHaveBeenCalled()
  })

  it('a page load comes from the network as it came, an HTTP error too, and nothing is stored', async () => {
    for (const status of [200, 404, 500, 503]) {
      const s = scope({ network: async (r) => ({ status, url: r.url, from: 'network' }) })
      run(OFFLINE_WORKER, s)
      const answer = await fetchEvent(s, request('navigate'))
      expect(await answer).toEqual({ status, url: 'https://fiegh.test/listings/abc', from: 'network' })
      expect(s.writes, 'nothing is kept from a page load').toEqual([])
    }
  })

  it('a preloaded answer is used as it is, without a second fetch', async () => {
    const s = scope()
    run(OFFLINE_WORKER, s)
    const answer = await fetchEvent(s, request('navigate'), Promise.resolve({ status: 500, from: 'preload' }))
    expect(await answer).toEqual({ status: 500, from: 'preload' })
    expect(s.self.fetch).not.toHaveBeenCalled()
  })

  it('only when the page cannot be fetched at all is the offline page shown', async () => {
    const s = scope({ network: async () => { throw new TypeError('Failed to fetch') } })
    run(OFFLINE_WORKER, s)
    await extend(s.listeners.install)
    expect(await (await fetchEvent(s, request('navigate')))).toEqual({ body: `kept ${OFFLINE_PAGE}` })
    // Preload failing (no network) gives the same
    const s2 = scope()
    run(OFFLINE_WORKER, s2)
    await extend(s2.listeners.install)
    expect(await (await fetchEvent(s2, request('navigate'), Promise.reject(new TypeError('offline'))))).toEqual({ body: `kept ${OFFLINE_PAGE}` })
  })

  it('the kill switch deletes every cache and unregisters itself', async () => {
    const s = scope({ keys: [OFFLINE_CACHE, 'other'] })
    run(OFFLINE_WORKER_OFF, s)
    await extend(s.listeners.install)
    expect(s.self.skipWaiting).toHaveBeenCalled()
    await extend(s.listeners.activate)
    expect([...s.stores.keys()]).toEqual([])
    expect(s.self.registration.unregister).toHaveBeenCalled()
    expect(s.listeners.fetch, 'it answers nothing').toBeUndefined()
  })
})

// The installed app's service worker (app shell stage 4), served as /sw.js by src/app/sw.js/route.ts and registered
// by public/shell.js only when FieGH runs from the home screen (display-mode: standalone). A browser tab never gets it.
//
// It does one thing: when a page cannot be fetched at all (no network), it shows /offline.html, "You are offline",
// instead of the phone's own error. Everything else goes on as if it were not there:
// - it keeps exactly one file, /offline.html, in one cache (OFFLINE_CACHE), stored when it is installed;
// - it answers only GET page loads (request.mode 'navigate'), always from the network (navigation preload, so no
//   wait), and gives the offline page only when that fetch fails outright; an HTTP error (a 500, a 404) is passed
//   on as it came, and a slow answer is waited for;
// - it never answers any other request (the API, scripts, photos, Next's own fetches, POSTs, Paystack): those never
//   reach respondWith, so the browser handles them as before;
// - it never stores a page, a price, a booking, a payment, a message or an API answer: the install step is the only
//   place anything is put in a cache. So it can never show anything out of date.
// A new version takes over at once (skipWaiting, clients.claim; safe: it keeps nothing that depends on a version)
// and deletes every other cache. /sw.js is sent with Cache-Control: no-cache and registered with updateViaCache
// 'none', so the browser checks it on page loads. To turn it off everywhere, serve OFFLINE_WORKER_OFF instead (see
// CLAUDE.md, "The installed app").
//
// Plain JavaScript in a string: the worker cannot use the app's own code. Kept as functions so they can be tested
// (src/lib/offlineWorker.test.ts), and sent as their source text.

export const OFFLINE_CACHE = 'fiegh-offline-v1'
export const OFFLINE_PAGE = '/offline.html'
export const WORKER_PATH = '/sw.js'

/** What the worker uses of its global scope (the project's TypeScript has no webworker types) */
type WorkerScope = {
  addEventListener(type: string, listener: (e: WorkerEvent) => void): void
  caches: CacheStorage
  fetch: typeof fetch
  Request: typeof Request
  Response: typeof Response
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
  registration: { navigationPreload?: { enable(): Promise<void> }; unregister(): Promise<boolean> }
}
type WorkerEvent = {
  waitUntil(p: Promise<unknown>): void
  request: Request
  preloadResponse: Promise<Response | undefined>
  respondWith(r: Promise<Response>): void
}

/** The worker. `sw` is the worker's global scope (self). */
export function offlineWorker(sw: WorkerScope, cacheName: string, page: string) {
  sw.addEventListener('install', (e) => {
    e.waitUntil(
      sw.caches.open(cacheName)
        .then((cache) => cache.add(new sw.Request(page, { cache: 'reload' })))
        .then(() => sw.skipWaiting()),
    )
  })
  sw.addEventListener('activate', (e) => {
    e.waitUntil(
      Promise.all([
        sw.caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== cacheName).map((k) => sw.caches.delete(k)))),
        sw.registration.navigationPreload ? sw.registration.navigationPreload.enable() : null,
      ]).then(() => sw.clients.claim()),
    )
  })
  sw.addEventListener('fetch', (e) => {
    const request = e.request
    if (request.mode !== 'navigate' || request.method !== 'GET') return
    e.respondWith((async () => {
      try {
        const preloaded = await e.preloadResponse
        return preloaded || await sw.fetch(request)
      } catch {
        // No answer at all: the network is not there. Any answer, an error page too, was returned above.
        const kept = await sw.caches.open(cacheName).then((cache) => cache.match(page))
        return kept || sw.Response.error()
      }
    })())
  })
}

/** The kill switch: a worker that deletes every cache it can see and unregisters itself, on the first page load
 * after it is deployed. Nothing else changes: pages always came from the network. */
export function offlineWorkerOff(sw: WorkerScope) {
  sw.addEventListener('install', () => sw.skipWaiting())
  sw.addEventListener('activate', (e) => {
    e.waitUntil(
      sw.caches.keys()
        .then((keys) => Promise.all(keys.map((k) => sw.caches.delete(k))))
        .then(() => sw.registration.unregister()),
    )
  })
}

export const OFFLINE_WORKER = `(${offlineWorker.toString()})(self, ${JSON.stringify(OFFLINE_CACHE)}, ${JSON.stringify(OFFLINE_PAGE)})`
export const OFFLINE_WORKER_OFF = `(${offlineWorkerOff.toString()})(self)`

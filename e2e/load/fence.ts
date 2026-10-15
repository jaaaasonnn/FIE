// For contexts a perf test opens itself: the same rule as lib/test.ts, nothing but this machine. Map tiles and
// photos are answered locally; anything else is refused. (Contexts from the fixtures are fenced already.)
import type { BrowserContext } from '@playwright/test'

const STORAGE = 'http://127.0.0.1:4011'
const MAP_STYLE = { version: 8, name: 'e2e', sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0f2' } }] }
const LOCAL = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:|about:)/

export async function problemsFence(context: BrowserContext): Promise<void> {
  await context.route((url) => !LOCAL.test(url.href), async (route) => {
    const url = new URL(route.request().url())
    if (url.host === 'api.maptiler.com') return url.pathname.includes('style.json') ? route.fulfill({ json: MAP_STYLE }) : route.fulfill({ status: 204, body: '' })
    const prefix = url.host === 'images.unsplash.com' ? '/unsplash' : url.host === 'e2e-storage.fiegh.test' ? '' : null
    if (prefix === null) return route.abort('blockedbyclient')
    const res = await fetch(`${STORAGE}${prefix}${url.pathname}${url.search}`)
    return route.fulfill({ status: res.status, contentType: res.headers.get('content-type') ?? 'application/octet-stream', body: Buffer.from(await res.arrayBuffer()) })
  })
}

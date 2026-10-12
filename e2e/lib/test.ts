// The `test` every spec imports. Adds:
//   world     people and bookings for this test, removed by id afterwards
//   problems  console errors, page errors, failed requests and anything that tried to leave this machine
//   signIn    puts a person's session in the browser without going through the form
// and makes the browser itself unable to reach a third party: map tiles and
// photos are answered locally, anything else is refused and recorded.
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { World, freshIp, type Actor } from './world'

export type Problems = { console: string[]; pageErrors: string[]; failedRequests: string[]; external: string[] }
const LOCAL = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:|about:)/
const STORAGE = 'http://127.0.0.1:4011'
const MAP_STYLE = { version: 8, name: 'e2e', sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0f2' } }] }

async function fence(context: BrowserContext, problems: Problems) {
  await context.route(/^https:\/\/api\.maptiler\.com\//, (route) => {
    const url = route.request().url()
    if (url.includes('style.json')) return route.fulfill({ json: MAP_STYLE })
    return route.fulfill({ status: 204, body: '' })
  })
  const fromFake = (prefix: string) => async (route: import('@playwright/test').Route) => {
    const url = new URL(route.request().url())
    const res = await fetch(`${STORAGE}${prefix}${url.pathname}${url.search}`)
    await route.fulfill({ status: res.status, contentType: res.headers.get('content-type') ?? 'application/octet-stream', body: Buffer.from(await res.arrayBuffer()) })
  }
  await context.route(/^https:\/\/images\.unsplash\.com\//, fromFake('/unsplash'))
  await context.route(/^https:\/\/e2e-storage\.fiegh\.test\//, fromFake(''))
  // Everything else that is not this machine: refused, and written down
  await context.route((url) => !LOCAL.test(url.href) && !/^https:\/\/(api\.maptiler\.com|images\.unsplash\.com|e2e-storage\.fiegh\.test)\//.test(url.href), (route) => {
    problems.external.push(route.request().url())
    return route.abort('blockedbyclient')
  })
}

function watch(page: Page, problems: Problems) {
  page.on('console', (m) => { if (m.type() === 'error') problems.console.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => problems.pageErrors.push(String(e).slice(0, 300)))
  page.on('response', (r) => { if (r.status() >= 400) problems.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '')}`) })
  page.on('requestfailed', (r) => { const why = r.failure()?.errorText ?? ''; if (!/ERR_ABORTED|cancelled|NS_BINDING_ABORTED|blockedbyclient/i.test(why)) problems.failedRequests.push(`failed ${r.url().replace(/\?.*/, '')} (${why})`) })
}

type Fixtures = {
  world: World
  problems: Problems
  signIn: (person: Actor, page?: Page) => Promise<void>
}

export const test = base.extend<Fixtures>({
  problems: async ({}, use) => { await use({ console: [], pageErrors: [], failedRequests: [], external: [] }) },
  context: async ({ context, problems }, use) => {
    await context.setExtraHTTPHeaders({ 'x-vercel-forwarded-for': freshIp() })
    await fence(context, problems)
    context.on('page', (page) => watch(page, problems))
    await use(context)
    // Whatever the test was about, the browser must not have tried to reach a third party
    expect(problems.external, 'requests to anything but this machine').toEqual([])
  },
  world: async ({}, use) => {
    const world = new World()
    await use(world)
    await world.cleanup()
  },
  signIn: async ({ context, page }, use) => {
    await use(async (person, target = page) => {
      if (!person.cookie) await person.signIn()
      await context.addCookies([{ name: 'fiegh_session', value: person.cookie!, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
      void target
    })
  },
})
export { expect }

/** Dollars as the site writes them. */
export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

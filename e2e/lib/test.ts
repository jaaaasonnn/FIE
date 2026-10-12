// The `test` every spec imports. Adds:
//   world     people and bookings for this test, removed by id afterwards
//   problems  console errors, page errors, failed requests and anything that tried to leave this machine
//   signIn    puts a person's session in the browser without going through the form
// and makes the browser itself unable to reach a third party: map tiles and
// photos are answered locally, anything else is refused and recorded.
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { World, freshIp, type Actor } from './world'

export type Problems = { console: string[]; pageErrors: string[]; failedRequests: string[]; external: string[]; /** What the report-only content policy would have blocked */ csp: string[] }
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
  // (WebKit reports a prefetch that navigation cancelled as "cannot load … due to access control checks": not an error of the page)
  page.on('pageerror', (e) => { if (!/due to access control checks/.test(String(e))) problems.pageErrors.push(String(e).slice(0, 300)) })
  page.on('response', (r) => { if (r.status() >= 400) problems.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '')}`) })
  // (the browser posting a content-policy report to the fake Sentry address is not a page request)
  page.on('requestfailed', (r) => { const why = r.failure()?.errorText ?? ''; if (!/ERR_ABORTED|cancelled|NS_BINDING_ABORTED|blockedbyclient/i.test(why) && !/\/api\/\d+\/security\//.test(r.url())) problems.failedRequests.push(`failed ${r.url().replace(/\?.*/, '')} (${why})`) })
}

type Fixtures = {
  world: World
  problems: Problems
  signIn: (person: Actor, page?: Page) => Promise<void>
}

export const test = base.extend<Fixtures>({
  problems: async ({}, use) => { await use({ console: [], pageErrors: [], failedRequests: [], external: [], csp: [] }) },
  context: async ({ context, problems }, use) => {
    await context.setExtraHTTPHeaders({ 'x-vercel-forwarded-for': freshIp() })
    await fence(context, problems)
    context.on('page', (page) => watch(page, problems))
    // The content policy is report-only: nothing is blocked, but what it WOULD block is collected here
    await context.exposeBinding('__e2eCsp', (_source, line: string) => { problems.csp.push(line) })
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        const where = e.sourceFile ? ` at ${e.sourceFile.replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}:${e.lineNumber}` : ''
        ;(window as unknown as { __e2eCsp?: (line: string) => void }).__e2eCsp?.(`${e.effectiveDirective} | ${(e.blockedURI || 'inline').slice(0, 80)}${where}`)
      })
    })
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

/**
 * WebKit will not keep a `Secure` cookie from a plain-http page, even on
 * localhost (Chromium and Firefox do). The app marks its session cookie
 * Secure in production mode, and this stack serves http. So logging in
 * through the form cannot work in the WebKit projects here; it would over
 * https. Tests that need it say so and are skipped there, and that is listed
 * as not tested. Everything else in WebKit signs in with the `signIn` fixture.
 */
export const FORM_LOGIN_NEEDS_HTTPS = 'WebKit drops the Secure session cookie on http://localhost: logging in through the form needs an https front, which this stack does not have'

/** Dollars as the site writes them. */
export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

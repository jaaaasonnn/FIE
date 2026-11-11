import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { fence, watch, type Problems } from './test'
import { freshIp } from './world'

// FieGH as an installed app, in the tests (app shell stage 4). Full Chromium (Playwright's "chromium" channel, not the
// headless shell) opened with --app=<address> is an app window: display-mode is really "standalone" there, on every
// page it goes to, so the app's own CSS and public/shell.js behave as they do from a phone's home screen. Nothing is
// installed: an install through the browser would write an app to ~/Applications on this Mac. Its own profile, with
// service workers allowed (the config blocks them everywhere else), the same fence as every test (nothing leaves
// this machine), and the screen's safe areas set as a phone's (Emulation.setSafeAreaInsetsOverride).
//
// What this cannot show: a real iPhone or Android phone's status bar, notch or Dynamic Island, home indicator, install
// screens, or how Safari hands a page to another site and back. That is e2e/REAL-PHONE-CHECKLIST.md.

export const APP = 'http://localhost:3200'
/** An iPhone with a Dynamic Island, in portrait, if the page were drawn under the status bar */
export const ISLAND = { top: 59, bottom: 34, left: 0, right: 0 }
export type Insets = typeof ISLAND

export async function setInsets(context: BrowserContext, page: Page, insets: Insets) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets })
}

/** How long the app window's start-up (launch to the standalone check) may take: 1-2 s normally (AS23 probes) */
export const START_LIMIT_MS = 20_000

/**
 * AS23 (cause proven, 2026-11-11). About one app window in 150 to 400 stops answering Playwright right after it starts:
 * Chromium has drawn /offline.html (its own history says so), but the first DevTools calls never return. With the
 * trace on, the runner's own call inside the launch is that first call, so the launch never returned; with the trace
 * off, `setExtraHTTPHeaders` never returned instead (probes of 600 and 1,200 windows, every step timed). Playwright's
 * launch `timeout` does not end it. No request of the test's had been made, so nothing in the app is involved.
 * So the whole start-up has a limit: once over it, that Chromium is ended by its profile folder (each window has its
 * own), the stuck start-up is let fail (so the runner forgets that window: otherwise the next test found its trace
 * "already started"), and the window is started again with a fresh profile, once, logged as `[e2e] AS23`.
 */
async function startApp(o: { problems: Problems; width?: number; height?: number; insets?: Insets; cookie?: string }) {
  for (let attempt = 1; ; attempt++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiegh-app-'))
    const starting = (async () => {
      const context = await chromium.launchPersistentContext(dir, {
        channel: 'chromium',
        args: [`--app=${APP}/offline.html`],
        viewport: { width: o.width ?? 390, height: o.height ?? 844 },
        locale: 'en-GH',
        timezoneId: 'Africa/Accra',
        serviceWorkers: 'allow',
      })
      try {
        await context.setExtraHTTPHeaders({ 'x-vercel-forwarded-for': freshIp() })
        await fence(context, o.problems)
        if (o.cookie) await context.addCookies([{ name: 'fiegh_session', value: o.cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
        const app = context.pages()[0] ?? await context.waitForEvent('page')
        watch(app, o.problems)
        await app.waitForLoadState()
        if (o.insets) await setInsets(context, app, o.insets)
        if (!await standalone(app)) throw new Error('the app window is not in display-mode: standalone')
        return { context, app }
      } catch (error) {
        await context.close().catch(() => {})
        throw error
      }
    })()
    // E2E_AS23_DRILL=1: the first start-up is given 200 ms (it takes 1-2 s), to prove the second start works
    const limit = attempt === 1 && process.env.E2E_AS23_DRILL === '1' ? 200 : START_LIMIT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), limit) })
    const started = await Promise.race([starting, late]).finally(() => clearTimeout(timer))
    if (started) return { ...started, dir }
    // Stuck: end that one Chromium (its command line names the profile folder) and let its start-up fail first
    spawnSync('pkill', ['-f', dir])
    const settled = await Promise.race([starting.then((s) => s.context.close(), () => {}).then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 10_000))])
    fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }, () => {})
    if (attempt > 1) throw new Error(`AS23: the app window did not start in ${limit / 1000} s, twice`)
    console.log(`[e2e] AS23: the app window did not start in ${limit / 1000} s${settled ? '' : ' (and was not let go in 10 s)'}; starting it again`)
  }
}

/**
 * Opens FieGH as an installed app: an app window at `/offline.html` (a static file, so nothing is asked for before
 * the fence and the cookie are in place), then `path`. Give `cookie` to be signed in.
 */
export async function installedApp(o: { problems: Problems; path?: string; width?: number; height?: number; insets?: Insets; cookie?: string }) {
  const { context, app, dir } = await startApp(o)
  if (o.path) await app.goto(`${APP}${o.path}`)
  return {
    context,
    app,
    close: async () => {
      await context.unrouteAll({ behavior: 'ignoreErrors' })
      await context.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

export const standalone = (page: Page) => page.evaluate(() => matchMedia('(display-mode: standalone)').matches)

/** Waits until the installed app's worker controls the page, and says which script it runs */
export async function workerInControl(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15_000 })
  return page.evaluate(() => navigator.serviceWorker.controller!.scriptURL)
}

/** Every cache the page's origin holds, and the addresses in each */
export function cachesOf(page: Page) {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {}
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => r.url)
    return out
  })
}

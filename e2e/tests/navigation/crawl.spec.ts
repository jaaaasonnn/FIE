import fs from 'fs'
import path from 'path'
import { test, expect } from '../../lib/test'
import { ADMIN_TABS, buildSite, type Visitor } from '../../lib/sitemap'
import { call } from '../../lib/world'

// Every page, as every kind of visitor: it loads, nothing errors in the
// console, no request fails, and every link on it leads somewhere.

const EXPECTED_FAILURES = [
  /401 GET .*\/api\/auth\/session$/, // how the header learns nobody is signed in
  /400 POST .*\/api\/auth\/(confirm-email|reset-password)$/, // the two "bad link" pages, on purpose
]
const expected = (line: string) => EXPECTED_FAILURES.some((re) => re.test(line))

for (const visitor of ['signed out', 'guest', 'host', 'admin'] as Visitor[]) {
  test(`crawl as ${visitor}: every page loads clean and every link leads somewhere @core`, async ({ page, world, problems, signIn }) => {
    test.setTimeout(240_000)
    const site = await buildSite(world)
    const who = visitor === 'signed out' ? null : site[visitor]
    if (who) await signIn(who)
    const report: Record<string, unknown>[] = []
    const links = new Map<string, string>() // href -> the page it was found on

    for (const stop of site.pages[visitor]) {
      await test.step(stop.name, async () => {
        const before = { console: problems.console.length, pageErrors: problems.pageErrors.length, failed: problems.failedRequests.length, csp: problems.csp.length }
        const response = await page.goto(stop.path, { waitUntil: 'networkidle' })
        await expect(page.locator('body')).not.toBeEmpty()
        const found = await page.evaluate(() => ({
          title: document.title,
          h1: document.querySelector('h1')?.textContent?.trim() ?? '',
          text: document.body.innerText.length,
          hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
          insecure: [...document.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"], iframe[src^="http:"]')].map((e) => e.getAttribute('src') ?? e.getAttribute('href') ?? '').filter((u) => !/^http:\/\/(localhost|127\.0\.0\.1)/.test(u)),
          errorScreen: /application error|something went wrong|unhandled|this page could not be found/i.test(document.body.innerText),
        }))
        for (const href of found.hrefs) if (href.startsWith('/') && !href.startsWith('//')) links.set(href.split('#')[0], links.get(href.split('#')[0]) ?? stop.name)
        const entry = {
          visitor, page: stop.name, path: stop.path, status: response?.status(), landedOn: new URL(page.url()).pathname, title: found.title, h1: found.h1,
          consoleErrors: problems.console.slice(before.console).filter((l) => !/Failed to load resource|Content[ -]Security[ -]Policy|Report[ -]Only/i.test(l)),
          pageErrors: problems.pageErrors.slice(before.pageErrors),
          failedRequests: problems.failedRequests.slice(before.failed).filter((l) => !expected(l)),
          wouldBeBlockedByContentPolicy: [...new Set(problems.csp.slice(before.csp))],
          insecure: found.insecure, errorScreen: found.errorScreen && !/bad link/.test(stop.name),
        }
        report.push(entry)
        expect.soft(entry.status, `${stop.name}: HTTP status`).toBe(200)
        expect.soft(found.text, `${stop.name}: the page has content`).toBeGreaterThan(100)
        expect.soft(entry.pageErrors, `${stop.name}: script errors`).toEqual([])
        expect.soft(entry.consoleErrors, `${stop.name}: console errors`).toEqual([])
        expect.soft(entry.failedRequests, `${stop.name}: failed requests`).toEqual([])
        expect.soft(entry.insecure, `${stop.name}: content loaded over plain http`).toEqual([])
        expect.soft(entry.errorScreen, `${stop.name}: shows an error screen`).toBe(false)
      })
    }

    if (visitor === 'admin') {
      for (const tab of ADMIN_TABS) {
        await test.step(`admin tab: ${tab}`, async () => {
          const before = { pageErrors: problems.pageErrors.length, failed: problems.failedRequests.length }
          await page.getByRole('button', { name: tab, exact: true }).first().click()
          await page.waitForLoadState('networkidle')
          await expect(page.getByRole('heading', { level: 1 })).toContainText(tab === 'Overview' ? /Overview|Admin/ : tab)
          expect.soft(problems.pageErrors.slice(before.pageErrors), `${tab}: script errors`).toEqual([])
          expect.soft(problems.failedRequests.slice(before.failed).filter((l) => !expected(l)), `${tab}: failed requests`).toEqual([])
        })
      }
    }

    // Every link found, asked for as this visitor
    const broken: string[] = []
    for (const [href, from] of links) {
      const reply = await call('GET', href, undefined, { cookie: who?.cookie ?? null })
      const ok = reply.status === 200 || ([307, 308].includes(reply.status) && !!reply.headers.get('location'))
      if (!ok) broken.push(`${reply.status} ${href} (linked from "${from}")`)
    }
    report.push({ visitor, linksChecked: links.size, broken })
    const dir = path.join(__dirname, '../../.reports'); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `crawl-${visitor.replace(' ', '-')}-${test.info().project.name}.json`), JSON.stringify(report, null, 1))
    expect(broken, 'links that lead nowhere').toEqual([])
    expect(links.size).toBeGreaterThan(5)
  })
}

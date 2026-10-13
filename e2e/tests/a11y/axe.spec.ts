import fs from 'fs'
import path from 'path'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { ADMIN_TABS, buildSite, type Visitor } from '../../lib/sitemap'

// An accessibility scan (axe, WCAG 2.1 A and AA) of every page as every kind
// of visitor. What it finds today is written down in a11y-baseline.json and
// listed in FINDINGS.md. The test fails on anything NEW, so the site cannot
// get worse without someone noticing. To accept a new baseline after fixing
// things: E2E_UPDATE_BASELINE=1 node e2e/run.mjs test tests/a11y --project=chromium
//
// axe finds perhaps a third of real accessibility problems. It does not
// replace trying the site with a screen reader.

const BASELINE = path.join(__dirname, '../../a11y-baseline.json')
const REPORTS = path.join(__dirname, '../../.reports')
type Found = { visitor: string; page: string; rule: string; impact: string; nodes: number; help: string; example: string; where: { target: string; html: string; fg?: string; bg?: string; ratio?: number; size?: string; weight?: string }[] }

/**
 * What a page looks like after the things people usually do on it. Each one is
 * scanned as its own stop ("search: filters open"). A page is scanned as it
 * loads first; these run after that, in order, on the same page.
 */
type State = { name: string; act: (page: Page) => Promise<unknown> }
const next = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true }).click()
const STATES: Record<string, State[]> = {
  search: [{ name: 'filters open', act: (page) => page.getByRole('button', { name: 'Filters' }).first().click() }],
  faq: [{ name: 'an answer open', act: (page) => page.locator('h3 button').first().click() }],
  listing: [{ name: 'calendar open', act: (page) => page.getByPlaceholder('Add date').first().click() }],
  checkout: [{ name: 'paying by card', act: (page) => page.getByRole('button', { name: 'Debit / Credit Card' }).click() }],
  payouts: [
    { name: 'adding a payout method', act: (page) => page.getByRole('button', { name: 'Add / Change' }).click() },
    { name: 'adding a bank account', act: (page) => page.getByRole('button', { name: 'Bank', exact: true }).click() },
  ],
  'new listing': [
    { name: 'told what is missing', act: next },
    { name: 'step 2, location', act: async (page) => { await page.getByLabel('Property Title').fill('E2E scan home'); await page.getByLabel('Property Type').selectOption({ index: 1 }); await next(page) } },
    { name: 'step 3, pricing', act: async (page) => { await page.getByLabel('Region').selectOption({ index: 1 }); await page.getByLabel('City / Town').fill('Accra'); await next(page) } },
    { name: 'step 3, short stay chosen', act: (page) => page.getByRole('button', { name: /Short Stay/ }).first().click() },
    { name: 'step 4, amenities and rules', act: async (page) => { await page.getByLabel('Price per Night (USD $)').fill('80'); await next(page) } },
    { name: 'step 5, photos', act: async (page) => { await next(page); await page.getByText(/photo/i).first().waitFor() } },
    { name: 'step 6, review', act: next },
  ],
}

for (const visitor of ['signed out', 'guest', 'host', 'admin'] as Visitor[]) {
  test(`accessibility scan as ${visitor}`, async ({ page, world, signIn }) => {
    test.setTimeout(300_000)
    const site = await buildSite(world)
    if (visitor !== 'signed out') await signIn(site[visitor])
    const found: Found[] = []
    const scan = async (name: string) => {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      for (const v of result.violations) found.push({ visitor, page: name, rule: v.id, impact: v.impact ?? 'unknown', nodes: v.nodes.length, help: v.help, example: v.nodes[0]?.html.slice(0, 160) ?? '', where: v.nodes.map((n) => { const d = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number; fontSize?: string; fontWeight?: string }; return { target: n.target.join(' '), html: n.html.slice(0, 220), ...(v.id === 'color-contrast' ? { fg: d.fgColor, bg: d.bgColor, ratio: d.contrastRatio, size: d.fontSize, weight: d.fontWeight } : {}) } }) })
    }
    for (const stop of site.pages[visitor]) {
      await test.step(stop.name, async () => {
        await page.goto(stop.path, { waitUntil: 'networkidle' })
        await scan(stop.name)
      })
      for (const state of STATES[stop.name] ?? []) {
        await test.step(`${stop.name}: ${state.name}`, async () => {
          // No fades, so a colour is measured as it ends up and not half way through a change
          await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }' })
          await state.act(page)
          await page.waitForLoadState('networkidle')
          await scan(`${stop.name}: ${state.name}`)
        })
      }
    }
    if (visitor === 'admin') {
      for (const tab of ADMIN_TABS.slice(1)) {
        await page.getByRole('button', { name: tab, exact: true }).first().click()
        await page.waitForLoadState('networkidle')
        await scan(`admin: ${tab}`)
      }
    }
    fs.mkdirSync(REPORTS, { recursive: true })
    fs.writeFileSync(path.join(REPORTS, `a11y-${visitor.replace(' ', '-')}.json`), JSON.stringify(found, null, 1))

    const key = (f: Found) => `${f.page} | ${f.rule}`
    const all: Record<string, string[]> = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {}
    if (process.env.E2E_UPDATE_BASELINE === '1') {
      all[visitor] = [...new Set(found.map(key))].sort()
      fs.writeFileSync(BASELINE, JSON.stringify(all, null, 1) + '\n')
      return
    }
    const known = new Set(all[visitor] ?? [])
    const fresh = found.filter((f) => !known.has(key(f)))
    expect(fresh.map((f) => `${f.impact}: ${f.page}: ${f.rule} (${f.help}) e.g. ${f.example}`), 'accessibility problems that are not in the baseline').toEqual([])
  })
}

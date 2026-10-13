import fs from 'fs'
import path from 'path'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test } from '../../lib/test'
import { ADMIN_TABS, buildSite, type Visitor } from '../../lib/sitemap'

// Not a test: the measurements and pictures behind e2e/CONTRAST-PROPOSAL.md.
// It changes nothing in the source. It opens every page, measures the text
// contrast, applies the proposed colours IN THE BROWSER ONLY, and measures
// again with the same scanner. Run it with:
//   E2E_CONTRAST_PROPOSAL=1 node e2e/run.mjs test tests/a11y/contrast-proposal.spec.ts --project=chromium --workers=1

const OUT = path.join(__dirname, '../../proposals/contrast')
const REPORT = path.join(__dirname, '../../.reports/contrast-proposal.json')

/** The proposal, as one stylesheet: the muted text token and the footer's small print. */
const TOKENS = `
  :root { --color-text-muted: #736D62 !important; }
  [style*="rgba(250, 247, 242, 0.4)"], [style*="rgba(250,247,242,0.4)"] { color: rgba(250, 247, 242, 0.5) !important; }
  /* So a colour is measured as it ends up, not half way through a fade */
  * { transition: none !important; }
`
/** Text in a brand or status colour on a light background: the darker shade of the same colour. */
// (#a6a09b is Tailwind's stone-400, used for small grey text: changed where it sits on a light background, not as a token,
// because the same class is used on dark surfaces too, where it must stay light)
const SWAP: Record<string, string> = { '#a6a09b': '#736D62', '#c9932e': '#8A5E10', '#059669': '#047857', '#e7000b': '#C10007', '#f2e4cb': '#1F1B16' }
/** Pages worth a picture: each shows a different part of the proposal. */
const PICTURES = new Set(['home', 'guest dashboard', 'checkout', 'host dashboard', 'payouts', 'admin: Users'])

type Node = { target: string; fg?: string; bg?: string; ratio?: number }
const failing = async (page: Page): Promise<Node[]> => {
  const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
  return result.violations.flatMap((v) => v.nodes.map((n) => {
    const d = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number }
    return { target: n.target.join(' '), fg: d.fgColor, bg: d.bgColor, ratio: d.contrastRatio }
  }))
}

for (const visitor of ['signed out', 'guest', 'host', 'admin'] as Visitor[]) {
  test(`contrast proposal, measured as ${visitor}`, async ({ page, world, signIn }) => {
    test.skip(process.env.E2E_CONTRAST_PROPOSAL !== '1', 'only when asked for: it writes pictures')
    test.setTimeout(600_000)
    fs.mkdirSync(OUT, { recursive: true })
    const site = await buildSite(world)
    if (visitor !== 'signed out') await signIn(site[visitor])
    const rows: { visitor: string; page: string; before: Node[]; after: Node[] }[] = []

    const measure = async (name: string) => {
      const file = (when: string) => path.join(OUT, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${when}.jpg`)
      const before = await failing(page)
      if (PICTURES.has(name)) await page.screenshot({ path: file('before'), fullPage: true, type: 'jpeg', quality: 72, scale: 'css' })
      await page.addStyleTag({ content: TOKENS })
      for (const node of before) {
        const to = SWAP[node.fg ?? '']
        if (to) await page.locator(node.target).first().evaluate((el, colour) => (el as HTMLElement).style.setProperty('color', colour, 'important'), to).catch(() => {})
      }
      const after = await failing(page)
      if (PICTURES.has(name)) await page.screenshot({ path: file('after'), fullPage: true, type: 'jpeg', quality: 72, scale: 'css' })
      rows.push({ visitor, page: name, before, after })
    }

    for (const stop of site.pages[visitor]) {
      await page.goto(stop.path, { waitUntil: 'networkidle' })
      await measure(stop.name)
    }
    if (visitor === 'admin') {
      for (const tab of ADMIN_TABS.slice(1)) {
        await page.goto('/admin', { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: tab, exact: true }).first().click()
        await page.waitForLoadState('networkidle')
        await measure(`admin: ${tab}`)
      }
    }
    const all = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : {}
    all[visitor] = rows
    fs.mkdirSync(path.dirname(REPORT), { recursive: true })
    fs.writeFileSync(REPORT, JSON.stringify(all, null, 1))
  })
}

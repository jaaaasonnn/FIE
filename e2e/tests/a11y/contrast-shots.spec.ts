import fs from 'fs'
import path from 'path'
import { test } from '../../lib/test'
import { buildSite, type Visitor } from '../../lib/sitemap'

// Not a test: full-page pictures of seven pages, for comparing the site before
// and after a change to its colours. Skipped unless asked for:
//   E2E_SHOTS=before node e2e/run.mjs test tests/a11y/contrast-shots.spec.ts --project=chromium --workers=1
// and the same with E2E_SHOTS=after once the change is built.

const OUT = path.join(__dirname, '../../proposals/contrast')
const WHEN = process.env.E2E_SHOTS
const PAGES: Record<Visitor, string[]> = {
  'signed out': ['home', 'listing'],
  guest: ['guest dashboard', 'checkout'],
  host: ['host dashboard', 'payouts'],
  admin: ['admin'],
}

for (const visitor of ['signed out', 'guest', 'host', 'admin'] as Visitor[]) {
  test(`pictures as ${visitor}`, async ({ page, world, signIn }) => {
    test.skip(WHEN !== 'before' && WHEN !== 'after', 'only when asked for: it writes pictures')
    fs.mkdirSync(OUT, { recursive: true })
    const site = await buildSite(world)
    if (visitor !== 'signed out') await signIn(site[visitor])
    for (const stop of site.pages[visitor].filter((s) => PAGES[visitor].includes(s.name))) {
      await page.goto(stop.path, { waitUntil: 'networkidle' })
      let name = stop.name
      if (visitor === 'admin') {
        await page.getByRole('button', { name: 'Users', exact: true }).first().click()
        await page.waitForLoadState('networkidle')
        name = 'admin users'
      }
      await page.screenshot({ path: path.join(OUT, `${name.replace(/ /g, '-')}-${WHEN}.jpg`), fullPage: true, type: 'jpeg', quality: 80, scale: 'css' })
    }
  })
}

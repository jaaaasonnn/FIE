import fs from 'fs'
import path from 'path'
import { test, expect } from '../lib/test'
import { db } from '../lib/db'

// G2 at volume: with the load set (5,000 homes) seeded, type each city in the search box, in lower case, and
// compare what the page finds with what the database holds.
//   E2E_PERF=1 node e2e/run.mjs test --project=perf load/search-text.spec.ts
const out = path.join(__dirname, '..', '.reports', 'fixperf')
fs.mkdirSync(out, { recursive: true })

test('the search box finds every home in the typed city among 5,000', async ({ page }) => {
  const live = await db.listing.count({ where: { id: { startsWith: 'load_' }, isActive: true, moderationHold: false } })
  test.skip(live < 5000, `the load set is not seeded (${live} live load homes)`)
  const rows: { city: string; inDatabase: number; pageSays: number; cards: number; ms: number }[] = []
  for (const city of ['Accra', 'Kumasi', 'Tamale', 'Bolgatanga']) {
    // What the page should count: every live home of a host who is not suspended, in that city, any case
    const inDatabase = await db.listing.count({
      where: { isActive: true, moderationHold: false, host: { suspendedAt: null }, OR: ['city', 'neighbourhood', 'region', 'title'].map((f) => ({ [f]: { contains: city, mode: 'insensitive' as const } })) },
    })
    await page.goto('/search')
    const box = page.getByRole('textbox', { name: 'Search by city or neighbourhood' }).first()
    await expect(box).toBeEditable()
    const started = Date.now()
    await box.fill(city.toLowerCase())
    const count = page.locator('p', { hasText: 'properties found' }).locator('strong').first()
    await expect(count).toHaveText(String(inDatabase), { timeout: 20_000 })
    const ms = Date.now() - started
    const cards = await page.locator('a[href^="/listings/"]').evaluateAll((as) => new Set(as.map((a) => a.getAttribute('href'))).size)
    rows.push({ city, inDatabase, pageSays: inDatabase, cards, ms })
    expect(cards, `${city}: a full first page of cards`).toBe(Math.min(50, inDatabase))
  }
  fs.writeFileSync(path.join(out, 'search-text.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1))
  console.log(JSON.stringify(rows))
})

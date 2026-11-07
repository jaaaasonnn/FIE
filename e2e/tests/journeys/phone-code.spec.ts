import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'

// App shell stage 3, AS8: a phone's own parts of the search page (src/app/search/phoneParts.tsx: the summary pill
// and chips, the phone card text, the phone's empty state) are drawn by the server for every width, and their
// code is fetched at a phone's width only (src/lib/phoneOnly.ts). On a wider screen React keeps them as the
// server drew them (hidden by CSS) and the code never comes. @core: every set-up, at its own width.

const isPhone = () => (test.info().project.use.viewport?.width ?? 1280) < 768
const PHOTOS = [1, 2, 3].map((i) => `https://images.unsplash.com/photo-150267226026${i}-1c1ef2d93688?w=1200&q=80`)
/** Found only in the phone's own code (phoneParts.tsx and what only it uses) */
const PHONE_CODE = 'No homes match all of that'
/** Console errors of the page's own code: a failed resource (a signed-out session check's 401, a photo) and the
 * report-only content policy's notes are left to the harness's own checks */
const codeErrors = (lines: string[]) => lines.filter((l) => !/^Failed to load resource|Content-Security-Policy|\[Report Only\]/.test(l))

/** Every script the page downloads, with whether it carries the phone's code */
function watchScripts(page: Page) {
  const scripts: { url: string; phone: boolean }[] = []
  page.on('response', async (r) => {
    if (r.request().resourceType() !== 'script') return
    const body = await r.text().catch(() => '')
    scripts.push({ url: r.url(), phone: body.includes(PHONE_CODE) })
  })
  return scripts
}

async function homesIn(world: Parameters<Parameters<typeof test>[2]>[0]['world'], n: number) {
  const host = await world.host()
  const city = `Pc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const homes = []
  for (let i = 0; i < n; i++) {
    const home = await world.listing(host, { city, priceNightly: 80 + i * 10 })
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS) } })
    homes.push(home)
  }
  return { city, homes }
}

test.describe('a phone\'s parts of the search page (AS8)', () => {
  test('React takes the page over with no error, before and after a filter change, and only a phone downloads the phone\'s code @core', async ({ page, world, problems }) => {
    const { city, homes } = await homesIn(world, 3)
    const scripts = watchScripts(page)
    await page.goto(`/search?q=${city}`)
    await expect(page.getByText(homes[0].title).filter({ visible: true }).first()).toBeVisible()
    await page.waitForLoadState('networkidle')

    // A filter changed and changed back: the list is drawn again, with the phone's parts in it
    if (isPhone()) {
      const chip = page.locator('.search-chips').getByRole('button', { name: 'Monthly' })
      await chip.click()
      await expect(chip).toHaveAttribute('aria-pressed', 'true')
      await chip.click()
      await expect(chip).toHaveAttribute('aria-pressed', 'false')
    } else {
      await page.getByRole('button', { name: 'Monthly', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Clear rental type: Monthly' })).toBeVisible()
      await page.getByRole('button', { name: 'All types', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Clear rental type: Monthly' })).toHaveCount(0)
    }
    await expect(page.getByText(homes[2].title).filter({ visible: true }).first()).toBeVisible()
    await page.waitForLoadState('networkidle')

    expect(problems.pageErrors, 'page errors').toEqual([])
    expect(codeErrors(problems.console), 'console errors (a hydration error is one)').toEqual([])
    const phoneScripts = scripts.filter((s) => s.phone).length
    if (isPhone()) {
      expect(phoneScripts, 'the phone\'s code, once').toBe(1)
      // The phone's card text, drawn by its own code after the change
      const text = page.locator('.search-card-text:not(.search-card-wait)').filter({ visible: true })
      await expect(text).toHaveCount(3)
      await expect(text.first().locator('.search-card-price')).toContainText('About GH₵')
    } else {
      expect(phoneScripts, 'a wider screen never downloads the phone\'s code').toBe(0)
      await expect(page.locator('.search-card-text').filter({ visible: true })).toHaveCount(0)
      await expect(page.locator('[data-search-pill]').filter({ visible: true })).toHaveCount(0)
    }
  })

  test('as the server drew it: the phone\'s pill, chips and card text are in the page before any script runs @core', async ({ browser, world }) => {
    const { city, homes } = await homesIn(world, 2)
    const project = test.info().project.use
    const context = await browser.newContext({ ...project, javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      await page.goto(`${project.baseURL ?? ''}/search?q=${city}`)
      // In the page itself, not sent after it and put in place by a script
      expect(await page.locator('body > div[hidden][id^="S:"]').count()).toBe(0)
      await expect(page.locator('[data-search-pill]')).toHaveCount(1)
      await expect(page.locator('.search-chips button')).toHaveCount(5)
      const titles = await page.locator('.search-card-text:not(.search-card-wait) .search-card-title').allTextContents()
      expect(titles.sort()).toEqual(homes.map((h) => h.title).sort())
      if (isPhone()) await expect(page.locator('[data-search-pill]')).toHaveText(city)
    } finally {
      await context.close()
    }
  })

  test('a desktop window narrowed to a phone\'s width gets the phone\'s search, after its code has come @core', async ({ page, world, problems }) => {
    test.skip(isPhone(), 'a wider screen\'s case')
    const { city, homes } = await homesIn(world, 2)
    const scripts = watchScripts(page)
    await page.goto(`/search?q=${city}`)
    await expect(page.getByText(homes[0].title).filter({ visible: true }).first()).toBeVisible()
    // A filter change first, so the phone's parts are placeholders, not the server's HTML
    await page.getByRole('button', { name: 'Short Stay', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Clear rental type: Short Stay' })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 800 })
    const chip = page.locator('.search-chips').getByRole('button', { name: 'Short Stay' })
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.search-card-text:not(.search-card-wait)').filter({ visible: true })).toHaveCount(2)
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(scripts.filter((s) => s.phone).length).toBe(1)
    expect(problems.pageErrors).toEqual([])
    expect(codeErrors(problems.console)).toEqual([])
  })
})

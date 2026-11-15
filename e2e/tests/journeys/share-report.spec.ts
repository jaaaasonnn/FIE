import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'

// The listing page's Share and Report (tester-fixes-1, item 4). Both buttons did nothing.
//  - Share: the phone's share sheet where the browser has one (navigator.share), otherwise the link is copied and
//    "Link copied" is shown. The address is the home's own, without the search or dates in the address bar.
//  - Report: a small dialog (a reason, an optional note) whose "Email support" opens an email to support with the
//    listing id, title and reason filled in. Its code is fetched on the first tap.
// Both are stubbed in the page (the share sheet and the clipboard are the browser's own), so every set-up runs it.

type Shared = { title?: string; url?: string }

/** The browser's share sheet, or none; and a clipboard that records what it was given */
async function stubSharing(page: Page, sheet: boolean) {
  await page.addInitScript((sheet) => {
    const w = window as unknown as { __shared: Shared[]; __copied: string[] }
    w.__shared = []
    w.__copied = []
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: sheet ? (data: Shared) => { w.__shared.push(data); return Promise.resolve() } : undefined })
    Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => ({ writeText: (t: string) => { w.__copied.push(t); return Promise.resolve() } }) })
  }, sheet)
}
const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared)
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)

async function press(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true })
  if (test.info().project.use.hasTouch) await button.tap()
  else await button.click()
}

async function openListing(page: Page, id: string) {
  // With a search in the address: what is shared is the home's own address
  await page.goto(`/listings/${id}?guests=2`)
  await expect(page.getByRole('button', { name: 'Share this home' })).toBeEnabled()
  await page.waitForLoadState('networkidle')
}

test.describe('Share and Report on a listing (tester-fixes-1)', () => {
  test('Share opens the phone\'s share sheet with the home\'s address @core', async ({ page, world }) => {
    const home = await world.listing(await world.host())
    await stubSharing(page, true)
    await openListing(page, home.id)
    await press(page, 'Share this home')
    await expect.poll(() => shared(page)).toHaveLength(1)
    const [data] = await shared(page)
    expect(data.title).toBe(home.title)
    expect(new URL(data.url!).pathname + new URL(data.url!).search).toBe(`/listings/${home.id}`)
    expect(await copied(page)).toEqual([])
  })

  test('without a share sheet, Share copies the link and says "Link copied" @core', async ({ page, world }) => {
    const home = await world.listing(await world.host())
    await stubSharing(page, false)
    await openListing(page, home.id)
    await press(page, 'Share this home')
    await expect(page.locator('#toast-root').getByText('Link copied', { exact: true })).toBeVisible()
    const [text] = await copied(page)
    expect(new URL(text).pathname + new URL(text).search).toBe(`/listings/${home.id}`)
  })

  test('Report opens a dialog: a reason, an optional note, and an email to support with the listing filled in @core', async ({ page, world }) => {
    const home = await world.listing(await world.host())
    await openListing(page, home.id)
    await press(page, 'Report this listing')
    const dialog = page.getByRole('dialog', { name: 'Report this listing' })
    await expect(dialog).toBeVisible()
    for (const reason of ['Wrong or misleading information', 'Not available or doesn\'t exist', 'Scam or suspicious', 'Something else']) {
      await expect(dialog.getByRole('radio', { name: reason })).toBeVisible()
    }
    // No email until a reason is chosen
    await expect(dialog.getByRole('button', { name: 'Email support' })).toBeDisabled()
    await expect(dialog.getByRole('link', { name: 'Email support' })).toHaveCount(0)
    await dialog.getByRole('radio', { name: 'Scam or suspicious' }).check()
    await dialog.getByLabel('Note (optional)').fill('Asked me to pay outside the app.')
    const href = await dialog.getByRole('link', { name: 'Email support' }).getAttribute('href')
    expect(href).toMatch(/^mailto:support@fiegh\.com\?/)
    const q = new URLSearchParams(href!.split('?')[1])
    expect(q.get('subject')).toBe(`Report: listing ${home.id}`)
    expect(q.get('body')).toContain(`Listing: ${home.title}`)
    expect(q.get('body')).toContain(`Listing id: ${home.id}`)
    expect(q.get('body')).toContain('Reason: Scam or suspicious')
    expect(q.get('body')).toContain('Asked me to pay outside the app.')
    // Accessible: no axe failures with it open, Escape closes it and the flag has the focus again
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Report this listing' })).toBeFocused()
  })

  test('the Report dialog\'s code is fetched on the first tap, not with the page @core', async ({ page, world }) => {
    const home = await world.listing(await world.host())
    const scripts: string[] = []
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()) })
    await openListing(page, home.id)
    const before = scripts.length
    // Not in the page as drawn: nothing with the dialog's words has arrived until the flag is reached for
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await press(page, 'Report this listing')
    await expect(page.getByRole('dialog', { name: 'Report this listing' })).toBeVisible()
    expect(scripts.length, 'one more script file, fetched on the tap').toBeGreaterThan(before)
  })
})

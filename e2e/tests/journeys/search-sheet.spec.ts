import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { openSheet, resultCount } from '../../pages'

// App shell, stage 2: the search sheet (src/components/search/SearchSheet.tsx, public/shell.js) and search on a
// phone (src/app/search/SearchClient.tsx). @core, so it runs in every set-up: on a phone the sheet opens from
// Explore's pill and the search page's summary pill, Back closes it, focus stays inside, it searches through
// /search (in place on the search page), and it works with no script at all; the cards are full width with
// their photos swiped sideways and the heart on them, and the map is a button above the bar. From 768 px up
// none of it is shown. E2E_SHEET_SHOTS=1 saves pictures to e2e/.reports/search-sheet.

const SHOTS = path.join(__dirname, '..', '..', '.reports', 'search-sheet')
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHEET_SHOTS) return
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-${name}.png`) })
}
const isPhone = () => (test.info().project.use.viewport?.width ?? 1280) < 768
const phonesOnly = () => test.skip(!isPhone(), 'the sheet and these cards are the phone\'s')
const PHOTOS = (n: string) => [1, 2, 3].map((i) => `https://images.unsplash.com/photo-15026722602${i}${n}-1c1ef2d93688?w=1200&q=80`)
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const short = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`

/** Marks the page, so a test can tell the page was kept (no new page was loaded) */
const mark = (page: Page) => page.evaluate(() => { (window as unknown as { __kept: boolean }).__kept = true })
const kept = (page: Page) => page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept === true)

test.describe('the search sheet', () => {
  test('desktop: no sheet, no summary pill, no hearts on the cards, the search bar as it was @core', async ({ page, world }) => {
    test.skip(isPhone(), 'the desktop\'s case')
    const host = await world.host()
    const city = `De${Date.now().toString(36)}`
    const home = await world.listing(host, { city })
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS('3')) } })
    await page.goto(`/search?q=${city}`)
    await expect(page.locator(`a[href^="/listings/${home.id}"]`).first()).toBeVisible()
    // The cards' hearts are a phone's (the stylesheet's display once won over md:hidden)
    await expect(page.locator('.heart-button').filter({ visible: true })).toHaveCount(0)
    await expect(page.locator('.search-card-count').filter({ visible: true })).toHaveCount(0)
    await expect(page.getByPlaceholder('Search by city, neighbourhood...')).toBeVisible()
    await expect(page.locator('[data-search-pill]:visible')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Search homes' })).toBeHidden()
  })

  test('from Explore: opens, keeps focus inside, Escape and Back close it without leaving the page @core', async ({ page }) => {
    phonesOnly()
    await page.goto('/')
    await mark(page)
    let sheet = await openSheet(page)
    await expect(page).toHaveURL(/#search-sheet$/)
    // Focus is in the sheet, and Tab keeps it there
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-search-sheet]')), `Tab ${i + 1}`).toBe(true)
    }
    // The page behind is inert
    expect(await page.locator('[data-bottom-bar]').evaluate((el) => !!el.closest('[inert]'))).toBe(true)
    await shot(page, 'sheet-open')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/$/)
    expect(await page.locator('[data-bottom-bar]').evaluate((el) => !!el.closest('[inert]'))).toBe(false)

    sheet = await openSheet(page)
    await page.goBack()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/$/)
    expect(await kept(page), 'Back closed the sheet on the same page').toBe(true)
    // and the cross
    sheet = await openSheet(page)
    await sheet.getByRole('link', { name: 'Close search' }).click()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/$/)
  })

  test('from Explore: searches through /search, leaving out what does not apply @core', async ({ page, world }) => {
    phonesOnly()
    const host = await world.host()
    const city = `Ho${Date.now().toString(36)}`
    await world.listing(host, { city, region: 'Volta' })
    await page.goto('/')
    const sheet = await openSheet(page)
    await sheet.getByRole('combobox', { name: 'Where' }).fill(city)
    await sheet.getByRole('radio', { name: 'Short Stay' }).check()
    const [checkIn, checkOut] = [day(20), day(22)]
    await sheet.locator('input[name="checkIn"]').fill(checkIn)
    await sheet.locator('input[name="checkOut"]').fill(checkOut)
    await expect(sheet.locator('.sheet-checkout .date-field-face')).not.toHaveText('Add date')
    await sheet.getByRole('button', { name: 'More guests' }).click()
    await sheet.getByRole('button', { name: 'More guests' }).click()
    await expect(sheet.getByRole('spinbutton', { name: 'Guests' })).toHaveValue('2')
    await shot(page, 'sheet-filled')
    await sheet.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(`/search?q=${city}&mode=SHORT_STAY&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`)
    const from = checkIn.slice(0, 7) === checkOut.slice(0, 7) ? String(Number(checkIn.slice(8, 10))) : short(checkIn)
    await expect(page.locator('[data-search-pill]:visible')).toHaveText(`${city} · ${from} to ${short(checkOut)} · 2 guests`)
    await expect(resultCount(page, 1)).toBeVisible()
  })

  test('a monthly stay asks for months, not a check-out; a long-term one for a move-in day only @core', async ({ page }) => {
    phonesOnly()
    await page.goto('/')
    const sheet = await openSheet(page)
    await sheet.getByRole('radio', { name: 'Monthly' }).check()
    await expect(sheet.getByText('Move-in', { exact: true })).toBeVisible()
    await expect(sheet.locator('input[name="checkOut"]')).toBeHidden()
    await expect(sheet.getByRole('combobox', { name: 'Months' })).toBeVisible()
    await sheet.getByRole('radio', { name: 'Long-Term' }).check()
    await expect(sheet.getByRole('combobox', { name: 'Months' })).toBeHidden()
    await expect(sheet.getByText('Checks one year from this date.')).toBeVisible()
    await sheet.locator('input[name="checkIn"]').fill(day(30))
    // A check-out typed earlier is not sent for a long-term search
    await sheet.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(`/search?mode=PERMANENT&checkIn=${day(30)}`)
  })

  test('on the search page: the summary pill opens the sheet with the search shown, and Search changes it in place @core', async ({ page, world }) => {
    phonesOnly()
    const host = await world.host()
    const [a, b] = [`Ke${Date.now().toString(36)}`, `Ta${Date.now().toString(36)}`]
    await world.listing(host, { city: a })
    await world.listing(host, { city: b })
    await page.goto(`/search?q=${a}`)
    await expect(page.locator('[data-search-pill]:visible')).toHaveText(a)
    await expect(resultCount(page, 1)).toBeVisible()
    await mark(page)
    const sheet = await openSheet(page)
    await expect(sheet.getByRole('combobox', { name: 'Where' })).toHaveValue(a)
    await sheet.getByRole('combobox', { name: 'Where' }).fill(b)
    await sheet.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator('[data-search-pill]:visible')).toHaveText(b)
    await expect(page).toHaveURL(`/search?q=${b}`)
    expect(await kept(page), 'the search changed in place').toBe(true)
    await expect(resultCount(page, 1)).toBeVisible()
  })

  test('with no script: the pill opens the sheet and its form searches through /search @core', async ({ browser, world }) => {
    phonesOnly()
    const host = await world.host()
    const city = `Wa${Date.now().toString(36)}`
    const home = await world.listing(host, { city })
    const project = test.info().project.use
    const context = await browser.newContext({ ...project, javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      await page.goto(`${project.baseURL ?? ''}/`)
      await page.locator('[data-search-pill]:visible').first().click()
      const sheet = page.getByRole('dialog', { name: 'Search homes' })
      await expect(sheet).toBeVisible()
      await sheet.getByRole('combobox', { name: 'Where' }).fill(city)
      await sheet.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/search\\?mode=&q=${city}`))
      await expect(page.locator(`a[href^="/listings/${home.id}"]`).first()).toBeAttached()
      await expect(page.locator('[data-search-pill]:visible')).toHaveText(city)
    } finally {
      await context.close()
    }
  })
})

test.describe('search on a phone', () => {
  test('full-width cards: photos swiped sideways with a count, lines of a fixed height, the stay price for the dates @core', async ({ page, world }) => {
    phonesOnly()
    const host = await world.host()
    const city = `Bo${Date.now().toString(36)}`
    const home = await world.listing(host, { city, priceNightly: 80 })
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS('1')) } })
    const [checkIn, checkOut] = [day(20), day(23)]
    await page.goto(`/search?q=${city}&checkIn=${checkIn}&checkOut=${checkOut}`)
    const card = page.locator('.search-card').filter({ has: page.locator(`a[href^="/listings/${home.id}"]`) })
    const width = page.viewportSize()!.width
    const box = await card.boundingBox()
    expect(Math.round(box!.width)).toBe(width - 32)
    await expect(card.locator('.search-card-count')).toHaveText('1 / 3')
    await card.locator('.search-card-strip').evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: 'instant' }))
    await expect(card.locator('.search-card-count')).toHaveText('2 / 3')
    await expect(card.locator('.search-card-price')).toContainText('/night · $80')
    await expect(card.locator('.search-card-stay')).toContainText('for 3 nights · $240')
    for (const line of await card.locator('.search-card-line').all()) expect(Math.round((await line.boundingBox())!.height)).toBe(20)
    await shot(page, 'search-cards')
  })

  test('the heart on a card saves the home; the map is a button above the bar @core', async ({ page, world, signIn }) => {
    phonesOnly()
    const host = await world.host()
    const guest = await world.guest()
    const city = `Ga${Date.now().toString(36)}`
    const home = await world.listing(host, { city })
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS('2')) } })
    await signIn(guest)
    await page.goto(`/search?q=${city}`)
    const heart = page.locator(`[data-heart="${home.id}"]`)
    await expect(heart).toBeEnabled()
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => db.wishlist.count({ where: { userId: guest.id, listingId: home.id } })).toBe(1)
    // The map button floats above the bar, never under it
    const map = await page.getByRole('button', { name: 'Map', exact: true }).boundingBox()
    const bar = await page.locator('[data-bottom-bar]').boundingBox()
    expect(map!.y + map!.height).toBeLessThanOrEqual(bar!.y)
  })

  test('the chips change the search: a rental type, and FieGH\'s check @core', async ({ page }) => {
    phonesOnly()
    await page.goto('/search')
    const chips = page.getByRole('group', { name: 'Filters' })
    await chips.getByRole('button', { name: 'Monthly' }).click()
    await expect(chips.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    // The count only on a phone; the chip under it says what the search is filtered by
    await expect(page.getByRole('button', { name: 'Clear rental type: Monthly' })).toBeVisible()
    await expect(page.getByText(/^\d+ homes?$/).filter({ visible: true })).toHaveCount(1)
    await expect(page.getByText(/available .* nights|found ·/).filter({ visible: true })).toHaveCount(0)
    await chips.getByRole('button', { name: 'Checked homes' }).click()
    await expect(chips.getByRole('button', { name: 'Checked homes' })).toHaveAttribute('aria-pressed', 'true')
    await chips.getByRole('button', { name: 'Filters' }).click()
    await expect(page.getByRole('checkbox', { name: 'Address and photos checked by FieGH' })).toBeChecked()
  })
})

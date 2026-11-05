// Page objects: one place that knows how each page is driven, so a change to
// a page is fixed here and not in every test.
import { expect, type Locator, type Page } from '@playwright/test'

export class AuthPage {
  constructor(private page: Page) {}
  async gotoLogin(query = '') { await this.page.goto(`/login${query}`) }
  async gotoSignUp(query = '') { await this.page.goto(`/login?tab=signup${query}`) }
  async logIn(identifier: string, password: string) {
    await this.page.getByPlaceholder('you@example.com or 0241234567').fill(identifier)
    await this.page.getByPlaceholder('Your password').fill(password)
    await this.submit('Log in').click()
  }
  async signUp(o: { name: string; email: string; password: string; host?: boolean }) {
    if (o.host) await this.page.getByRole('button', { name: /List my place/ }).click()
    await this.page.getByPlaceholder('Kwame Mensah').fill(o.name)
    await this.page.getByPlaceholder('you@example.com', { exact: true }).fill(o.email)
    await this.page.getByPlaceholder('At least 8 characters').fill(o.password)
    await this.page.getByPlaceholder('Repeat password').fill(o.password)
    await this.submit('Create account').click()
  }
  /** The form's own button, not the tab of the same name above it. */
  submit(name: string): Locator { return this.page.locator('form').getByRole('button', { name, exact: true }) }
  error(): Locator { return this.page.getByRole('alert').or(this.page.locator('[data-error], .text-red-600, .text-red-700')).first() }
}

export class Header {
  constructor(private page: Page) {}
  async openMenu() { await this.page.getByRole('button', { name: 'Open menu' }).click() }
  async signOut() {
    await this.openMenu()
    await this.page.getByRole('button', { name: /log ?out|sign ?out/i }).or(this.page.getByRole('menuitem', { name: /log ?out|sign ?out/i })).first().click()
  }
}

/** Picks a day in the date picker that is open, moving forward a month at a time until it is there. */
export async function pickDay(page: Page, isoDate: string) {
  const [year, month, dayOfMonth] = isoDate.split('-').map(Number)
  const wanted = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const heading = page.locator('.react-datepicker__current-month').first()
  await expect(heading).toBeVisible()
  for (let i = 0; i < 24 && !(await heading.innerText()).includes(wanted); i++) await page.getByRole('button', { name: 'Next Month' }).click()
  await expect(heading).toContainText(wanted)
  await page.locator(`.react-datepicker__day--0${String(dayOfMonth).padStart(2, '0')}:not(.react-datepicker__day--outside-month)`).first().click()
}

export class ListingPage {
  constructor(private page: Page) {}
  async goto(id: string) { await this.page.goto(`/listings/${id}`) }
  async chooseDates(checkIn: string, checkOut: string) {
    await this.page.getByPlaceholder('Add date').first().click()
    await pickDay(this.page, checkIn)
    if (!(await this.page.locator('.react-datepicker').first().isVisible())) await this.page.getByPlaceholder('Add date').nth(1).click()
    await pickDay(this.page, checkOut)
  }
  bookButton(): Locator { return this.page.getByRole('button', { name: /^(Instant Book|Request to Book|Reserve)/ }).last() }
}

export class CheckoutPage {
  constructor(private page: Page) {}
  async goto(bookingId: string, query = '') { await this.page.goto(`/checkout/${bookingId}${query}`) }
  payButton(): Locator { return this.page.getByRole('button', { name: /^Pay .* Securely/ }) }
  async chooseCard() { await this.page.getByRole('button', { name: 'Debit / Credit Card' }).click() }
  async chooseMomo(number = '0241234567') {
    await this.page.getByRole('button', { name: 'Mobile Money', exact: true }).click()
    await this.page.getByRole('button', { name: 'MTN Mobile Money' }).click()
    await this.page.getByPlaceholder('0241 234 567').fill(number)
  }
}

/** The fake Paystack page the guest is sent to. */
export class FakePaystack {
  constructor(private page: Page) {}
  async expectOpen() { await expect(this.page.getByRole('heading', { name: 'Fake Paystack checkout' })).toBeVisible() }
  amount(): Locator { return this.page.getByTestId('amount') }
  reference(): Locator { return this.page.getByTestId('reference') }
  async pay() { await this.page.getByRole('button', { name: 'Pay now' }).click() }
  async decline() { await this.page.getByRole('button', { name: 'Card declined' }).click() }
  async close() { await this.page.getByRole('button', { name: 'Close without paying' }).click() }
}

/**
 * Searches for words on the search page, as a person would at this screen size: from 768 px up in the search
 * box; on a phone through the search sheet (app shell, stage 2: the summary pill opens it, Search changes the
 * search in place).
 */
export async function searchFor(page: Page, words: string) {
  const phone = (page.viewportSize()?.width ?? 1280) < 768
  if (!phone) {
    await page.getByPlaceholder('Search by city, neighbourhood...').fill(words)
    await page.keyboard.press('Enter')
    return
  }
  const sheet = await openSheet(page)
  await sheet.getByRole('combobox', { name: 'Where' }).fill(words)
  await sheet.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(sheet).toBeHidden()
}

/** Opens the phone's search sheet from the page's pill, once the page is running; gives back the sheet */
export async function openSheet(page: Page): Promise<Locator> {
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-sheet-ready'))
  await page.locator('[data-search-pill]:visible').first().click()
  const sheet = page.getByRole('dialog', { name: 'Search homes' })
  await expect(sheet).toBeVisible()
  // It slides up: measure it once it has arrived
  await page.waitForFunction(() => (document.querySelector('[data-search-sheet] .search-sheet-panel')?.getAnimations() ?? []).every((a) => a.playState !== 'running'))
  return sheet
}

/**
 * The search page's count of results, as this screen size writes it: "6 homes" on a phone (app shell, stage 2),
 * "6 properties found" from 768 px up.
 */
export function resultCount(page: Page, n: number): Locator {
  const phone = (page.viewportSize()?.width ?? 1280) < 768
  const words = phone ? `${n} ${n === 1 ? 'home' : 'homes'}` : `${n} ${n === 1 ? 'property' : 'properties'} found`
  return page.getByText(new RegExp(`^${words}`)).filter({ visible: true }).first()
}

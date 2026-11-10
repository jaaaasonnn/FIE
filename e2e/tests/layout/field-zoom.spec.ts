import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { openSheet } from '../../pages/index'

// iOS Safari (and the installed app) zooms the page in when a field whose text is under 16 px takes focus, and
// leaves it zoomed: the person has to pinch back out. Found on a real iPhone 17 Pro on the listing page's dates.
// So at phone widths every field a person can focus (inputs of every typing kind, date and search included,
// selects, textareas, the date picker's field) has a computed font size of at least 16 px, on the main pages
// signed out, as a guest, as a host and as an admin, and in the states that bring fields up: the search sheet,
// the listing's date picker opened, Mobile Money at checkout, a conversation open, every admin tab.
// The fix is one phone-only rule in globals.css; the viewport keeps pinch-zoom (no maximum-scale).
// @core: it sets its own widths, so it runs in the Chromium, iPhone and Android set-ups.

const WIDTHS = [320, 390, 430]
const MIN_PX = 16
const onlyIn = () => test.skip(!['chromium', 'iphone', 'android'].includes(test.info().project.name), 'widths are set by the test; three set-ups are enough')

/** Every field on the page a person could focus and type or pick in, with its font size, if under 16 px */
async function small(page: Page, where: string): Promise<string[]> {
  return page.evaluate(([where, min]) => {
    const FIELD = 'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="hidden"], [type="submit"], [type="button"], [type="reset"], [type="image"], [type="color"])'
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FIELD))) {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      // A field a person can reach: drawn and taking room (a see-through date field still takes the tap)
      if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) continue
      if (el.closest('[hidden], [inert], [aria-hidden="true"]')) continue
      const px = parseFloat(s.fontSize)
      if (px >= min) continue
      const name = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || ''
      const type = el.tagName === 'INPUT' ? `[type=${(el as HTMLInputElement).type}]` : ''
      out.push(`${where}: ${el.tagName.toLowerCase()}${type} "${name}" ${px}px`)
    }
    return out
  }, [where, MIN_PX] as const)
}

async function visit(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(500)
}

async function eachWidth(page: Page, run: (width: number) => Promise<void>) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    await run(width)
  }
}

test.describe('phone fields: 16 px or larger, so iOS never zooms in on focus', () => {
  test('signed out: home, search and its sheet, a listing with its date picker open, sign-in and sign-up @core', async ({ page, world }) => {
    onlyIn()
    test.setTimeout(240_000)
    const host = await world.host()
    const home = await world.listing(host)
    const found: string[] = []
    await eachWidth(page, async (w) => {
      for (const url of ['/', '/search?q=Accra', '/login', '/auth/signin', '/auth/signup', '/auth/forgot-password', '/how-it-works']) {
        await visit(page, url)
        found.push(...await small(page, `${w}px ${url}`))
      }
      await visit(page, '/search?q=Accra')
      await openSheet(page)
      found.push(...await small(page, `${w}px search sheet`))

      await visit(page, `/listings/${home.id}`)
      found.push(...await small(page, `${w}px listing`))
      // The date picker takes the field's place once opened: its own field is measured too
      await page.getByPlaceholder('Add date').first().click()
      await expect(page.locator('.react-datepicker').first()).toBeVisible()
      found.push(...await small(page, `${w}px listing, date picker open`))
    })
    expect(found).toEqual([])
  })

  test('a guest: checkout with Mobile Money, a conversation, profile, a booking and its problem form, ID upload @core', async ({ page, world, signIn }) => {
    onlyIn()
    test.setTimeout(240_000)
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome, the key is with the caretaker', bookingId })).status).toBe(201)
    await signIn(guest)
    const found: string[] = []
    await eachWidth(page, async (w) => {
      for (const url of [`/listings/${home.id}`, '/account', '/profile/edit', `/bookings/${bookingId}`, `/bookings/${bookingId}/problem`, '/auth/verify-id', '/dashboard/guest', '/dashboard/guest/payments']) {
        await visit(page, url)
        found.push(...await small(page, `${w}px ${url}`))
      }
      await visit(page, `/checkout/${bookingId}`)
      await page.getByRole('button', { name: 'Mobile Money', exact: true }).click()
      await page.getByRole('button', { name: 'MTN Mobile Money' }).click()
      await expect(page.getByPlaceholder('0241 234 567')).toBeVisible()
      found.push(...await small(page, `${w}px checkout, Mobile Money`))

      await visit(page, '/dashboard/guest/messages')
      found.push(...await small(page, `${w}px guest inbox`))
      await page.getByText(host.name).first().click()
      await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
      found.push(...await small(page, `${w}px conversation open`))
    })
    expect(found).toEqual([])
  })

  test('a host: new listing, edit, calendar, payouts, bookings, inbox @core', async ({ page, world, signIn }) => {
    onlyIn()
    test.setTimeout(240_000)
    const host = await world.host({ payoutMethod: false })
    const home = await world.listing(host)
    await signIn(host)
    const found: string[] = []
    await eachWidth(page, async (w) => {
      for (const url of ['/dashboard/host', '/dashboard/host/listings/new', `/dashboard/host/listings/${home.id}/edit`, `/dashboard/host/listings/${home.id}/calendar`, '/dashboard/host/payouts', '/dashboard/host/bookings', '/dashboard/host/messages']) {
        await visit(page, url)
        found.push(...await small(page, `${w}px ${url}`))
      }
    })
    expect(found).toEqual([])
  })

  test('an admin: every tab @core', async ({ page, world, signIn }) => {
    onlyIn()
    test.setTimeout(240_000)
    const admin = await world.admin()
    await signIn(admin)
    const found: string[] = []
    await eachWidth(page, async (w) => {
      await visit(page, '/admin')
      for (const tab of ['Overview', 'Users', 'Listings', 'Bookings', 'Payments', 'Verifications', 'Listing checks', 'Disputes', 'Rent', 'Messages', 'Reviews', 'Settings']) {
        await page.locator('button:visible', { hasText: new RegExp(`^${tab}$`) }).last().click()
        await page.waitForTimeout(400)
        found.push(...await small(page, `${w}px admin ${tab}`))
      }
    })
    expect(found).toEqual([])
  })
})

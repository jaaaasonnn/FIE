import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { call } from '../../lib/world'
import { CheckoutPage } from '../../pages'

// No usable dollar-to-cedi rate (polish-1): no stored rate, and INITIAL_USD_TO_GHS is placeholder text in
// e2e/env.e2e, as it was on the preview, where pages showed "GH₵ NaN". Every page that shows a price then shows
// dollars only, with no cedi line and never "NaN", and checkout refuses to start a payment: nothing is written and
// Paystack is not asked. In the chaos project because it empties the ExchangeRate table, which every other test
// reads; it puts the rows back however it ends.

const PHOTOS = ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80']
const NO_RATE_TO_CHARGE = 'Payments are paused for a moment: we cannot work out the amount in cedis right now. You have not been charged. Please try again later.'

/** All the page's words, hidden copies included (the phone and desktop copies of a card), scripts left out */
const words = (page: Page) => page.evaluate(() => {
  const copy = document.body.cloneNode(true) as HTMLElement
  copy.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove())
  return copy.textContent ?? ''
})

/** Until the page's own rate answer has come: no cedis and no NaN anywhere, and a dollar price on screen */
async function dollarsOnly(page: Page, what: string) {
  await expect.poll(async () => { const t = await words(page); return /GH₵|\bGHS\b|NaN|cedis at today/.test(t) ? t.match(/.{0,40}(GH₵|\bGHS\b|NaN|cedis at today).{0,40}/)![0] : 'clean' }, { message: what, timeout: 15_000 }).toBe('clean')
  await expect(page.getByText(/\$\d/).filter({ visible: true }).first(), what).toBeVisible()
}

const shownRates = async () => Promise.all([0, 1].map(async (server) => (await call('GET', '/api/exchange-rate', undefined, { server: server as 0 | 1 })).json?.rate))

test.describe('no usable exchange rate', () => {
  test('every page shows dollars only, never NaN, and checkout refuses to start a payment', async ({ page, world, signIn }) => {
    test.setTimeout(300_000)
    const host = await world.host()
    const guest = await world.guest()
    const admin = await world.admin()
    const home = await world.listing(host)
    await db.listing.update({ where: { id: home.id }, data: { photos: JSON.stringify(PHOTOS), isFeatured: true, avgRating: 3_000 } })
    const bookingId = await world.mustBook(guest, home.id)
    expect((await guest.call('POST', '/api/wishlists', { userId: guest.id, listingId: home.id })).status).toBeLessThan(300)
    const saved = await db.exchangeRate.findMany()
    expect(saved.length).toBeGreaterThan(0)

    try {
      await db.exchangeRate.deleteMany()
      // Each server keeps the rate guests are shown for 30 s (lib/shortCache.ts)
      await expect.poll(shownRates, { timeout: 45_000, intervals: [2000] }).toEqual([null, null])
      // The home page is kept and drawn again after a change to a home (or each minute)
      expect((await host.call('PATCH', `/api/listings/${home.id}`, { title: home.title })).status).toBe(200)

      // The server refuses to start a payment, before anything is written or sent
      const refused = await world.startPayment(guest, bookingId)
      expect(refused.status).toBe(503)
      expect(refused.json).toEqual({ error: NO_RATE_TO_CHARGE, code: 'NO_EXCHANGE_RATE' })

      await signIn(guest)
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        // Explore and the desktop home page: drawn on the server, kept for a minute
        await expect.poll(async () => { await page.goto('/'); return /GH₵|NaN/.test(await words(page)) }, { timeout: 90_000, intervals: [3000] }).toBe(false)
        await dollarsOnly(page, `home at ${width}`)
        for (const url of ['/search', `/search?q=${encodeURIComponent(home.title.split(' ').pop()!)}`, `/listings/${home.id}`, `/checkout/${bookingId}`, '/dashboard/guest', '/dashboard/guest/payments', '/dashboard/guest/wishlist', `/bookings/${bookingId}`]) {
          await page.goto(url)
          await dollarsOnly(page, `${url} at ${width}`)
        }
      }

      // Checkout: pressing Pay is refused with the reason, and nothing reaches Paystack or the database
      const checkout = new CheckoutPage(page)
      await checkout.goto(bookingId)
      await checkout.chooseCard()
      await checkout.payButton().click()
      await expect(page.getByText(NO_RATE_TO_CHARGE)).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`/checkout/${bookingId}`))
      expect(await fakes.tx(bookingId)).toHaveLength(0)
      expect(await db.payment.count({ where: { bookingId } })).toBe(0)

      // The admin page says no rate is set, rather than showing one
      await page.context().clearCookies()
      await signIn(admin)
      await page.goto('/admin')
      await expect(page.getByText('Not set', { exact: true })).toBeVisible()
      expect(await words(page)).not.toMatch(/NaN/)
    } finally {
      await db.exchangeRate.deleteMany()
      await db.exchangeRate.createMany({ data: saved })
    }

    // Back as it was before the next test: both servers show the rate again, and the home page has cedis again
    await expect.poll(async () => (await shownRates()).every((r) => typeof r === 'number' && r > 0), { timeout: 45_000, intervals: [2000] }).toBe(true)
    expect((await host.call('PATCH', `/api/listings/${home.id}`, { title: home.title })).status).toBe(200)
    await page.setViewportSize({ width: 390, height: 900 })
    await expect.poll(async () => { await page.goto('/'); return (await words(page)).includes('GH₵') }, { timeout: 90_000, intervals: [3000] }).toBe(true)
  })
})

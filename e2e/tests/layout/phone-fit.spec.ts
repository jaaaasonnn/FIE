import { test, expect } from '../../lib/test'
import { audit, type Problem } from '../../lib/phoneFit'
import { withPhotos } from '../../lib/photos'

// App shell, stage 1 polish: at phone widths (320, 360, 390, 430 px) on the main pages, signed out and signed in:
//  - no text runs outside its own box (an element whose content is wider than it, scrollWidth > clientWidth),
//    and nothing makes the page scroll sideways;
//  - pills, chips and badges stay on one line (never wrap mid-label);
//  - no text smaller than 12 px, except the bottom bar's tab labels;
//  - buttons, pills, fields and the bar's tabs are at least 44 px tall (a link inside a sentence is not a
//    target of its own).
// Groups that scroll sideways on purpose (overflow-x auto) are allowed to be wider than their box; what is in
// them is still checked. @core: it sets its own widths, so it runs in the Chromium, iPhone and Android set-ups.

const WIDTHS = [320, 360, 390, 430]
const onlyIn = () => test.skip(!['chromium', 'iphone', 'android'].includes(test.info().project.name), 'widths are set by the test; three set-ups are enough')

async function pages(world: import('../../lib/world').World) {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  // Six photos: the listing page is checked with its gallery and slider (tester-fixes-2)
  await withPhotos(home.id)
  const bookingId = await world.mustBook(guest, home.id)
  expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome, the key is with the caretaker', bookingId })).status).toBe(201)
  return { guest, listingId: home.id }
}

test.describe('phone layout: everything fits (app shell, stage 1 polish)', () => {
  test('signed out: no text outside its box, pills on one line, no sideways scrolling, readable sizes, 44 px targets @core', async ({ page, world }) => {
    onlyIn()
    test.setTimeout(180_000)
    const { listingId } = await pages(world)
    const found: Problem[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      for (const url of ['/', '/search?q=Accra', `/listings/${listingId}`, '/how-it-works']) {
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForTimeout(800)
        found.push(...await audit(page, `${width}px ${url}`))
      }
    }
    expect(found).toEqual([])
  })

  test('signed in: no text outside its box, pills on one line, no sideways scrolling, readable sizes, 44 px targets @core', async ({ page, world, signIn }) => {
    onlyIn()
    test.setTimeout(240_000)
    const { guest, listingId } = await pages(world)
    await signIn(guest)
    const found: Problem[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      for (const url of ['/', '/search?q=Accra', `/listings/${listingId}`, '/dashboard/guest', '/dashboard/guest/wishlist', '/dashboard/guest/messages', '/account', '/how-it-works']) {
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForTimeout(800)
        found.push(...await audit(page, `${width}px ${url}`))
      }
    }
    expect(found).toEqual([])
  })

  // Every host page (tester-fixes-1, item 3: the edit page and the dashboard were wider than a phone and nothing
  // caught it), at the same widths and 375 px, with content on each: a booking, a message, a listing.
  const HOST_WIDTHS = [320, 360, 375, 390, 430]
  async function hostWithWork(world: import('../../lib/world').World) {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await guest.call('POST', '/api/messages', { receiverId: host.id, content: 'Hello, is there parking near the house for one car?', bookingId })).status).toBe(201)
    return { host, home }
  }

  test('host pages: dashboard, bookings, payouts, inbox, edit and calendar fit at every phone width @core', async ({ page, world, signIn }) => {
    onlyIn()
    test.setTimeout(240_000)
    const { host, home } = await hostWithWork(world)
    await signIn(host)
    const found: Problem[] = []
    for (const width of HOST_WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      for (const url of ['/dashboard/host', '/dashboard/host/bookings', '/dashboard/host/payouts', '/dashboard/host/messages', `/dashboard/host/listings/${home.id}/edit`, `/dashboard/host/listings/${home.id}/calendar`]) {
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForTimeout(1000)
        found.push(...await audit(page, `${width}px ${url.replace(home.id, ':id')}`))
      }
    }
    expect(found).toEqual([])
  })

  test('host pages: every step of a new listing fits at every phone width @core', async ({ page, world, signIn }) => {
    onlyIn()
    test.setTimeout(240_000)
    const host = await world.host()
    await signIn(host)
    const found: Problem[] = []
    const next = async () => { await page.getByRole('button', { name: /continue/i }).click(); await page.waitForTimeout(800) }
    for (const width of HOST_WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/dashboard/host/listings/new', { waitUntil: 'load' })
      const title = page.getByPlaceholder('e.g. Modern 3-Bedroom Apartment in East Legon')
      await expect(title).toBeEnabled()
      await page.waitForTimeout(500)
      found.push(...await audit(page, `${width}px new listing, step 1`))
      await title.fill(`Phone fit home ${width}`)
      await page.locator('select').first().selectOption({ index: 1 })
      await next()
      found.push(...await audit(page, `${width}px new listing, step 2`))
      await page.locator('select').first().selectOption({ index: 1 })
      await page.getByPlaceholder('e.g. Accra, Kumasi, Takoradi').fill('Accra')
      await next()
      await page.getByRole('button', { name: /Short Stay/i }).first().click()
      await page.getByPlaceholder('e.g. 80').fill('80')
      found.push(...await audit(page, `${width}px new listing, step 3`))
      await next()
      found.push(...await audit(page, `${width}px new listing, step 4`))
      // Leaving step 4 creates the listing (the photos step needs it)
      await next()
      await expect(page.getByText(/Step 5/)).toBeVisible()
      found.push(...await audit(page, `${width}px new listing, step 5`))
      await next()
      await expect(page.getByText(/Step 6/)).toBeVisible()
      found.push(...await audit(page, `${width}px new listing, step 6`))
    }
    expect(found).toEqual([])
  })

  test('a quick second tap is a tap, never the browser\'s double-tap zoom: touch-action manipulation on buttons and links, phones only @core', async ({ page, world, signIn }) => {
    onlyIn()
    const { host, home } = await hostWithWork(world)
    await signIn(host)
    const actions = () => page.evaluate(() => Array.from(document.querySelectorAll('a, button, [role="button"], summary'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => getComputedStyle(el).touchAction))
    for (const url of [`/listings/${home.id}`, `/dashboard/host/listings/${home.id}/edit`, '/dashboard/host']) {
      await page.setViewportSize({ width: 390, height: 800 })
      await page.goto(url, { waitUntil: 'load' })
      const phone = await actions()
      expect(phone.length, url).toBeGreaterThan(5)
      expect(phone.filter((t) => t !== 'manipulation'), `${url} at 390 px`).toEqual([])
      // Desktop as it was (the bar's tabs and the hearts set it themselves, and are not on these desktop pages' links)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(url, { waitUntil: 'load' })
      expect((await actions()).filter((t) => t === 'manipulation').length, `${url} at 1280 px`).toBeLessThanOrEqual(2)
    }
  })
})

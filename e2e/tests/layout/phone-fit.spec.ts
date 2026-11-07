import { test, expect } from '../../lib/test'
import { audit, type Problem } from '../../lib/phoneFit'

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
})

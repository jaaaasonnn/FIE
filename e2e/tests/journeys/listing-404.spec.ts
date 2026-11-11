import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'

// AS22: an address for a listing that does not exist at all answers a real 404, with the same "Listing not found"
// the listing page draws. A listing that exists but is not shown to this person (switched off, on hold, its host
// suspended) answers exactly as before: 200, and the browser asks for it, so its host, an admin and a guest who
// booked it still see it. @core, every set-up.

const notFoundHeading = (page: Page) => page.getByRole('heading', { name: 'Listing not found' })

/** The page's own answer (the HTML document), as a browser and a search engine get it */
async function open(page: Page, id: string) {
  const res = await page.goto(`/listings/${id}`)
  return res!.status()
}

test.describe('a listing that does not exist, and listings that are not public (AS22)', () => {
  test('no such listing: HTTP 404, "Listing not found", and the way to search @core', async ({ page }) => {
    const id = `no-such-home-${Date.now()}`
    expect(await open(page, id)).toBe(404)
    await expect(notFoundHeading(page)).toBeVisible()
    await expect(page.getByText('This listing may have been removed or is no longer active.')).toBeVisible()
    await expect(page.getByText('Page not found')).toHaveCount(0)
    // As a search engine gets it: 404 and noindex. (The words are drawn by the browser: these pages have no Suspense
    // boundary, so Next sends its error page for notFound() and the not-found boundary is drawn in the browser.)
    const raw = await page.request.get(`/listings/${id}`)
    expect(raw.status()).toBe(404)
    expect(await raw.text()).toContain('<meta name="robots" content="noindex"/>')
    // And the API answers as it always did
    expect((await page.request.get(`/api/listings/${id}`)).status()).toBe(404)
    await page.getByRole('button', { name: 'Browse all listings' }).click()
    await expect(page).toHaveURL(/\/search$/)
  })

  test('switched off, on hold, or its host suspended: 200 as before; its host, an admin and a guest who booked it still see it @core', async ({ page, context, world, signIn }) => {
    test.setTimeout(120_000)
    const host = await world.host()
    const guest = await world.guest()
    const admin = await world.admin()
    const off = await world.listing(host)
    const held = await world.listing(host)
    await world.mustBook(guest, off.id)
    expect((await host.call('DELETE', `/api/listings/${off.id}`)).status).toBe(200)
    await db.listing.update({ where: { id: held.id }, data: { isActive: false, moderationHold: true } })

    // A stranger (signed out): "Listing not found", with the page's old answer, 200
    for (const home of [off, held]) {
      expect(await open(page, home.id), home.title).toBe(200)
      await expect(notFoundHeading(page)).toBeVisible()
      await expect(page.getByText(home.title)).toHaveCount(0)
    }

    // The host, an admin, and the guest who booked the switched-off home see it
    for (const [person, homes] of [[host, [off, held]], [admin, [off, held]], [guest, [off]]] as const) {
      await context.clearCookies()
      await signIn(person)
      for (const home of homes) {
        expect(await open(page, home.id), `${person.role} on ${home.title}`).toBe(200)
        await expect(page.getByRole('heading', { name: home.title }).first()).toBeVisible()
      }
    }
    await context.clearCookies()

    // A home whose host is suspended: still 200 and "not found" for a stranger
    const other = await world.host()
    const home = await world.listing(other)
    expect((await admin.call('POST', '/api/admin/users', { userId: other.id, action: 'suspend', reason: 'Suspended by the listing 404 test.' })).status).toBe(200)
    expect(await open(page, home.id)).toBe(200)
    await expect(notFoundHeading(page)).toBeVisible()
  })
})

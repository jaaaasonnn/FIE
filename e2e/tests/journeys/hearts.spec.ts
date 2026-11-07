import type { Page } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { AuthPage } from '../../pages'

// App shell stage 3, job 2 (the listing page's part): the listing page's heart is the cards' heart
// (components/listing/HeartButton.tsx and wishlistStore.ts) in the row's own look. It asks for the person's saved
// homes as ids only (GET /api/wishlists?only=ids, never ?userId=), sends only the home's id, and a heart pressed
// while signed out saves that home once after logging in, through this tab's sessionStorage (never the address),
// for 10 minutes. @core: every set-up, phones and desktops alike. Desktop search cards keep no heart (proof 302).

const PENDING_KEY = 'fiegh-save-after-login'
const saved = (userId: string, listingId: string) => db.wishlist.count({ where: { userId, listingId } })
const heartOf = (page: Page, listingId: string) => page.locator(`[data-heart="${listingId}"]`).filter({ visible: true })

/** Every wishlist request the page makes, and the bodies of the ones that change something */
function watchWishlists(page: Page) {
  const asked: string[] = []
  const sent: string[] = []
  page.on('request', (r) => {
    if (!new URL(r.url()).pathname.startsWith('/api/wishlists')) return
    asked.push(`${r.method()} ${new URL(r.url()).search}`)
    if (r.method() === 'POST') sent.push(r.postData() ?? '')
  })
  return { asked, sent }
}

test.describe('the listing page\'s heart', () => {
  test('saves the home and takes it off again, asking for ids only and sending only the home @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    await signIn(guest)
    const calls = watchWishlists(page)
    await page.goto(`/listings/${home.id}`)
    const heart = heartOf(page, home.id)
    await expect(heart).toHaveAccessibleName(`Save ${home.title} to your wishlist`)
    await expect(heart).toBeEnabled()
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => saved(guest.id, home.id)).toBe(1)

    // Saved on the next visit, the heart filled
    await page.goto(`/listings/${home.id}`)
    await expect(heartOf(page, home.id)).toHaveAttribute('aria-pressed', 'true')
    await expect(heartOf(page, home.id).locator('svg')).toHaveClass(/fill-red-500/)
    await heartOf(page, home.id).click()
    await expect(heartOf(page, home.id)).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => saved(guest.id, home.id)).toBe(0)

    expect(calls.asked.filter((a) => a.startsWith('GET')), 'one answer of ids per page').toEqual(['GET ?only=ids', 'GET ?only=ids'])
    expect(calls.asked.some((a) => a.includes('userId')), 'never ?userId=').toBe(false)
    for (const body of calls.sent) expect(JSON.parse(body)).toEqual({ listingId: home.id })
  })

  test('signed out: the heart goes to log in and back, and the home is saved once @core', async ({ page, world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    await page.goto(`/listings/${home.id}`)
    await heartOf(page, home.id).click()
    await expect(page).toHaveURL(/\/login\?redirect=/)
    expect(page.url(), 'the address names the page to come back to, nothing to save').not.toMatch(/save/i)
    await expect(page.getByPlaceholder('Your password')).toBeVisible()
    await new AuthPage(page).logIn(guest.email, guest.password)
    await expect(page).toHaveURL(new RegExp(`/listings/${home.id}$`))
    await expect(heartOf(page, home.id)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => saved(guest.id, home.id)).toBe(1)
    expect(await page.evaluate((k) => sessionStorage.getItem(k), PENDING_KEY), 'used once').toBeNull()

    // Taken off again, it stays off: the save is not used a second time. Pressed once the save has its answer: a
    // press while a heart's request is on its way is ignored (aria-busy; AS14)
    await expect(heartOf(page, home.id)).not.toHaveAttribute('aria-busy', 'true')
    await heartOf(page, home.id).click()
    await expect.poll(() => saved(guest.id, home.id)).toBe(0)
    await page.reload()
    await expect(heartOf(page, home.id)).toBeEnabled()
    await page.waitForLoadState('networkidle')
    expect(await saved(guest.id, home.id)).toBe(0)
    await expect(heartOf(page, home.id)).toHaveAttribute('aria-pressed', 'false')
  })

  test('a waiting save never takes off a home already saved, and is dropped after 10 minutes or for another home', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const [kept, late, other] = [await world.listing(host), await world.listing(host), await world.listing(host)]
    await db.wishlist.create({ data: { userId: guest.id, listingId: kept.id } })
    await signIn(guest)
    const wait = (page: Page, id: string, ageMs: number) => page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [PENDING_KEY, JSON.stringify({ id, at: Date.now() - ageMs })] as const)

    // Already saved: it stays saved (a press toggles, so a blind press would have taken it off)
    await page.goto(`/listings/${kept.id}`)
    await wait(page, kept.id, 0)
    await page.reload()
    await expect(heartOf(page, kept.id)).toHaveAttribute('aria-pressed', 'true')
    await page.waitForLoadState('networkidle')
    expect(await saved(guest.id, kept.id)).toBe(1)

    // Older than 10 minutes: not saved, and dropped
    await wait(page, late.id, 11 * 60 * 1000)
    await page.goto(`/listings/${late.id}`)
    await expect(heartOf(page, late.id)).toBeEnabled()
    await page.waitForLoadState('networkidle')
    expect(await saved(guest.id, late.id)).toBe(0)
    expect(await page.evaluate((k) => sessionStorage.getItem(k), PENDING_KEY)).toBeNull()

    // For another home: not used here, and kept for that home's page
    await wait(page, other.id, 0)
    await page.goto(`/listings/${late.id}`)
    await expect(heartOf(page, late.id)).toBeEnabled()
    await page.waitForLoadState('networkidle')
    expect(await saved(guest.id, late.id)).toBe(0)
    expect(await saved(guest.id, other.id)).toBe(0)
    await page.goto(`/listings/${other.id}`)
    await expect(heartOf(page, other.id)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => saved(guest.id, other.id)).toBe(1)
  })

  test('the return address alone saves nothing: a tab with no waiting save, signed in, opening it @core', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    await signIn(guest)
    await page.goto(`/listings/${home.id}`)
    await expect(heartOf(page, home.id)).toBeEnabled()
    await page.waitForLoadState('networkidle')
    expect(await saved(guest.id, home.id)).toBe(0)
  })
})

import type { Page, Request } from '@playwright/test'
import { test, expect } from '../../lib/test'
import { recordShifts } from '../../lib/layoutShift'
import { audit } from '../../lib/phoneFit'
import type { Actor, World } from '../../lib/world'

// AS27: on a phone (below 640 px the list and a thread are never on screen together) opening Messages selects no
// conversation and marks nothing read until the person taps one, so the bar's unread badge does not drop on opening
// and the row does not move. Wider, the first conversation opens beside the list and is marked read, as before.
// A row's time label is drawn fresh when its words change at a poll, so they are not moved inside their box.
// @core, run in every set-up at the widths set here.

async function unreadFromHost(world: World): Promise<{ guest: Actor; host: Actor }> {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  // With the listing, as the inbox sends it (a message with the booking only is not marked read by the inbox: AS28)
  expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome', bookingId, listingId: home.id })).status).toBe(201)
  expect((await guest.call('GET', '/api/messages/unread')).json.count).toBe(1)
  return { guest, host }
}

/** Every mark-read the page sends (PATCH /api/messages) */
function markReads(page: Page) {
  const sent: Request[] = []
  page.on('request', (req) => { if (req.method() === 'PATCH' && new URL(req.url()).pathname === '/api/messages') sent.push(req) })
  return sent
}

const row = (page: Page, name: string) => page.getByRole('button').filter({ hasText: name })

test.describe('the inbox on a phone and on a desktop (AS27)', () => {
  test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })

  test('at 390 px opening Messages selects nothing and marks nothing read; a tap opens and marks it @core', async ({ page, world, signIn }) => {
    const { guest, host } = await unreadFromHost(world)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(guest)
    const sent = markReads(page)
    await page.goto('/dashboard/guest/messages')
    const conv = row(page, host.name)
    await expect(conv).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    expect(sent, 'no mark-read on opening').toHaveLength(0)
    expect((await guest.call('GET', '/api/messages/unread')).json.count).toBe(1)
    // The row keeps its unread count, nothing is highlighted, and the thread is not on screen
    await expect(conv.getByText('1', { exact: true })).toBeVisible()
    expect(await conv.evaluate((el) => (el as HTMLElement).style.backgroundColor)).toBe('')
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeHidden()
    // The bar's badge (phones; the bar is below 768 px) still counts it
    const badge = page.locator('[data-bottom-bar] [data-unread-slot]')
    await expect(badge).toHaveText('11 unread message')

    await conv.click()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    await expect.poll(() => sent.length).toBeGreaterThan(0)
    await expect.poll(async () => (await guest.call('GET', '/api/messages/unread')).json.count).toBe(0)
  })

  test('at 1280 px the first conversation still opens beside the list and is marked read @core', async ({ page, world, signIn }) => {
    const { guest, host } = await unreadFromHost(world)
    await page.setViewportSize({ width: 1280, height: 900 })
    await signIn(guest)
    const sent = markReads(page)
    await page.goto('/dashboard/guest/messages')
    await expect(row(page, host.name)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    await expect(page.getByText('Welcome', { exact: true })).toBeVisible()
    await expect.poll(() => sent.length).toBeGreaterThan(0)
    await expect.poll(async () => (await guest.call('GET', '/api/messages/unread')).json.count).toBe(0)
  })

  test('at 390 px, back on the list while a conversation is open, "Just now" turning into "1m ago" moves nothing @core', async ({ page, world, signIn, browserName }) => {
    const { guest, host } = await unreadFromHost(world)
    await page.setViewportSize({ width: 390, height: 844 })
    await recordShifts(page)
    await page.clock.install()
    await signIn(guest)
    await page.goto('/dashboard/guest/messages')
    const conv = row(page, host.name)
    await conv.click()
    await page.getByRole('button', { name: 'Back to conversations' }).click()
    await expect(conv).toBeVisible()
    await expect(conv.getByText('Just now', { exact: true })).toBeVisible()
    await page.waitForTimeout(1000)
    await page.evaluate(() => { const s = (window as unknown as { __shift: { total: number; worst: string[] } }).__shift; s.total = 0; s.worst = [] })

    // A minute on: the next poll writes "1m ago"
    await page.clock.fastForward(61_000)
    await expect(conv.getByText('1m ago', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(1000)
    if (browserName === 'chromium') {
      const shift = await page.evaluate(() => (window as unknown as { __shift: { total: number; worst: string[] } }).__shift)
      expect(shift.total, shift.worst.join('; ')).toBe(0)
    }
  })

  // AS40: a name with one long word (the failing run's host was "E2E Host 4d989720wm1z") pushed the row's time out of
  // its box at 320 px, 174 px of text in a 169 px row; it now breaks inside the word. A plain name is drawn as before.
  test('a name with one long word stays inside its row at 320 and 360 px, in both inboxes @core', async ({ page, world, signIn }) => {
    const host = await world.person('HOST', { name: 'Wwmmwwmmwwmmwwmm Host' })
    const guest = await world.person('GUEST', { name: 'Mmwwmmwwmmwwmmww Guest' })
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    expect((await host.call('POST', '/api/messages', { receiverId: guest.id, content: 'Welcome', bookingId, listingId: home.id })).status).toBe(201)
    for (const [who, inbox, name] of [[guest, '/dashboard/guest/messages', 'Wwmmwwmmwwmmwwmm Host'], [host, '/dashboard/host/messages', 'Mmwwmmwwmmwwmmww Guest']] as const) {
      await page.context().clearCookies()
      await signIn(who)
      for (const width of [320, 360]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto(inbox, { waitUntil: 'load' })
        await expect(row(page, name).first()).toBeVisible()
        expect(await audit(page, `${width}px ${inbox}`)).toEqual([])
      }
    }
  })
})

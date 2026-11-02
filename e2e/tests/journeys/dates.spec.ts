import { test, expect } from '../../lib/test'

// SU5: a stay in September on the pages that come with their data from the server. Node (and Chromium and
// Firefox) wrote September short as "Sept", Safari "Sep", so in the Safari set-ups React found the server's
// text different from its own (error 418) and drew the page again. Dates are now written from our own names
// (src/lib/dateText.ts): "Sep" everywhere, and no 418 in any browser.

test('a stay in September reads "Sep" on checkout and both dashboards, the same from the server as in the browser @core', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const year = new Date().getUTCFullYear() + 1
  const day = 10 + Math.floor(Math.random() * 15)
  const bookingId = await world.mustBook(guest, home.id, { checkIn: `${year}-09-${day}`, checkOut: `${year}-09-${day + 2}` })

  const errors: string[] = []
  page.on('pageerror', (e) => { if (!e.message.includes('/api/1/envelope/')) errors.push(e.message.slice(0, 200)) })
  for (const [who, url] of [[guest, `/checkout/${bookingId}`], [guest, '/dashboard/guest'], [host, '/dashboard/host']] as const) {
    await page.context().clearCookies()
    await signIn(who)
    const served = await (await page.request.get(url)).text()
    expect(served, `${url}: the server's copy`).toContain(`${day} Sep`)
    expect(served, `${url}: the server's copy`).not.toContain('Sept')
    await page.goto(url, { waitUntil: 'networkidle' })
    await expect(page.getByText(new RegExp(`\\b${day} Sep\\b`)).first()).toBeVisible()
    expect(errors, `${url}: no React error 418`).toEqual([])
  }
})

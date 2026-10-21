import { test, expect } from '../../lib/test'

// G1 (fixed): one failed session check was taken as "signed out", and the client guards on checkout, the
// guest dashboard and others then sent a signed-in person to /login. Now only a clear 401 means signed out:
// anything else is tried again (src/lib/clientFetch.ts), and if it still fails nothing is assumed and a bar
// offers to try again.

for (const [what, failure] of [['the connection drops', 'abort'], ['the server answers 502 with a page', '502']] as const) {
  test(`a signed-in guest stays on checkout when the session check fails once (${what}) @core`, async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    let failed = 0
    await page.route('**/api/auth/session', (route) => {
      if (failed++ > 0) return route.continue()
      return failure === 'abort' ? route.abort('connectionreset') : route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' })
    })
    await page.goto(`/checkout/${bookingId}`)
    await page.waitForLoadState('networkidle')
    expect(failed, 'the session check was failed once').toBeGreaterThanOrEqual(1)
    await expect.poll(() => new URL(page.url()).pathname, { message: 'still on checkout, not sent to log-in' }).toBe(`/checkout/${bookingId}`)
    await expect(page.getByRole('button', { name: 'Debit / Credit Card' })).toBeVisible()
  })
}

test('a signed-in guest whose session check never answers is not sent to log-in, and can try again @core', async ({ page, world, signIn }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await signIn(guest)
  let down = true
  await page.route('**/api/auth/session', (route) => (down ? route.abort('connectionreset') : route.continue()))
  await page.goto(`/checkout/${bookingId}`)
  const retry = page.getByRole('alert').filter({ hasText: 'Something went wrong loading this page' }).getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname, 'still on checkout, not sent to log-in').toBe(`/checkout/${bookingId}`)
  down = false
  await retry.click()
  await expect(page.getByRole('button', { name: 'Debit / Credit Card' })).toBeVisible()
  await expect(retry).toBeHidden()
})

test('a guest who is not signed in (a clear 401) is still sent to log-in from checkout @core', async ({ page, world }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await page.goto(`/checkout/${bookingId}`)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
})

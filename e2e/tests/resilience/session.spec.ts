import { test, expect } from '../../lib/test'

// G1: one failed session check is taken as "signed out". src/context/AuthContext.tsx catches any failure of
// GET /api/auth/session (a dropped connection, a request the browser cancelled, a 5xx that is not JSON) and
// sets the user to null; the client guards on checkout, the guest dashboard and others then send a signed-in
// person to /login. On a weak mobile connection one lost request is enough.

for (const [what, failure] of [['the connection drops', 'abort'], ['the server answers 502 with a page', '502']] as const) {
  test(`a signed-in guest stays on checkout when the session check fails once (${what}) @core`, async ({ page, world, signIn }) => {
    test.fail(true, 'G1: a failed session check sends a signed-in guest to log-in')
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
    await expect(page.getByRole('button', { name: /^Pay .* Securely/ }).or(page.getByRole('button', { name: 'Debit / Credit Card' }))).toBeVisible()
  })
}

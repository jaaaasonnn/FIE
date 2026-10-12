import { test, expect, FORM_LOGIN_NEEDS_HTTPS } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { call } from '../../lib/world'
import { AuthPage, Header } from '../../pages'

// Accounts: getting in, getting out, and getting back in after forgetting.

test.describe('accounts', () => {
  test('forgot password: the link arrives, the new password works, the old one and old sessions do not @core', async ({ page, world }) => {
    const person = await world.guest()
    await page.goto('/auth/forgot-password')
    // What the page says once the form has been sent: read when it has changed from the form
    const answer = async (email: string) => {
      const words = () => page.locator('body').innerText().then((t) => t.replaceAll(email, '<address>'))
      await page.getByPlaceholder('ama@example.com').fill(email)
      const before = await words()
      await page.getByRole('button', { name: 'Send the link' }).click()
      await expect.poll(words).not.toBe(before)
      await expect(page.getByRole('button', { name: 'Send the link' })).toHaveCount(0)
      return words()
    }
    const said = await answer(person.email)
    const link = await person.linkFrom('Reset your')
    expect(new URL(link).pathname).toBe('/auth/reset-password')
    await page.goto(link)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    const fields = page.locator('input[type=password]')
    await fields.nth(0).fill('Brand-new-pass-77')
    await fields.nth(1).fill('Brand-new-pass-77')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect.poll(async () => (await call('POST', '/api/auth/signin', { identifier: person.email, password: 'Brand-new-pass-77' })).status).toBe(200)
    expect((await call('POST', '/api/auth/signin', { identifier: person.email, password: person.password })).status).toBe(401)
    // The session from before the reset is gone
    expect((await person.call('GET', `/api/bookings?guestId=${person.id}`)).status).toBe(401)
    // The link is used up
    await page.goto(link)
    await fields.nth(0).fill('Another-pass-88'); await fields.nth(1).fill('Another-pass-88')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect.poll(async () => (await call('POST', '/api/auth/signin', { identifier: person.email, password: 'Another-pass-88' })).status).toBe(401)

    // An address with no account gets the same words, and no email
    await page.goto('/auth/forgot-password')
    const nobody = `e2e-nobody-${Date.now().toString(36)}@fiegh.test`
    // The page says the same thing whether or not the address has an account
    expect(await answer(nobody)).toBe(said)
    expect(await fakes.inbox(nobody)).toHaveLength(0)
  })

  test('a wrong password is refused with a plain message, and a right one lands on the dashboard for the role @core', async ({ page, world, browserName }) => {
    test.skip(browserName === 'webkit', FORM_LOGIN_NEEDS_HTTPS)
    const host = await world.host()
    const auth = new AuthPage(page)
    await auth.gotoLogin()
    await auth.logIn(host.email, 'not-the-password')
    await expect(page.getByText('Invalid credentials')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await auth.logIn(host.email, host.password)
    await expect(page).toHaveURL(/\/dashboard\/host/)
  })

  test('signing out from the menu ends the session in the browser and on the server @core', async ({ page, world, signIn }) => {
    const guest = await world.guest()
    await signIn(guest)
    await page.goto('/dashboard/guest')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back')
    // On a phone the account is inside the menu; on a wide screen it is its own button
    const account = page.getByRole('button', { name: /E2E/ }).first()
    if (await account.isVisible()) await account.click()
    else await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('button', { name: /log ?out|sign ?out/i }).or(page.getByRole('menuitem', { name: /log ?out|sign ?out/i })).or(page.getByText(/^(Log ?out|Sign ?out)$/i)).first().click()
    await expect.poll(async () => db.session.count({ where: { userId: guest.id } })).toBe(0)
    await page.goto('/dashboard/guest')
    await expect(page).toHaveURL(/\/login\?redirect=/)
    void Header
  })

  test('a suspended person is told so at log-in, and can log in again once restored', async ({ page, world, browserName }) => {
    test.skip(browserName === 'webkit', FORM_LOGIN_NEEDS_HTTPS)
    const admin = await world.admin()
    const guest = await world.guest()
    expect((await admin.call('POST', '/api/admin/users', { userId: guest.id, action: 'suspend', reason: 'Suspended by the end-to-end journey test.' })).status).toBe(200)
    const auth = new AuthPage(page)
    await auth.gotoLogin()
    await auth.logIn(guest.email, guest.password)
    await expect(page.getByText(/This account has been suspended/)).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    expect((await page.context().cookies()).find((c) => c.name === 'fiegh_session')).toBeUndefined()
    // The person is told by email, and the email does not carry the admin's reason
    const [mail] = await guest.mail(/suspended/i)
    expect(mail.text).not.toContain('end-to-end journey test')
    expect((await admin.call('POST', '/api/admin/users', { userId: guest.id, action: 'restore', reason: 'Restored by the end-to-end journey test.' })).status).toBe(200)
    await auth.logIn(guest.email, guest.password)
    await expect(page).toHaveURL(/\/dashboard\/guest/)
  })

  test('a guest becomes a host from the become-a-host page, and gets the host dashboard', async ({ page, world, signIn }) => {
    const guest = await world.guest()
    await signIn(guest)
    await page.goto('/become-a-host')
    // Told up front: 90% of the rent, a payout method, and an approved ID before any payout
    await expect(page.getByRole('heading', { name: 'You keep 90% of the rent' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'You need an approved ID before we can pay you' })).toBeVisible()
    await page.getByRole('button', { name: 'Become a host' }).click()
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: guest.id } })).role).toBe('HOST')
    await page.goto('/dashboard/host')
    await expect(page).toHaveURL(/\/dashboard\/host/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Dashboard')
  })
})

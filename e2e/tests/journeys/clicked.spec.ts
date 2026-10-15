import path from 'path'
import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { day } from '../../lib/world'
import { CheckoutPage, FakePaystack } from '../../pages'

// The paths the first go drove through the API only, now clicked through in the browser: creating a
// listing (all six steps, with photos), sending an ID and an admin's Approve and Reject, the admin's
// "address and photos checked" form, suspending and restoring from the Users tab, the payout method
// form, and paying a later month's rent from the guest's booking page.

const PHOTO = path.join(__dirname, '../../fixtures/photo.jpg')
const DAY = 86_400_000
/**
 * The admin cards change their buttons as they are used, so a card is found once and pinned by a mark on its
 * element. `rows.last()` is the card's top row (the name and the buttons); the form it opens is below that row,
 * so the mark goes on the row's parent, the whole card.
 */
async function pin(rows: import('@playwright/test').Locator, mark: string) {
  await rows.last().evaluate((e, m) => e.parentElement!.setAttribute('data-e2e-card', m), mark)
  return rows.page().locator(`[data-e2e-card="${mark}"]`)
}

test.describe('clicked through @core', () => {
  test('a host creates a listing through all six steps, with two photos uploaded, and it is live with what was typed', async ({ page, world, signIn, problems }) => {
    const host = await world.host()
    const title = `E2E clicked home ${Date.now().toString(36)}`
    await signIn(host)
    await page.goto('/dashboard/host/listings/new')

    // 1. Property info: Continue refuses until the required fields are there
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Please enter a property title.')).toBeVisible()
    await page.getByLabel('Property Title').fill(title)
    await page.getByLabel('Description').fill('A two-bedroom flat entered through the form by the end-to-end tests. Not a real home.')
    await page.getByLabel('Property Type').selectOption('Apartment')
    await page.getByLabel('Bedrooms').selectOption('2')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 2. Location, with a digital address in the wrong shape first
    await expect(page.getByText('Step 2: Location')).toBeVisible()
    await page.getByLabel('Region').selectOption('Greater Accra')
    await page.getByLabel('City / Town').fill('Accra')
    await page.getByLabel('Neighbourhood (optional)').fill('Osu')
    await page.getByLabel('Ghana Post digital address (optional)').fill('not an address')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Step 2: Location')).toBeVisible()
    await page.getByLabel('Ghana Post digital address (optional)').fill('GA-183-8164')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 3. Pricing: a mode needs its price
    await expect(page.getByText('Step 3: Pricing')).toBeVisible()
    await page.getByRole('button', { name: /Short Stay/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Enter a nightly price for Short Stay.')).toBeVisible()
    await page.getByLabel('Price per Night (USD $)').fill('72')
    await page.getByLabel('Damage deposit (USD $, optional)').fill('40')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 4. Amenities and rules; Continue saves the listing (switched off) so photos have somewhere to go
    await expect(page.getByText('Step 4: Amenities & Rules')).toBeVisible()
    await page.getByRole('button', { name: 'WiFi', exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // 5. Photos: two uploads to the fake storage
    await expect(page.getByText('Step 5: Photos')).toBeVisible()
    await expect.poll(async () => db.listing.count({ where: { hostId: host.id, title } })).toBe(1)
    const draft = await db.listing.findFirstOrThrow({ where: { hostId: host.id, title } })
    expect(draft.isActive).toBe(false)
    const input = page.locator('input[type="file"]')
    await input.setInputFiles(PHOTO)
    await expect(page.getByRole('button', { name: 'Remove photo' })).toHaveCount(1)
    await input.setInputFiles(PHOTO)
    await expect(page.getByRole('button', { name: 'Remove photo' })).toHaveCount(2)
    await page.getByRole('button', { name: 'Continue' }).click()

    // 6. Review shows what was typed; Submit publishes it
    await expect(page.getByText('Step 6: Review')).toBeVisible()
    for (const shown of [title, 'Osu, Accra, Greater Accra', '2 uploaded', '$72']) await expect(page.getByText(shown, { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Submit Listing' }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/host\\?created=${draft.id}`))

    const saved = await db.listing.findUniqueOrThrow({ where: { id: draft.id } })
    expect(saved).toMatchObject({ title, region: 'Greater Accra', city: 'Accra', neighbourhood: 'Osu', digitalAddress: 'GA-183-8164', propertyType: 'Apartment', bedrooms: 2, priceNightly: 72, damageDeposit: 40, isActive: true })
    const photos = JSON.parse(saved.photos as unknown as string) as string[]
    expect(photos).toHaveLength(2)
    expect(await fakes.files(draft.id)).toHaveLength(2)
    expect(await db.listing.count({ where: { hostId: host.id } }), 'one listing, not a second one on publish').toBe(1)
    // The public page shows it, and never the digital address
    await page.goto(`/listings/${draft.id}`)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.getByText('GA-183-8164')).toHaveCount(0)
    expect(problems.pageErrors).toEqual([])
  })

  test('a host sends an ID through the page; an admin rejects it with the button, the host sends again, and the admin approves it', async ({ page, world, signIn, browser }) => {
    const admin = await world.admin()
    const host = await world.host({ idApproved: false })
    await signIn(host)
    await page.goto('/auth/verify-id')
    await expect(page.getByRole('button', { name: 'Submit for Verification' })).toBeDisabled()
    await page.getByRole('button', { name: 'Ghana Card (NIA)' }).click()
    const files = page.locator('input[type="file"]')
    await files.nth(0).setInputFiles(PHOTO)
    await files.nth(1).setInputFiles(PHOTO)
    await page.getByRole('button', { name: 'Submit for Verification' }).click()
    await expect.poll(async () => (await db.verification.findUnique({ where: { userId: host.id } }))?.status ?? null).toBe('PENDING')
    expect((await fakes.files(`verification-docs/${host.id}/`)).length).toBeGreaterThanOrEqual(2)

    // The admin, in a separate browser context, rejects it from the Verifications tab
    const adminContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, extraHTTPHeaders: { 'x-vercel-forwarded-for': admin.ip } })
    await admin.signIn()
    await adminContext.addCookies([{ name: 'fiegh_session', value: admin.cookie!, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
    const ap = await adminContext.newPage()
    const card = async () => {
      await ap.goto('/admin')
      await ap.getByRole('button', { name: 'Verifications', exact: true }).click()
      return pin(ap.locator('div').filter({ hasText: host.name }).filter({ has: ap.getByRole('button', { name: /^(Approve|Reject)$/ }) }), `id-${Date.now()}`)
    }
    let row = await card()
    await row.getByRole('button', { name: 'Reject', exact: true }).click()
    await row.getByRole('textbox').fill('The photo is too dark to read the card number.')
    await row.getByRole('button', { name: 'Reject this ID' }).click()
    await expect.poll(async () => (await db.verification.findUniqueOrThrow({ where: { userId: host.id } })).status).toBe('REJECTED')
    expect((await db.user.findUniqueOrThrow({ where: { id: host.id } })).isVerified).toBe(false)

    // The host sends it again from the same page
    await page.goto('/auth/verify-id')
    await page.getByRole('button', { name: 'Passport' }).click()
    await files.nth(0).setInputFiles(PHOTO)
    await files.nth(1).setInputFiles(PHOTO)
    await page.getByRole('button', { name: 'Submit for Verification' }).click()
    await expect.poll(async () => (await db.verification.findUniqueOrThrow({ where: { userId: host.id } })).status).toBe('PENDING')

    row = await card()
    await row.getByRole('button', { name: 'Approve', exact: true }).click()
    await row.getByRole('button', { name: 'Yes, approve this ID' }).click()
    await expect.poll(async () => (await db.verification.findUniqueOrThrow({ where: { userId: host.id } })).status).toBe('APPROVED')
    const v = await db.verification.findUniqueOrThrow({ where: { userId: host.id } })
    expect(v).toMatchObject({ idType: 'PASSPORT', reviewedById: admin.id })
    expect((await db.user.findUniqueOrThrow({ where: { id: host.id } })).isVerified).toBe(true)
    await adminContext.close()
  })

  test('an admin marks a home "address and photos checked" through the form; it refuses until every box, a method and a real note are given', async ({ page, world, signIn }) => {
    const admin = await world.admin()
    const host = await world.host()
    const home = await world.listing(host)
    await db.listing.update({ where: { id: home.id }, data: { digitalAddress: 'GA-183-8164', photos: JSON.stringify(['https://images.unsplash.com/photo-1506126208421-3345d63a05d8?w=1200&q=80']) } })
    await signIn(admin)
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Listing checks', exact: true }).click()
    const row = await pin(page.locator('div').filter({ hasText: home.title }).filter({ has: page.getByRole('button', { name: 'Mark as checked' }) }), home.id)
    await row.getByRole('button', { name: 'Mark as checked' }).click()
    const save = row.getByRole('button', { name: /^Show "/ })
    await expect(save).toBeDisabled()
    const boxes = row.getByRole('checkbox')
    const count = await boxes.count()
    expect(count).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < count; i++) await boxes.nth(i).check()
    await row.getByRole('radio').first().check()
    await row.getByRole('textbox').fill('too short')
    await expect(save).toBeDisabled()
    await row.getByRole('textbox').fill('Video call with the host at the gate and in each room; address looked up on the Ghana Post app.')
    await expect(save).toBeEnabled()
    await save.click()
    await expect.poll(async () => db.listingCheck.count({ where: { listingId: home.id } })).toBe(1)
    const check = await db.listingCheck.findFirstOrThrow({ where: { listingId: home.id } })
    expect(check).toMatchObject({ checkedById: admin.id, revokedAt: null })
    await page.goto(`/listings/${home.id}`)
    await expect(page.getByText('Address and photos checked').first()).toBeVisible()
    await expect(page.getByText('Video call with the host')).toHaveCount(0)
  })

  test('an admin suspends a host from the Users tab and restores them; each needs a reason, and the host is signed out', async ({ page, world, signIn }) => {
    const admin = await world.admin()
    const host = await world.host()
    await host.signIn()
    expect((await host.call('GET', '/api/auth/session')).status).toBe(200)
    await signIn(admin)
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Users', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: host.email })
    await row.getByRole('button', { name: 'Suspend', exact: true }).click()
    const confirm = row.getByRole('button', { name: 'Suspend account' })
    await row.getByRole('textbox').fill('short')
    await expect(confirm).toBeDisabled()
    await row.getByRole('textbox').fill('Listing photos copied from another site.')
    await confirm.click()
    await expect(row.getByText(/Suspended .*Listing photos copied/)).toBeVisible()
    expect((await db.user.findUniqueOrThrow({ where: { id: host.id } })).suspendedAt).not.toBeNull()
    expect((await host.call('GET', '/api/auth/session')).status, 'the host is signed out').toBe(401)

    await row.getByRole('button', { name: 'Restore', exact: true }).click()
    await row.getByRole('textbox').fill('Photos replaced with the host\'s own.')
    await row.getByRole('button', { name: 'Restore account' }).click()
    await expect(row.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
    expect((await db.user.findUniqueOrThrow({ where: { id: host.id } })).suspendedAt).toBeNull()
    const notices = await db.notification.findMany({ where: { userId: admin.id, type: { in: ['ACCOUNT_SUSPENDED', 'ACCOUNT_RESTORED'] } } })
    expect(notices.map((n) => n.type).sort()).toEqual(['ACCOUNT_RESTORED', 'ACCOUNT_SUSPENDED'])
  })

  test('a host saves a mobile money payout method through the form: password needed, the name comes back from Paystack, and payouts wait a day', async ({ page, world, signIn }) => {
    const host = await world.host({ payoutMethod: false })
    await signIn(host)
    await page.goto('/dashboard/host/payouts')
    await page.getByRole('button', { name: 'Add / Change' }).click()
    await page.getByLabel('Mobile money network').selectOption({ index: 1 })
    await page.getByLabel('Mobile money number').fill('0241234567')
    await page.getByRole('button', { name: 'Save Payout Method' }).click()
    await expect(page.getByText('Please re-enter your password to confirm this change.')).toBeVisible()
    await page.getByLabel('Your password').fill('not-the-password')
    await page.getByRole('button', { name: 'Save Payout Method' }).click()
    await expect(page.getByText(/password/i).filter({ hasNotText: 'Re-enter' }).first()).toBeVisible()
    expect((await db.user.findUniqueOrThrow({ where: { id: host.id } })).payoutMethod).toBeNull()
    await page.getByLabel('Your password').fill(host.password)
    await page.getByRole('button', { name: 'Save Payout Method' }).click()
    await expect(page.getByText(/Payout method saved and verified as E2E ACCOUNT 4567/)).toBeVisible()
    const saved = await db.user.findUniqueOrThrow({ where: { id: host.id } })
    expect(saved).toMatchObject({ payoutMethod: 'MOMO', payoutMomoNumber: '0241234567' })
    expect(saved.paystackRecipientCode).toMatch(/^RCP_/)
    expect(Date.now() - saved.payoutMethodVerifiedAt!.getTime()).toBeLessThan(120_000)
    await expect(page.getByText('Verified as E2E ACCOUNT 4567', { exact: true })).toBeVisible()
    await host.mail(/payout/i)
  })

  test('a tenant pays the second month from the booking page: the right month, the right amount, settled once', async ({ page, world, signIn }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { rentalModes: ['TEMP_STAY'], priceMonthly: 600, damageDeposit: 300, priceNightly: undefined })
    const checkIn = day(60).replace(/-(29|30|31)$/, '-28')
    const end = new Date(`${checkIn}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 3)
    const { id } = await world.paidBooking(guest, home.id, { rentalMode: 'TEMP_STAY', checkIn, checkOut: end.toISOString().slice(0, 10) })
    const instalments = await db.instalment.findMany({ where: { bookingId: id }, orderBy: { sequence: 'asc' } })
    expect(instalments.map((i) => i.status)).toEqual(['PAID', 'PENDING', 'PENDING'])
    // Move the tenancy so the second month fell due yesterday
    await ageBooking(id, Math.round((instalments[1].dueDate.getTime() - Date.now()) / DAY) + 1)
    const second = await db.instalment.findUniqueOrThrow({ where: { id: instalments[1].id } })

    await signIn(guest)
    await page.goto(`/bookings/${id}`)
    const pay = page.getByRole('link', { name: /^Pay \$/ })
    await expect(pay).toHaveCount(1)
    await expect(pay).toHaveAttribute('href', `/checkout/${id}?instalment=${second.id}`)
    await pay.click()
    const checkout = new CheckoutPage(page)
    await checkout.chooseCard()
    await expect(checkout.payButton()).toHaveText(/Pay \$600\.00 Securely/)
    await checkout.payButton().click()
    const paystack = new FakePaystack(page)
    await paystack.expectOpen()
    // Pressing Pay again from the checkout page must not start a second payment
    const open = await db.payment.findMany({ where: { bookingId: id, instalmentId: second.id } })
    expect(open).toHaveLength(1)
    await paystack.pay()
    await expect(page).toHaveURL(new RegExp(`instalment=${second.id}&payment=success`))
    await expect.poll(async () => (await db.instalment.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('PAID')
    const third = await db.instalment.findUniqueOrThrow({ where: { id: instalments[2].id } })
    expect(third.status).toBe('PENDING')
    const payments = await db.payment.findMany({ where: { bookingId: id, status: 'SUCCESS' } })
    expect(payments).toHaveLength(2)
    expect(payments.find((p) => p.instalmentId === second.id)?.amount).toBe(600)
    // (let the checkout page finish its own requests first: leaving it half loaded is finding G1)
    await page.waitForLoadState('networkidle')
    // The booking page no longer offers the month just paid; the third month is now the one offered
    // (rent may be paid ahead, one month at a time, once the tenant has moved in: lib/rentRules.ts)
    await page.goto(`/bookings/${id}`)
    await expect(page.getByRole('link', { name: /^Pay \$/ })).toHaveCount(1)
    await expect(page.getByRole('link', { name: /^Pay \$/ })).toHaveAttribute('href', `/checkout/${id}?instalment=${third.id}`)
    await expectInvariants()
  })
})

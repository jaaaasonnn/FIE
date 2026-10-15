import fs from 'fs'
import path from 'path'
import { test, expect } from '../lib/test'
import { db } from '../lib/db'
import { CheckoutPage, ListingPage } from '../pages'

// Stage B3 follow-ups: one failure at a time, to say exactly what a person sees.
//   E2E_PERF=1 node e2e/run.mjs test --project=perf load/probes.spec.ts
const out = path.join(__dirname, '..', '.reports', 'stageB')
const shots = path.join(out, 'probes')
fs.mkdirSync(shots, { recursive: true })
const results: Record<string, unknown>[] = []
const save = () => fs.writeFileSync(path.join(out, 'probes.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1))

const visibleText = async (page: import('@playwright/test').Page) => (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)

test('the answer to Book is lost: what the guest sees on pressing Book again', async ({ page, world, signIn, context }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  await signIn(guest)
  const { checkIn, checkOut } = world.dates(2)
  await page.goto(`/listings/${home.id}`)
  const listing = new ListingPage(page)
  await listing.chooseDates(checkIn, checkOut)
  let n = 0
  const answers: string[] = []
  await context.route('**/api/bookings', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const r = await route.fetch()
    answers.push(`${r.status()} ${(await r.text()).slice(0, 200)}`)
    if (n++ === 0) return route.abort('connectionreset')
    return route.fulfill({ response: r })
  })
  await listing.bookButton().click()
  await expect.poll(() => n).toBe(1)
  await page.waitForTimeout(1500)
  const afterFirst = await visibleText(page)
  await page.screenshot({ path: path.join(shots, 'book-lost-1.png'), fullPage: false })
  await listing.bookButton().click()
  await expect.poll(() => n).toBe(2)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(shots, 'book-lost-2.png'), fullPage: false })
  const alerts = await page.getByRole('alert').allInnerTexts().catch(() => [])
  const errorish = await page.getByText(/not available|no longer|already|taken|went wrong|try again|error|booked/i).allInnerTexts()
  const bookings = await db.booking.findMany({ where: { guestId: guest.id } })
  results.push({ probe: 'Book answer lost', serverAnswers: answers, afterFirstPress: { url: new URL(page.url()).pathname }, afterSecondPress: { url: new URL(page.url()).pathname, alerts, errorish: errorish.slice(0, 5) }, bookings: bookings.map((b) => ({ status: b.status, paymentStatus: b.paymentStatus, payBy: b.payBy })), guestDashboardShowsIt: null })
  // Does the guest's dashboard show the booking and a way to pay?
  await page.goto('/dashboard/guest')
  await page.waitForLoadState('networkidle')
  ;(results.at(-1) as Record<string, unknown>).guestDashboardShowsIt = await page.getByText(home.title).first().isVisible().catch(() => false)
  ;(results.at(-1) as Record<string, unknown>).payNowOffered = await page.getByRole('link', { name: 'Pay now' }).first().isVisible().catch(() => false)
  save()
  void afterFirst
})

test('the answer to Pay is lost: does the first attempt reach the server', async ({ page, world, signIn, context }) => {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host)
  const bookingId = await world.mustBook(guest, home.id)
  await signIn(guest)
  const checkout = new CheckoutPage(page)
  await checkout.goto(bookingId)
  await checkout.chooseCard()
  const answers: string[] = []
  let n = 0
  await context.route('**/api/payments', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const r = await route.fetch()
    answers.push(`${r.status()} ${(await r.text()).slice(0, 160)}`)
    if (n++ === 0) return route.abort('connectionreset')
    return route.fulfill({ response: r })
  })
  await checkout.payButton().click()
  await expect.poll(() => n).toBe(1)
  const rows = await db.payment.findMany({ where: { bookingId } })
  const shown = await visibleText(page)
  await page.screenshot({ path: path.join(shots, 'pay-lost.png') })
  results.push({ probe: 'Pay answer lost', serverAnswers: answers, paymentRowsAfterFirst: rows.map((p) => ({ status: p.status, hasUrl: !!p.authorizationUrl })), guestSees: /network|connection|try again|failed|error/i.exec(shown)?.[0] ?? 'nothing about the failure' })
  save()
})

for (const [what, pattern] of [
  ['the biggest shared script chunk', /\/_next\/static\/chunks\/3bokeuw47nv1d\.js/],
  ['the booking data the checkout page asks for', /\/api\/bookings\?id=/],
  ['the session check', /\/api\/auth\/session/],
  ['the page\'s own code chunk', /\/_next\/static\/chunks\/app\/checkout|\/_next\/static\/chunks\/(?!3bokeuw47nv1d)[\w-]+\.js/],
] as const) {
  test(`one reset on ${what}: does checkout recover`, async ({ page, world, signIn, context }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const bookingId = await world.mustBook(guest, home.id)
    await signIn(guest)
    let hit: string | null = null
    await context.route(pattern, (route) => { if (hit) return route.fallback(); hit = route.request().url().replace(/^https?:\/\/[^/]+/, ''); return route.abort('connectionreset') })
    await page.goto(`/checkout/${bookingId}`)
    const usable = await page.getByRole('button', { name: 'Debit / Credit Card' }).waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
    await page.screenshot({ path: path.join(shots, `reset-${what.replace(/\W+/g, '-')}.png`) })
    results.push({ probe: `one reset on ${what}`, resetRequest: hit, pageUsableWithin20s: usable, endedOn: new URL(page.url()).pathname, guestSees: (await visibleText(page)).slice(0, 200) })
    save()
  })
}

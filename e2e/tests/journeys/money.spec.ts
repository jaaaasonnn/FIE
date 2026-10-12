import fs from 'fs'
import path from 'path'
import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes, until } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { cancel } from '../../lib/race'
import { cron, day, type Actor, type World } from '../../lib/world'

// Where money moves after the booking: cancelling under each policy, the
// payout and everything that holds it, problems reported and decided.
// Every amount is checked in the answer the person gets, in the database and
// at the fake Paystack.

const DAY = 86_400_000
const transfersFor = (bookingId: string) => fakes.transfers(`booking ${bookingId}`)
async function makeDue(id: string, hoursAfterCheckIn = 72) {
  const b = await db.booking.findUniqueOrThrow({ where: { id } })
  await ageBooking(id, (b.checkIn.getTime() - Date.now()) / DAY + hoursAfterCheckIn / 24)
}
async function paidStay(world: World, host: Actor, o: { price?: number; deposit?: number; policy?: string; daysAhead?: number; nights?: number } = {}) {
  const guest = await world.guest()
  const home = await world.listing(host, { priceNightly: o.price ?? 100, damageDeposit: o.deposit, cancellationPolicy: o.policy })
  const dates = o.daysAhead !== undefined ? { checkIn: day(o.daysAhead), checkOut: day(o.daysAhead + (o.nights ?? 2)) } : {}
  const { id, reference } = await world.paidBooking(guest, home.id, { nights: o.nights ?? 2, ...dates })
  return { guest, home, id, reference }
}

test.describe('cancelling a short stay: what comes back under each policy', () => {
  // $100 a night for 2 nights and a $50 deposit: $250 paid
  const cases: [policy: string, daysBefore: number, percent: number][] = [
    ['FLEXIBLE', 3, 100], ['FLEXIBLE', 1, 100],
    ['MODERATE', 6, 100], ['MODERATE', 5, 100], ['MODERATE', 4, 50], ['MODERATE', 1, 50],
    ['STRICT', 15, 100], ['STRICT', 14, 100], ['STRICT', 13, 50], ['STRICT', 7, 50], ['STRICT', 6, 0], ['STRICT', 1, 0],
  ]
  for (const [policy, daysBefore, percent] of cases) {
    test(`${policy}, ${daysBefore} day(s) before check-in: ${percent}% of the stay and all of the deposit`, async ({ world }) => {
      const host = await world.host()
      const { guest, id, reference } = await paidStay(world, host, { deposit: 50, policy, daysAhead: daysBefore })
      const expected = 200 * percent / 100 + 50
      const preview = (await guest.call('GET', `/api/bookings/${id}/cancellation`)).json.preview
      expect(preview).toMatchObject({ canCancel: true, paid: true, policy, paidAmount: 250 })
      expect(preview.quote.total).toBe(expected)
      // A different amount than the one shown is refused, and nothing changes
      const stale = await guest.call('PATCH', `/api/bookings/${id}`, { action: 'cancel', expectedRefund: expected + 1 })
      expect(stale.status).toBe(409)
      expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED')
      // No amount in the request can change what is refunded
      const done = await guest.call('PATCH', `/api/bookings/${id}`, { action: 'cancel', expectedRefund: expected, refund: 9999, amount: 9999 })
      expect(done.status, done.text).toBe(200)
      const row = await db.booking.findUniqueOrThrow({ where: { id }, include: { refund: true, payments: true } })
      expect(row.status).toBe('CANCELLED')
      expect(row.refund).toMatchObject({ amount: expected, stayRefund: 200 * percent / 100 })
      // The cedis sent back are the same share of the cedis that were charged
      const sent = await until(async () => { await cron('process-refunds'); const r = await fakes.refunds(reference); return r.length ? r : null }, 'the refund to reach Paystack')
      expect(sent).toHaveLength(1)
      expect(sent[0].amount).toBe(percent === 100 ? row.payments[0].amountPesewas : Math.round(row.payments[0].amountPesewas! * expected / 250))
      // Cancelled stays are never paid out, whatever the host was owed
      await makeDue(id)
      await cron('process-payouts')
      expect(await db.payout.count({ where: { bookingId: id } })).toBe(0)
      expect(await transfersFor(id)).toHaveLength(0)
      await expectInvariants()
    })
  }

  test('from the check-in day onwards the guest cannot cancel online', async ({ world }) => {
    const host = await world.host()
    const { guest, id } = await paidStay(world, host, { policy: 'FLEXIBLE' })
    const b = await db.booking.findUniqueOrThrow({ where: { id } })
    await ageBooking(id, Math.round((b.checkIn.getTime() - Date.now()) / DAY))
    const preview = (await guest.call('GET', `/api/bookings/${id}/cancellation`)).json.preview
    expect(preview.canCancel).toBe(false)
    expect((await cancel(guest, id)).status).toBeGreaterThanOrEqual(400)
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED')
  })

  test('the host cancels a confirmed booking: a reason is required, the guest gets everything back, admins are told', async ({ world }) => {
    const admin = await world.admin()
    const host = await world.host()
    const { guest, id, reference } = await paidStay(world, host, { deposit: 50, policy: 'STRICT', daysAhead: 3 })
    expect((await host.call('PATCH', `/api/bookings/${id}`, { action: 'host-cancel', expectedRefund: 250 })).status).toBe(400)
    const preview = (await host.call('GET', `/api/bookings/${id}/cancellation`)).json.preview
    // Strict, 3 days out: the guest cancelling would get the deposit only. The host cancelling returns it all.
    expect(preview.quote.total).toBe(250)
    // The reasons a host may give, read from the app's own list
    const source = fs.readFileSync(path.join(__dirname, '../../../src/lib/cancellationPolicy.ts'), 'utf8')
    const reasons = [.../([A-Z_]+):/g[Symbol.matchAll](/HOST_CANCEL_REASONS = \{([^}]+)\}/.exec(source)![1])].map((m) => m[1])
    const done = await host.call('PATCH', `/api/bookings/${id}`, { action: 'host-cancel', expectedRefund: 250, reason: reasons[0] })
    expect(done.status, done.text).toBe(200)
    expect(await db.refund.findUniqueOrThrow({ where: { bookingId: id } })).toMatchObject({ amount: 250 })
    await until(async () => { await cron('process-refunds'); return (await fakes.refunds(reference)).length === 1 }, 'the refund to reach Paystack')
    expect(await db.notification.count({ where: { userId: admin.id, type: 'HOST_CANCELLED_BOOKING', body: { contains: id } } })).toBe(1)
    await guest.mail(/cancel/i)
    await expectInvariants()
  })
})

test.describe('the payout and what holds it', () => {
  test('nothing is paid before 48 hours after check-in, and it is paid on the first run after', async ({ world }) => {
    const host = await world.host()
    const { id } = await paidStay(world, host, { price: 100 })
    await makeDue(id, 47)
    await cron('process-payouts')
    expect(await db.payout.count({ where: { bookingId: id } })).toBe(0)
    await makeDue(id, 49)
    await cron('process-payouts')
    await expect.poll(async () => (await db.payout.findFirst({ where: { bookingId: id } }))?.status).toBe('PROCESSING')
    // The host keeps 90% of the rent
    expect((await db.payout.findFirstOrThrow({ where: { bookingId: id } })).amount).toBe(180)
    expect(await transfersFor(id)).toHaveLength(1)
    await host.mail(/payout/i)
    await expectInvariants()
  })

  test('a host whose ID is not approved is not paid; the payout waits and goes out once an admin approves it', async ({ world }) => {
    const host = await world.host({ idApproved: false })
    const { id } = await paidStay(world, host)
    await makeDue(id)
    const run = await cron('process-payouts')
    expect(run.json.results.find((r: { bookingId: string }) => r.bookingId === id)?.action).toBe('waiting-for-host-id')
    expect(await db.payout.count({ where: { bookingId: id } })).toBe(0)
    expect(await transfersFor(id)).toHaveLength(0)
    // The host is told why, once
    await host.mail(/ID/)
    await cron('process-payouts')
    await cron('send-messages')
    expect(await db.messageLog.count({ where: { userId: host.id, event: 'payout.held_for_id', channel: 'EMAIL' } })).toBe(1)
    // The flag alone is not enough
    await db.user.update({ where: { id: host.id }, data: { isVerified: true } })
    await cron('process-payouts')
    expect(await transfersFor(id)).toHaveLength(0)
    await world.approveId(host)
    await cron('process-payouts')
    await expect.poll(async () => (await db.payout.findFirst({ where: { bookingId: id } }))?.status).toBe('PROCESSING')
    expect(await transfersFor(id)).toHaveLength(1)
    await expectInvariants()
  })

  test('a payout method saved less than 24 hours ago is not paid into yet', async ({ world }) => {
    const host = await world.host({ payoutMethod: false })
    const { id } = await paidStay(world, host)
    await makeDue(id)
    await world.givePayoutMethod(host, 23)
    const run = await cron('process-payouts')
    expect(run.json.results.find((r: { bookingId: string }) => r.bookingId === id)?.action).toBe('waiting-for-new-payout-method')
    expect(await transfersFor(id)).toHaveLength(0)
    await world.givePayoutMethod(host, 25)
    await cron('process-payouts')
    await expect.poll(async () => (await transfersFor(id)).length).toBe(1)
    await expectInvariants()
  })

  test('a suspended host is not paid; the payout waits and goes out when the account is restored', async ({ world }) => {
    const admin = await world.admin()
    const host = await world.host()
    const { id } = await paidStay(world, host)
    await makeDue(id)
    expect((await admin.call('POST', '/api/admin/users', { userId: host.id, action: 'suspend', reason: 'Held by the end-to-end payout test.' })).status).toBe(200)
    const run = await cron('process-payouts')
    expect(run.json.results.find((r: { bookingId: string }) => r.bookingId === id)?.action).toBe('waiting-for-suspension')
    expect(await db.payout.count({ where: { bookingId: id } })).toBe(0)
    expect((await admin.call('POST', '/api/admin/users', { userId: host.id, action: 'restore', reason: 'Released by the end-to-end payout test.' })).status).toBe(200)
    await cron('process-payouts')
    await expect.poll(async () => (await transfersFor(id)).length).toBe(1)
    await expectInvariants()
  })

  test('a payout over the transfer limit is held for a person and never sent or split', async ({ world }) => {
    const host = await world.host()
    // $2,000 a night for 2 nights: the host's share is about GH₵ 55,800, over the GH₵ 50,000 limit
    const { id } = await paidStay(world, host, { price: 2000 })
    await makeDue(id)
    await cron('process-payouts'); await cron('process-payouts')
    await expect.poll(async () => (await db.payout.findFirst({ where: { bookingId: id } }))?.status).toBe('HELD')
    expect(await db.payout.count({ where: { bookingId: id } })).toBe(1)
    expect(await transfersFor(id)).toHaveLength(0)
    await until(async () => (await fakes.sentry(id)).length > 0, 'a Sentry alert naming the booking')
    await expectInvariants()
  })

  test('a host saves a payout method: the account is looked up, and the host is told it changed', async ({ world }) => {
    // A number nobody else in any run has used (and not one the fake treats as unknown)
    const number = `024${String(1000000 + Math.floor(Math.random() * 8999998)).replace(/0000$/, '0001')}`
    const host = await world.host({ payoutMethod: false })
    const wrong = await host.call('POST', '/api/users/me/payout-method', { password: 'not-my-password', payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: number })
    expect(wrong.status).toBeGreaterThanOrEqual(400)
    const saved = await host.call('POST', '/api/users/me/payout-method', { password: host.password, payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: number })
    expect(saved.status, saved.text).toBe(200)
    const row = await db.user.findUniqueOrThrow({ where: { id: host.id } })
    expect(row.paystackRecipientCode).toMatch(/^RCP_/)
    expect(row.payoutMethodVerifiedAt).not.toBeNull()
    expect((await fakes.recipients(number))).toHaveLength(1)
    await host.mail(/payout method/i)
    // An account Paystack cannot find is refused and nothing is saved over the good one
    const bad = await host.call('POST', '/api/users/me/payout-method', { password: host.password, payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: '0241110000' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    expect((await db.user.findUniqueOrThrow({ where: { id: host.id } })).paystackRecipientCode).toBe(row.paystackRecipientCode)
  })
})

test.describe('a problem is reported and decided', () => {
  async function reported(world: World, o: { deposit?: number } = {}) {
    const admin = await world.admin()
    const host = await world.host()
    const stay = await paidStay(world, host, { price: 100, deposit: o.deposit })
    const b = await db.booking.findUniqueOrThrow({ where: { id: stay.id } })
    await ageBooking(stay.id, Math.round((b.checkIn.getTime() - Date.now()) / DAY)) // today is the check-in day
    const raised = await stay.guest.call('POST', `/api/bookings/${stay.id}/disputes`, { reason: 'NOT_AS_DESCRIBED', description: 'The flat in the photos is not the flat we were shown on arrival.' })
    expect(raised.status, raised.text).toBe(201)
    const decide = (outcome: string, amount?: number) => admin.call('POST', '/api/admin/disputes', { disputeId: raised.json.dispute.id, action: 'decide', outcome, amount, resolution: `Decided ${outcome} by the end-to-end test after reading both sides.` })
    return { ...stay, host, admin, disputeId: raised.json.dispute.id as string, decide }
  }

  test('while the report is open the host is not paid', async ({ world }) => {
    const { id } = await reported(world)
    await makeDue(id)
    await cron('process-payouts')
    expect(await db.payout.count({ where: { bookingId: id } })).toBe(0)
    expect(await transfersFor(id)).toHaveLength(0)
  })

  test('full refund: the guest gets everything, the host gets nothing', async ({ world }) => {
    const { id, reference, decide } = await reported(world, { deposit: 40 })
    expect((await decide('FULL_REFUND')).status).toBe(200)
    expect(await db.refund.findUniqueOrThrow({ where: { bookingId: id } })).toMatchObject({ reason: 'DISPUTE_FULL', amount: 240 })
    await until(async () => { await cron('process-refunds'); return (await fakes.refunds(reference)).length === 1 }, 'the refund to reach Paystack')
    await makeDue(id)
    await cron('process-payouts')
    expect(await transfersFor(id)).toHaveLength(0)
    await expectInvariants()
  })

  test('part refund of $60: the guest gets $60, the host is paid 90% of what is left', async ({ world }) => {
    const { id, reference, decide } = await reported(world)
    // More than the stay price, or nothing, is refused
    for (const bad of [0, -5, 200.01, 1e9]) expect((await decide('PARTIAL_REFUND', bad)).status, `amount ${bad}`).toBe(400)
    expect((await decide('PARTIAL_REFUND', 60)).status).toBe(200)
    expect(await db.refund.findUniqueOrThrow({ where: { bookingId: id } })).toMatchObject({ reason: 'DISPUTE_PARTIAL', amount: 60, stayRefund: 60 })
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId: id } })
    const sent = await until(async () => { await cron('process-refunds'); const r = await fakes.refunds(reference); return r.length ? r : null }, 'the refund to reach Paystack')
    expect(sent[0].amount).toBe(Math.round(payment.amountPesewas! * 60 / 200))
    await makeDue(id)
    await cron('process-payouts')
    await expect.poll(async () => (await db.payout.findFirst({ where: { bookingId: id } }))?.status).toBe('PROCESSING')
    expect((await db.payout.findFirstOrThrow({ where: { bookingId: id } })).amount).toBe(126) // 90% of (200 - 60)
    // A decision is final: it cannot be decided again
    expect((await decide('FULL_REFUND')).status).toBeGreaterThanOrEqual(400)
    expect(await db.refund.count({ where: { bookingId: id } })).toBe(1)
    await expectInvariants()
  })

  test('rejected: nothing is refunded and the host is paid as normal', async ({ world }) => {
    const { id, decide } = await reported(world)
    expect((await decide('REJECTED')).status).toBe(200)
    expect(await db.refund.count({ where: { bookingId: id } })).toBe(0)
    await makeDue(id)
    await cron('process-payouts')
    await expect.poll(async () => (await db.payout.findFirst({ where: { bookingId: id } }))?.amount).toBe(180)
    await expectInvariants()
  })

  test('only the guest of the booking can report, only in the window, and only an admin can decide', async ({ world }) => {
    const host = await world.host()
    const stranger = await world.guest()
    const { guest, id } = await paidStay(world, host)
    const report = (who: Actor) => who.call('POST', `/api/bookings/${id}/disputes`, { reason: 'NO_ACCESS', description: 'Nobody was there to let us in and the host did not answer.' })
    // Before the check-in day there is nothing to report yet
    expect((await report(guest)).status).toBeGreaterThanOrEqual(400)
    const b = await db.booking.findUniqueOrThrow({ where: { id } })
    await ageBooking(id, Math.round((b.checkIn.getTime() - Date.now()) / DAY) + 1) // the day after check-in
    expect((await report(stranger)).status).toBe(403)
    const raised = await report(guest)
    expect(raised.status).toBe(201)
    expect((await report(guest)).status, 'one report per side per booking').toBeGreaterThanOrEqual(400)
    for (const who of [guest, host, stranger]) {
      expect((await who.call('POST', '/api/admin/disputes', { disputeId: raised.json.dispute.id, action: 'decide', outcome: 'FULL_REFUND', resolution: 'I decide this myself, in my own favour.' })).status).toBe(403)
    }
    expect(await db.refund.count({ where: { bookingId: id } })).toBe(0)
  })

  test('evidence photos are private: only the two parties and admins can open them, through short-lived links', async ({ world }) => {
    const { guest, host, admin, disputeId, id } = await reported(world)
    const stranger = await world.guest()
    const form = new FormData(); form.append('photos', new File([fs.readFileSync(path.join(__dirname, '../../fixtures/photo.jpg'))], 'proof.jpg', { type: 'image/jpeg' }))
    const up = await guest.call('POST', `/api/disputes/${disputeId}/evidence`, undefined, { form })
    expect(up.status, up.text).toBe(201)
    const files = await fakes.files('dispute-evidence/')
    expect(files.some((f) => f.includes(disputeId) || f.includes(id))).toBe(true)
    for (const who of [guest, host, admin]) {
      const seen = await who.call('GET', `/api/bookings/${id}/disputes`)
      expect(seen.status).toBe(200)
      expect(seen.text).toContain('/object/sign/dispute-evidence/')
      expect(seen.text).not.toContain('/object/public/dispute-evidence/')
    }
    expect((await stranger.call('GET', `/api/bookings/${id}/disputes`)).status).toBe(403)
  })
})

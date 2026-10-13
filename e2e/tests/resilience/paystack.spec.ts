import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes, until } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { measured } from '../../lib/race'
import { APP, cron, type Actor, type World } from '../../lib/world'

// Paystack misbehaving: errors, nonsense, silence, and the wrong amount.
// Each rule matches one booking, so these run beside everything else.

/** Nothing from inside the server may reach the person: no stack trace, no library name, no key. */
const NO_LEAK = /at .*\(.*:\d+:\d+\)|node_modules|prisma|sk_test|ECONNREFUSED|\bstack\b/i
async function unpaid(world: World) {
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host, { priceNightly: 100 })
  const id = await world.mustBook(guest, home.id)
  return { host, guest, id }
}
const DAY = 86_400_000
async function due(world: World, host: Actor) {
  const guest = await world.guest()
  const home = await world.listing(host, { priceNightly: 100 })
  const { id, reference } = await world.paidBooking(guest, home.id, { nights: 2 })
  const b = await db.booking.findUniqueOrThrow({ where: { id } })
  await ageBooking(id, Math.ceil((b.checkIn.getTime() - Date.now()) / DAY) + 3)
  return { id, reference, guest }
}

test.describe('Paystack fails when a payment is started', () => {
  for (const [behaviour, what] of [['http500', 'answers 500'], ['malformed', 'answers nonsense'], ['empty', 'answers nothing'], ['reset', 'drops the connection'], ['http429', 'says too many requests']] as const) {
    test(`Paystack ${what}: the guest is told plainly, nothing is half-made, and trying again works`, async ({ world }) => {
      const { guest, id } = await unpaid(world)
      const undo = await fakes.rule('initialize', behaviour, { match: id })
      const failed = await world.startPayment(guest, id)
      expect(failed.status, failed.text).toBe(502)
      expect(failed.text).not.toMatch(NO_LEAK)
      expect(failed.json.error).toBeTruthy()
      const payments = await db.payment.findMany({ where: { bookingId: id } })
      // The attempt is closed, whatever went wrong, so nothing is left half open
      expect(payments.map((p) => p.status)).toEqual(['FAILED'])
      expect((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('UNPAID')
      await undo()
      const again = await world.startPayment(guest, id)
      expect(again.status, again.text).toBe(200)
      await fakes.setTx(again.reference!, { status: 'success' })
      await world.verify(guest, again.reference!)
      expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
      await expectInvariants()
    })
  }

  test('Paystack never answers: the guest is not left waiting for ever', async ({ world }) => {
    const { guest, id } = await unpaid(world)
    const undo = await fakes.rule('initialize', 'hang', { match: id })
    const started = Date.now()
    const reply = await world.startPayment(guest, id, { timeoutMs: 20_000 })
    measured(`with Paystack silent, starting a payment ${reply.status === 0 ? 'had not answered after' : `answered ${reply.status} after`} ${Math.round((Date.now() - started) / 1000)} s`)
    await undo()
    expect(reply.status, 'an answer within 20 seconds').toBe(502)
    expect(reply.json.error).toBe('Paystack is not answering. Please try again in a moment.')
    // The attempt is closed, nothing is paid, and trying again works
    expect((await db.payment.findMany({ where: { bookingId: id } })).map((p) => p.status)).toEqual(['FAILED'])
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('UNPAID')
    expect((await world.startPayment(guest, id)).status).toBe(200)
  })
})

test.describe('Paystack fails when the guest comes back', () => {
  for (const [behaviour, what] of [['http500', 'answers 500'], ['malformed', 'answers nonsense'], ['reset', 'drops the connection']] as const) {
    test(`verify ${what}: the guest paid, sees "still being checked", and is confirmed once Paystack is back`, async ({ world }) => {
      const { guest, id } = await unpaid(world)
      const pay = await world.startPayment(guest, id)
      await fakes.setTx(pay.reference!, { status: 'success' })
      const undo = await fakes.rule('verify', behaviour, { match: pay.reference })
      const back = await world.verify(guest, pay.reference!)
      expect(back.status).toBe(307)
      expect(back.headers.get('location')).not.toContain('payment=success')
      // Not confirmed on a guess, and not marked failed either: the money may well have been taken
      expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ paymentStatus: 'UNPAID' })
      expect((await db.payment.findFirstOrThrow({ where: { bookingId: id } })).status).toBe('PENDING')
      await undo()
      await fakes.webhook(APP[1], 'charge.success', { reference: pay.reference })
      expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
      await expectInvariants()
    })
  }

  test('Paystack says less was paid than was asked: not confirmed, flagged, and Sentry is told', async ({ world }) => {
    const { guest, id } = await unpaid(world)
    const pay = await world.startPayment(guest, id)
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId: id } })
    await fakes.setTx(pay.reference!, { status: 'success', paidAmount: payment.amountPesewas! - 1 })
    await world.verify(guest, pay.reference!)
    await fakes.webhook(APP[0], 'charge.success', { reference: pay.reference, times: 3 })
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('MISMATCH')
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ paymentStatus: 'UNPAID' })
    await until(async () => (await fakes.sentry(id)).some((e) => e.includes('does not match')), 'a Sentry report naming the booking')
    await expectInvariants()
  })

  test('Paystack says it was paid in another currency: not confirmed', async ({ world }) => {
    const { guest, id } = await unpaid(world)
    const pay = await world.startPayment(guest, id)
    await fakes.setTx(pay.reference!, { status: 'success', paidCurrency: 'NGN' })
    await world.verify(guest, pay.reference!)
    expect((await db.payment.findFirstOrThrow({ where: { bookingId: id } })).status).toBe('MISMATCH')
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('UNPAID')
  })

  for (const outcome of ['failed', 'abandoned'] as const) {
    test(`the card is ${outcome === 'failed' ? 'declined' : 'never entered'}: not confirmed, and the guest can pay again`, async ({ world }) => {
      const { guest, id } = await unpaid(world)
      const pay = await world.startPayment(guest, id)
      await fakes.setTx(pay.reference!, { status: outcome })
      const back = await world.verify(guest, pay.reference!)
      expect(back.headers.get('location')).not.toContain('payment=success')
      expect((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('UNPAID')
      const again = await world.startPayment(guest, id)
      expect(again.status, again.text).toBe(200)
      await fakes.setTx(again.reference!, { status: 'success' })
      await world.verify(guest, again.reference!)
      expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
      expect((await db.payment.findMany({ where: { bookingId: id, status: 'SUCCESS' } }))).toHaveLength(1)
      await expectInvariants()
    })
  }
})

test.describe('Paystack fails when money is sent out', () => {
  for (const [behaviour, what] of [['http500', 'answers 500'], ['malformed', 'answers nonsense'], ['reset', 'drops the connection']] as const) {
    test(`a transfer ${what}: recorded as failed with the reason, nothing paid, and paid once when retried`, async ({ world }) => {
      const host = await world.host()
      const { id } = await due(world, host)
      const undo = await fakes.rule('transfer', behaviour, { match: `booking ${id}`, times: 1 })
      const run = await cron('process-payouts')
      expect(run.status).toBe(200)
      const payout = await db.payout.findFirstOrThrow({ where: { bookingId: id } })
      expect(payout.status, payout.failureReason ?? '').toBe('FAILED')
      expect(payout.failureReason).toBeTruthy()
      expect(await fakes.transfers(`booking ${id}`)).toHaveLength(0)
      await undo()
      await db.payout.update({ where: { id: payout.id }, data: { lastFailedAt: new Date(Date.now() - 2 * 3_600_000) } })
      await cron('process-payouts')
      // (another test's run of the job may be half way through this payout: wait for it to settle)
      await expect.poll(async () => (await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).not.toBe('PENDING')
      const after = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })
      measured(`after Paystack ${what} on a transfer, the next run left the payout ${after.status} (retries ${after.retryCount}): ${after.failureReason ?? 'no reason'}`)
      expect((await fakes.transfers(`booking ${id}`)).length).toBeLessThanOrEqual(1)
      await expectInvariants()
    })
  }

  test('a refund fails at Paystack: recorded, the guest is not told it was sent, and it goes once Paystack is back', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { priceNightly: 90, cancellationPolicy: 'FLEXIBLE' })
    const { id, reference } = await world.paidBooking(guest, home.id)
    // Paystack is already failing when the guest cancels (the refund is first tried there and then)
    const undo = await fakes.rule('refund', 'http500', { match: reference })
    const preview = await guest.call('GET', `/api/bookings/${id}/cancellation`)
    const cancelled = await guest.call('PATCH', `/api/bookings/${id}`, { action: 'cancel', expectedRefund: preview.json.preview.quote.total })
    // The cancellation itself stands: the refund is owed, whatever Paystack is doing
    expect(cancelled.status, cancelled.text).toBe(200)
    await cron('process-refunds')
    const failed = await db.refund.findUniqueOrThrow({ where: { bookingId: id } })
    expect(['FAILED', 'PENDING', 'NEEDS_ATTENTION']).toContain(failed.status)
    expect(await fakes.refunds(reference)).toHaveLength(0)
    expect(await db.messageLog.count({ where: { bookingId: id, event: 'refund.sent' } })).toBe(0)
    await undo()
    await db.refund.update({ where: { id: failed.id }, data: { lastFailedAt: new Date(Date.now() - 3 * 3_600_000) } })
    await cron('process-refunds')
    const after = await db.refund.findUniqueOrThrow({ where: { bookingId: id } })
    measured(`after one failed attempt, the refund job left the refund ${after.status} (${(await fakes.refunds(reference)).length} sent to Paystack)`)
    expect((await fakes.refunds(reference)).length).toBeLessThanOrEqual(1)
    await expectInvariants()
  })
})

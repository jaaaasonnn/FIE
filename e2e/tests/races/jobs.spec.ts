import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { allowForRounds, ROUNDS, cancel, serverErrors, together } from '../../lib/race'
import { APP, cron, type Actor, type World } from '../../lib/world'

test.beforeEach(allowForRounds)

// Jobs that overlap: Vercel can start an hourly cron on two instances, a
// retry can meet the normal run, an admin can press a button twice.

const DAY = 86_400_000
/** A paid short stay whose check-in was three days ago, so the host's payout is due. */
async function duePayout(world: World, host: Actor, price = 100): Promise<string> {
  const guest = await world.guest()
  const home = await world.listing(host, { priceNightly: price })
  const { id } = await world.paidBooking(guest, home.id, { nights: 2 })
  const booking = await db.booking.findUniqueOrThrow({ where: { id } })
  await ageBooking(id, Math.ceil((booking.checkIn.getTime() - Date.now()) / DAY) + 3)
  return id
}
const transfersFor = async (bookingId: string) => (await fakes.transfers(`booking ${bookingId}`))

test.describe('races: payouts', () => {
  test('the payout job starts on two servers at the same moment: every host is paid once', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < Math.max(1, Math.ceil(ROUNDS / 3)); round++) {
      const bookings = await Promise.all([duePayout(world, host, 100), duePayout(world, host, 130), duePayout(world, host, 75)])
      const runs = await together(() => cron('process-payouts', { server: 0 }), () => cron('process-payouts', { server: 1 }), () => cron('process-payouts', { server: 0 }), () => cron('process-payouts', { server: 1 }))
      expect(serverErrors(runs), `round ${round}`).toEqual([])
      for (const id of bookings) {
        const booking = await db.booking.findUniqueOrThrow({ where: { id }, include: { payouts: true } })
        expect(booking.payouts, `round ${round}: one payout row for ${id}`).toHaveLength(1)
        expect(booking.payouts[0]).toMatchObject({ status: 'PROCESSING', amount: Math.round(booking.subtotal * 0.9 * 100) / 100 })
        const transfers = await transfersFor(id)
        expect(transfers, `round ${round}: Paystack was asked to pay ${id} ${transfers.length} times`).toHaveLength(1)
        // The cedis sent are the host's share of what the guest paid, to the pesewa
        const payment = await db.payment.findFirstOrThrow({ where: { bookingId: id, status: 'SUCCESS' } })
        // (within one pesewa: the app converts the host's dollar share again instead of taking 90% of the pesewas charged)
        expect(Math.abs(transfers[0].amount - payment.amountPesewas! * 0.9)).toBeLessThanOrEqual(1)
        expect(transfers[0].recipient).toBe(`RCP_e2e_${host.id}`)
      }
    }
    await expectInvariants()
  })

  test('a failed payout is retried while the normal job runs: still paid once', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < Math.max(1, Math.ceil(ROUNDS / 3)); round++) {
      const id = await duePayout(world, host)
      const undo = await fakes.rule('transfer', 'http500', { match: `booking ${id}`, times: 1 })
      await cron('process-payouts')
      const failed = await db.payout.findFirstOrThrow({ where: { bookingId: id } })
      expect(failed.status, `after Paystack answered 500: ${failed.failureReason}`).toBe('FAILED')
      expect(await transfersFor(id)).toHaveLength(0)
      await undo()
      // More than the retry delay passes
      await db.payout.update({ where: { id: failed.id }, data: { lastFailedAt: new Date(Date.now() - 2 * 3_600_000) } })
      const runs = await together(() => cron('process-payouts', { server: 0 }), () => cron('process-payouts', { server: 1 }), () => cron('process-payouts', { server: 1 }))
      expect(serverErrors(runs), `round ${round}`).toEqual([])
      const payouts = await db.payout.findMany({ where: { bookingId: id } })
      expect(payouts).toHaveLength(1)
      expect(payouts[0], `round ${round}: ${payouts[0].failureReason}`).toMatchObject({ status: 'PROCESSING', retryCount: 1 })
      expect(await transfersFor(id), `round ${round}`).toHaveLength(1)
    }
    await expectInvariants()
  })

  test('Paystack says the same transfer succeeded ten times: the payout completes once and the host is told once', async ({ world }) => {
    const host = await world.host()
    const id = await duePayout(world, host)
    await cron('process-payouts')
    const payout = await db.payout.findFirstOrThrow({ where: { bookingId: id } })
    const sent = await fakes.webhook(APP[0], 'transfer.success', { reference: payout.paystackTransferReference!, times: 10 })
    expect(sent.statuses.every((s) => s === 200)).toBe(true)
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ status: 'COMPLETED' })
    // The host is told once that the money was sent
    await expect.poll(() => db.messageLog.count({ where: { userId: host.id, event: 'payout.sent', channel: 'EMAIL' } })).toBe(1)
    await expectInvariants()
  })
})

test.describe('races: refunds', () => {
  test('the refund job starts on two servers at once: the guest is refunded once, the right amount', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < Math.max(1, Math.ceil(ROUNDS / 3)); round++) {
      const guest = await world.guest()
      const home = await world.listing(host, { priceNightly: 90, cancellationPolicy: 'FLEXIBLE' })
      const { id, reference } = await world.paidBooking(guest, home.id, { nights: 2 })
      const cancelled = await cancel(guest, id)
      expect(cancelled.status, cancelled.text).toBe(200)
      const refund = await db.refund.findUniqueOrThrow({ where: { bookingId: id } })
      expect(refund.amount).toBe(180)
      const runs = await together(() => cron('process-refunds', { server: 0 }), () => cron('process-refunds', { server: 1 }), () => cron('process-refunds', { server: 0 }))
      expect(serverErrors(runs), `round ${round}`).toEqual([])
      const atPaystack = await fakes.refunds(reference)
      expect(atPaystack, `round ${round}: Paystack was asked to refund ${atPaystack.length} times`).toHaveLength(1)
      const payment = await db.payment.findFirstOrThrow({ where: { bookingId: id } })
      expect(atPaystack[0].amount).toBe(payment.amountPesewas)
      expect((await db.refund.findUniqueOrThrow({ where: { bookingId: id } })).status).toBe('PROCESSING')
    }
    await expectInvariants()
  })

  test('the guest presses cancel twice: one refund is recorded', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { priceNightly: 90, cancellationPolicy: 'FLEXIBLE' })
    const { id } = await world.paidBooking(guest, home.id, { nights: 2 })
    const replies = await together(() => cancel(guest, id, { server: 0 }), () => cancel(guest, id, { server: 1 }), () => cancel(guest, id, { server: 0 }))
    expect(serverErrors(replies)).toEqual([])
    expect(replies.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1)
    expect(await db.refund.count({ where: { bookingId: id } })).toBe(1)
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CANCELLED' })
    await expectInvariants()
  })
})

test.describe('races: admins', () => {
  test('two admins decide the same dispute differently at the same moment: one decision stands', async ({ world }) => {
    const host = await world.host()
    const [akua, yaw] = [await world.admin(), await world.admin()]
    for (let round = 0; round < Math.max(1, Math.ceil(ROUNDS / 3)); round++) {
      const guest = await world.guest()
      const home = await world.listing(host, { priceNightly: 100 })
      const { id } = await world.paidBooking(guest, home.id, { nights: 2 })
      const booking = await db.booking.findUniqueOrThrow({ where: { id } })
      // Today is the check-in day: the guest may report a problem
      await ageBooking(id, Math.round((booking.checkIn.getTime() - Date.now()) / DAY))
      const raised = await guest.call('POST', `/api/bookings/${id}/disputes`, { reason: 'NO_ACCESS', description: 'Nobody was there to let us in and the host did not answer the phone.' })
      expect(raised.status, raised.text).toBe(201)
      const disputeId = raised.json.dispute.id
      const decide = (admin: Actor, outcome: string, server: 0 | 1) => admin.call('POST', '/api/admin/disputes', { disputeId, action: 'decide', outcome, resolution: `Decided ${outcome} in the end-to-end race test, after reading both sides.` }, { server })
      const replies = await together(() => decide(akua, 'FULL_REFUND', 0), () => decide(yaw, 'REJECTED', 1))
      expect(serverErrors(replies), `round ${round}`).toEqual([])
      expect(replies.filter((r) => r.status === 200), `round ${round}: ${replies.map((r) => `${r.status} ${r.text.slice(0, 80)}`)}`).toHaveLength(1)
      const dispute = await db.dispute.findUniqueOrThrow({ where: { id: disputeId } })
      const refund = await db.refund.findUnique({ where: { bookingId: id } })
      const state = `round ${round}: dispute ${dispute.status}/${dispute.outcome}, refund ${refund?.reason ?? 'none'}`
      expect(['FULL_REFUND', 'REJECTED'], state).toContain(dispute.outcome)
      // The money follows the decision that stands, and only that one
      if (dispute.outcome === 'FULL_REFUND') expect(refund, state).toMatchObject({ reason: 'DISPUTE_FULL', amount: 200 })
      else expect(refund, state).toBeNull()
    }
    await expectInvariants()
  })
})

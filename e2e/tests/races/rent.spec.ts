import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { allowForRounds, serverErrors, together } from '../../lib/race'
import { day, type Actor, type World } from '../../lib/world'

test.beforeEach(allowForRounds)

// Rent paid by the month: the same button pressed twice, the same instalment paid twice.

const DAY = 86_400_000
const plusMonths = (iso: string, months: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10) }

/** A three-month stay at $600 a month with a $300 deposit, first month and deposit paid. */
async function tenancy(world: World, host: Actor) {
  const guest = await world.guest()
  const home = await world.listing(host, { rentalModes: ['TEMP_STAY'], priceMonthly: 600, damageDeposit: 300, priceNightly: undefined })
  const checkIn = day(40 + Math.floor(Math.random() * 200))
  const { id } = await world.paidBooking(guest, home.id, { rentalMode: 'TEMP_STAY', checkIn, checkOut: plusMonths(checkIn, 3) })
  const instalments = await db.instalment.findMany({ where: { bookingId: id }, orderBy: { sequence: 'asc' } })
  return { guest, id, instalments }
}
/** Moves the tenancy back so that this instalment fell due `daysAgo` days ago. */
async function makeLate(bookingId: string, dueDate: Date, daysAgo: number) {
  await ageBooking(bookingId, Math.ceil((dueDate.getTime() - Date.now()) / DAY) + daysAgo)
}

test.describe('races: rent', () => {
  test('the first payment of a monthly stay is the first month and the deposit, and the instalments add up', async ({ world }) => {
    const host = await world.host()
    const { id, instalments } = await tenancy(world, host)
    const booking = await db.booking.findUniqueOrThrow({ where: { id }, include: { payments: true } })
    expect(instalments.map((i) => [i.sequence, i.amount, i.depositAmount, i.status])).toEqual([[1, 600, 300, 'PAID'], [2, 600, 0, 'PENDING'], [3, 600, 0, 'PENDING']])
    expect(booking).toMatchObject({ subtotal: 1800, damageDeposit: 300, totalPrice: 2100, status: 'CONFIRMED', paymentStatus: 'PAID' })
    expect(booking.payments).toHaveLength(1)
    expect(booking.payments[0]).toMatchObject({ amount: 900, status: 'SUCCESS', instalmentId: instalments[0].id })
    const [tx] = await fakes.tx(id)
    expect(tx.amount).toBe(booking.payments[0].amountPesewas)
    await expectInvariants()
  })

  test('an admin presses "cover from deposit" three times at once: the deposit is used once', async ({ world }) => {
    const host = await world.host()
    const admin = await world.admin()
    const { id, instalments } = await tenancy(world, host)
    await makeLate(id, instalments[1].dueDate, 5)
    const cover = (server: 0 | 1) => admin.call('POST', '/api/admin/rent', { action: 'cover', instalmentId: instalments[1].id }, { server })
    const replies = await together(() => cover(0), () => cover(1), () => cover(0))
    expect(serverErrors(replies)).toEqual([])
    expect(replies.filter((r) => r.status === 200), replies.map((r) => `${r.status} ${r.text.slice(0, 100)}`).join(' | ')).toHaveLength(1)
    const after = await db.instalment.findUniqueOrThrow({ where: { id: instalments[1].id } })
    // $300 of deposit against $600 of rent: half is covered, the tenant still owes the rest
    expect(after).toMatchObject({ status: 'PART_COVERED', coveredFromDeposit: 300, coveredById: admin.id })
    // Nothing is left to cover a second time
    const again = await cover(1)
    expect(again.status, again.text).not.toBe(200)
    expect((await db.instalment.findUniqueOrThrow({ where: { id: instalments[1].id } })).coveredFromDeposit).toBe(300)
    const total = await db.instalment.aggregate({ where: { bookingId: id }, _sum: { coveredFromDeposit: true } })
    expect(total._sum.coveredFromDeposit).toBeLessThanOrEqual(300)
    await expectInvariants()
  })

  test('the tenant pays the same month from two tabs: charged for it once', async ({ world }) => {
    const host = await world.host()
    const { guest, id, instalments } = await tenancy(world, host)
    await makeLate(id, instalments[1].dueDate, 0) // the second month starts today
    // A month cannot be paid while an earlier one is owed
    const outOfOrder = await world.startPayment(guest, id, { instalmentId: instalments[2].id })
    expect(outOfOrder.status, outOfOrder.text).toBeGreaterThanOrEqual(400)
    const before = (await fakes.tx(id)).length
    const starts = await together(() => world.startPayment(guest, id, { instalmentId: instalments[1].id, server: 0 }), () => world.startPayment(guest, id, { instalmentId: instalments[1].id, server: 1 }))
    expect(serverErrors(starts)).toEqual([])
    const opened = (await fakes.tx(id)).filter((t) => t.status === 'pending')
    expect(opened.length).toBeGreaterThan(0)
    expect((await fakes.tx(id)).length - before).toBe(opened.length)
    for (const tx of opened) await fakes.setTx(tx.reference, { status: 'success' })
    await together(...opened.map((tx, i) => () => world.verify(guest, tx.reference, { server: (i % 2) as 0 | 1 })))
    const payments = await db.payment.findMany({ where: { instalmentId: instalments[1].id } })
    expect(payments.filter((p) => p.status === 'SUCCESS'), JSON.stringify(payments.map((p) => p.status))).toHaveLength(1)
    expect(payments.filter((p) => p.status === 'DUPLICATE')).toHaveLength(opened.length - 1)
    expect((await db.instalment.findUniqueOrThrow({ where: { id: instalments[1].id } })).status).toBe('PAID')
    await expectInvariants()
  })
})

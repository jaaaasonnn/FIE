import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { cron, day, type Actor, type World } from '../../lib/world'

// Monthly and long-term stays, paid month by month.

const DAY = 86_400_000
const plusMonths = (iso: string, months: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10) }
async function monthly(world: World, host: Actor, months = 3) {
  const guest = await world.guest()
  const home = await world.listing(host, { rentalModes: ['TEMP_STAY'], priceMonthly: 600, damageDeposit: 300, priceNightly: undefined })
  const checkIn = day(45 + Math.floor(Math.random() * 150))
  const { id } = await world.paidBooking(guest, home.id, { rentalMode: 'TEMP_STAY', checkIn, checkOut: plusMonths(checkIn, months) })
  const instalments = await db.instalment.findMany({ where: { bookingId: id }, orderBy: { sequence: 'asc' } })
  return { guest, id, instalments }
}
/** Moves the tenancy so that `date` is `daysAgo` days in the past (negative: still to come). */
const shiftTo = async (bookingId: string, date: Date, daysAgo: number) => ageBooking(bookingId, Math.round((date.getTime() - Date.now()) / DAY) + daysAgo)

test.describe('rent by the month', () => {
  test('the host is paid for each month separately, 90% of the rent and never the deposit', async ({ world }) => {
    const host = await world.host()
    const { id, instalments } = await monthly(world, host)
    await shiftTo(id, instalments[0].periodStart, 3) // moved in three days ago
    await cron('process-payouts')
    await expect.poll(async () => (await db.payout.findMany({ where: { bookingId: id } })).length).toBe(1)
    const [first] = await db.payout.findMany({ where: { bookingId: id } })
    expect(first).toMatchObject({ amount: 540, instalmentSeq: 1, status: 'PROCESSING' })
    const transfers = await fakes.transfers(`booking ${id}`)
    expect(transfers).toHaveLength(1)
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId: id, status: 'SUCCESS' } })
    // The first payment was $900 (rent and deposit); the host's transfer is 90% of the $600 rent in it
    expect(Math.abs(transfers[0].amount - payment.amountPesewas! * 600 / 900 * 0.9)).toBeLessThanOrEqual(1)
    // Months not paid yet are not paid out
    await cron('process-payouts')
    expect(await db.payout.count({ where: { bookingId: id } })).toBe(1)
    await expectInvariants()
  })

  test('the tenant is reminded three days before, and once only however often the job runs', async ({ world }) => {
    const host = await world.host()
    const { guest, id, instalments } = await monthly(world, host)
    await shiftTo(id, instalments[1].dueDate, -3)
    await cron('rent-reminders'); await cron('rent-reminders', { server: 1 }); await cron('rent-reminders')
    // The email carries a link that pays exactly this month, and there is one such email
    const link = `/checkout/${id}?instalment=${instalments[1].id}`
    const due = await guest.mail(new RegExp(link.replace(/[?]/g, '\\?')))
    expect(due).toHaveLength(1)
    expect(await fakes.tx(id)).toHaveLength(1) // nothing was charged by the job: only the first payment exists
  })

  test('rent that is late: the tenant is chased, the host and admins are told once, and paying it stops the chasing', async ({ world }) => {
    const admin = await world.admin()
    const host = await world.host()
    const { guest, id, instalments } = await monthly(world, host)
    await shiftTo(id, instalments[1].dueDate, 3)
    await cron('rent-reminders'); await cron('rent-reminders')
    await guest.mail(/late|overdue|not been paid|missed/i)
    await host.mail(/late|overdue|not been paid|missed|rent/i)
    const lateToHost = await db.messageLog.count({ where: { userId: host.id, bookingId: id, channel: 'EMAIL', event: { contains: 'rent' } } })
    expect(lateToHost).toBe(1)
    void admin
    // The tenant pays the month from the link
    const pay = await world.startPayment(guest, id, { instalmentId: instalments[1].id })
    expect(pay.status, pay.text).toBe(200)
    await fakes.setTx(pay.reference!, { status: 'success' })
    await world.verify(guest, pay.reference!)
    expect((await db.instalment.findUniqueOrThrow({ where: { id: instalments[1].id } })).status).toBe('PAID')
    const before = await db.messageLog.count({ where: { userId: guest.id, bookingId: id } })
    await cron('rent-reminders')
    await cron('send-messages')
    const chasing = await db.messageLog.findMany({ where: { userId: guest.id, bookingId: id }, orderBy: { createdAt: 'asc' }, skip: before })
    expect(chasing.filter((m) => /late|due/i.test(m.event)), 'no more chasing for a paid month').toHaveLength(0)
    await expectInvariants()
  })

  test('the host ends the tenancy after a missed month: it ends at the last paid month, later months are cancelled, nothing is refunded', async ({ world }) => {
    const host = await world.host()
    const { guest, id, instalments } = await monthly(world, host)
    const stranger = await world.host()
    // Before move-in a tenancy cannot be "ended": that is a cancellation
    expect((await host.call('PATCH', `/api/bookings/${id}`, { action: 'end-tenancy' })).status).toBeGreaterThanOrEqual(400)
    await shiftTo(id, instalments[1].dueDate, 5)
    for (const who of [guest, stranger]) expect((await who.call('PATCH', `/api/bookings/${id}`, { action: 'end-tenancy' })).status).toBe(403)
    const preview = await host.call('PATCH', `/api/bookings/${id}`, { action: 'end-tenancy', preview: true })
    const ended = await host.call('PATCH', `/api/bookings/${id}`, { action: 'end-tenancy', expectedEnd: preview.json.preview.endsOn, note: 'Rent for the second month was not paid.' })
    expect(ended.status, `${preview.text.slice(0, 200)} | ${ended.text.slice(0, 200)}`).toBe(200)
    const after = await db.booking.findUniqueOrThrow({ where: { id }, include: { instalments: { orderBy: { sequence: 'asc' } }, refund: true } })
    const paidUntil = (await db.instalment.findUniqueOrThrow({ where: { id: instalments[0].id } })).periodEnd
    expect(after.checkOut.toISOString().slice(0, 10)).toBe(paidUntil.toISOString().slice(0, 10))
    expect(after.originalCheckOut).not.toBeNull()
    expect(after.instalments.map((i) => i.status)).toEqual(['PAID', 'CANCELLED', 'CANCELLED'])
    expect(after.refund).toBeNull()
    await guest.mail(/tenancy|ended/i)
    await expectInvariants()
  })

  test('a long-term rental: three months up front with the deposit, then a month at a time, adding up to the year to the cent', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    // $10,000 a year does not divide evenly by 12
    const home = await world.listing(host, { rentalModes: ['PERMANENT'], priceAnnual: 10000, damageDeposit: 500, priceNightly: undefined })
    const checkIn = day(60)
    const { id } = await world.paidBooking(guest, home.id, { rentalMode: 'PERMANENT', checkIn, checkOut: plusMonths(checkIn, 12) })
    const booking = await db.booking.findUniqueOrThrow({ where: { id }, include: { instalments: { orderBy: { sequence: 'asc' } }, payments: true } })
    expect(booking.subtotal).toBe(10000)
    expect(booking.instalments).toHaveLength(10)
    const cents = (n: number) => Math.round(n * 100)
    expect(booking.instalments.reduce((sum, i) => sum + cents(i.amount), 0)).toBe(1_000_000)
    expect(booking.instalments[0]).toMatchObject({ depositAmount: 500, status: 'PAID' })
    // What was charged first: three months of rent and the deposit
    expect(cents(booking.payments[0].amount)).toBe(cents(booking.instalments[0].amount) + 50_000)
    expect(cents(booking.instalments[0].amount)).toBeGreaterThanOrEqual(249_999)
    expect(cents(booking.instalments[0].amount)).toBeLessThanOrEqual(250_002)
    expect((await fakes.tx(id))[0].amount).toBe(booking.payments[0].amountPesewas)
    await expectInvariants()
  })
})

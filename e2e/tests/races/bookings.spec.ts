import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { allowForRounds, ROUNDS, cancel, measured, serverErrors, statuses, together } from '../../lib/race'
import { APP, cron } from '../../lib/world'

test.beforeEach(allowForRounds)

// Two people at the same instant. Every pair of requests goes to two
// different server processes, as two Vercel instances would get them.

test.describe('races: dates', () => {
  test('two guests book the same dates at the same instant: exactly one gets them', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    for (let round = 0; round < ROUNDS; round++) {
      const [ama, kofi] = [await world.guest(), await world.guest()]
      const dates = world.dates(2)
      const replies = await together(() => world.book(ama, home.id, { ...dates, server: 0 }), () => world.book(kofi, home.id, { ...dates, server: 1 }))
      expect(serverErrors(replies), `round ${round}`).toEqual([])
      const won = replies.filter((r) => r.status === 201).length
      // One winner, every round: never both, and never neither (which would leave the dates unsold)
      expect(won, `round ${round}: ${JSON.stringify(statuses(replies))}`).toBe(1)
      for (const lost of replies.filter((r) => r.status !== 201)) expect(lost.status).toBe(409)
    }
    await expectInvariants()
  })

  test('a guest books while the host blocks the same dates: only one of the two happens', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < ROUNDS; round++) {
      const guest = await world.guest()
      const home = await world.listing(host)
      const dates = world.dates(2)
      const [booked, blocked] = await together(
        () => world.book(guest, home.id, { ...dates, server: 0 }),
        () => host.call('POST', `/api/listings/${home.id}/blocked-dates`, { start: dates.checkIn, end: dates.checkOut, note: 'e2e' }, { server: 1 }),
      )
      expect(serverErrors([booked, blocked]), `round ${round}`).toEqual([])
      const live = await db.booking.count({ where: { listingId: home.id, status: { notIn: ['CANCELLED', 'DECLINED'] } } })
      const hostBlocks = await db.blockedDate.count({ where: { listingId: home.id, reason: 'HOST' } })
      expect(live > 0 && hostBlocks > 0, `round ${round}: booking ${booked.status}, block ${blocked.status}, ${live} booking(s) and ${hostBlocks} host-blocked day(s) on the same dates`).toBe(false)
    }
    await expectInvariants()
  })

  test('the host accepts a request while the guest withdraws it: the booking ends in one clear state', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < ROUNDS; round++) {
      const guest = await world.guest()
      const home = await world.listing(host, { instantBook: false })
      const dates = world.dates(2)
      const id = await world.mustBook(guest, home.id, dates)
      const [accepted, withdrawn] = await together(
        () => host.call('PATCH', `/api/bookings/${id}`, { action: 'accept' }, { server: 0 }),
        () => cancel(guest, id, { server: 1 }),
      )
      expect(serverErrors([accepted, withdrawn]), `round ${round}`).toEqual([])
      const row = await db.booking.findUniqueOrThrow({ where: { id } })
      expect(['CONFIRMED', 'CANCELLED']).toContain(row.status)
      // If the guest was told it was withdrawn, it is withdrawn
      if (withdrawn.status === 200) expect(row.status, `round ${round}: withdraw said 200, accept said ${accepted.status}`).toBe('CANCELLED')
      if (row.status === 'CONFIRMED') expect(row.payBy, 'an accepted request has a pay-by time').not.toBeNull()
      // A withdrawn request holds no dates: someone else can book them
      if (row.status === 'CANCELLED') {
        expect(await db.blockedDate.count({ where: { listingId: home.id, reason: 'BOOKED' } })).toBe(0)
        await world.mustBook(await world.guest(), home.id, dates)
      }
    }
    await expectInvariants()
  })
})

test.describe('races: bookings that have nothing to do with each other', () => {
  test('ten guests book ten different homes at the same instant: all ten get their dates', async ({ world }) => {
    const host = await world.host()
    const pairs = await Promise.all(Array.from({ length: 10 }, async () => ({ guest: await world.guest(), home: await world.listing(host) })))
    const replies = await together(...pairs.map(({ guest, home }, i) => () => world.book(guest, home.id, { ...world.dates(2), server: (i % 2) as 0 | 1 })))
    expect(serverErrors(replies)).toEqual([])
    expect(statuses(replies)).toEqual(Array(10).fill(201))
  })
})

test.describe('races: paying', () => {
  test('pay is pressed twice (double click, two tabs): the guest is charged once', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    for (let round = 0; round < ROUNDS; round++) {
      const guest = await world.guest()
      const id = await world.mustBook(guest, home.id)
      const starts = await together(() => world.startPayment(guest, id, { server: 0 }), () => world.startPayment(guest, id, { server: 1 }), () => world.startPayment(guest, id, { server: 0 }))
      expect(serverErrors(starts), `round ${round}`).toEqual([])
      // Whatever reached Paystack is paid by the guest (the worst case: both tabs completed)
      const txs = await fakes.tx(id)
      expect(txs.length, 'one payment page was opened, however many times Pay was pressed').toBe(1)
      for (const tx of txs) await fakes.setTx(tx.reference, { status: 'success' })
      await together(...txs.map((tx, i) => () => world.verify(guest, tx.reference, { server: (i % 2) as 0 | 1 })))
      const payments = await db.payment.findMany({ where: { bookingId: id } })
      expect(payments.filter((p) => p.status === 'SUCCESS'), `round ${round}: ${JSON.stringify(payments.map((p) => p.status))}`).toHaveLength(1)
      // Any second charge that got through is flagged for a refund by hand, never counted as paid twice
      expect(payments.filter((p) => p.status === 'DUPLICATE')).toHaveLength(txs.length - 1)
      expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    }
    await expectInvariants()
  })

  test('pay pressed twice opens one payment page at Paystack, not several', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const id = await world.mustBook(guest, home.id)
    const starts = await together(() => world.startPayment(guest, id, { server: 0 }), () => world.startPayment(guest, id, { server: 1 }), () => world.startPayment(guest, id, { server: 0 }))
    expect(serverErrors(starts)).toEqual([])
    expect((await fakes.tx(id)).length).toBe(1)
    // Every press that was answered was sent to the same page
    const pages = starts.filter((r) => r.status === 200).map((r) => r.json.authorizationUrl)
    expect(pages.length).toBeGreaterThanOrEqual(1)
    expect(new Set(pages).size).toBe(1)
    // And pressing again later, from either server, is still that page
    const later = await world.startPayment(guest, id, { server: 1 })
    expect(later.json).toMatchObject({ authorizationUrl: pages[0], reused: true })
    expect((await fakes.tx(id)).length).toBe(1)
  })

  test('the webhook arrives before, during and after the browser comes back, 20 times over: confirmed once', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    for (let round = 0; round < ROUNDS; round++) {
      const guest = await world.guest()
      const id = await world.mustBook(guest, home.id)
      const pay = await world.startPayment(guest, id)
      await fakes.setTx(pay.reference!, { status: 'success' })
      const order = round % 3 // 0: webhook first, 1: together, 2: browser first
      const hooks = () => Promise.all([fakes.webhook(APP[1], 'charge.success', { reference: pay.reference, times: 10 }), fakes.webhook(APP[0], 'charge.success', { reference: pay.reference, times: 10 })])
      let hookStatuses: number[]
      if (order === 0) { hookStatuses = (await hooks()).flatMap((h) => h.statuses); await world.verify(guest, pay.reference!) }
      else if (order === 1) { const [h] = await Promise.all([hooks(), world.verify(guest, pay.reference!, { server: 0 })]); hookStatuses = h.flatMap((x) => x.statuses) }
      else { await world.verify(guest, pay.reference!); hookStatuses = (await hooks()).flatMap((h) => h.statuses) }
      expect(hookStatuses.filter((s) => s !== 200), `round ${round}: every signed webhook is answered 200`).toEqual([])
      const payments = await db.payment.findMany({ where: { bookingId: id } })
      expect(payments.map((p) => p.status)).toEqual(['SUCCESS'])
      expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
      // Each person is told once per channel, however many times the event arrived
      // (messages are written after the response, so wait for them to appear)
      await expect.poll(() => db.messageLog.count({ where: { bookingId: id, event: 'booking.confirmed' } })).toBeGreaterThan(0)
      const told = await db.messageLog.groupBy({ by: ['userId', 'channel', 'event'], where: { bookingId: id, event: 'booking.confirmed' }, _count: true })
      expect(told.filter((t) => t._count > 1), `round ${round}`).toEqual([])
    }
    await expectInvariants()
  })

  test('a forged or unsigned webhook changes nothing', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const id = await world.mustBook(guest, home.id)
    const pay = await world.startPayment(guest, id)
    // Paystack has NOT taken the money; someone posts "it succeeded" anyway
    const forged = await fakes.webhook(APP[0], 'charge.success', { data: { reference: pay.reference, status: 'success', amount: 1, currency: 'GHS' }, forged: true, times: 5 })
    const unsigned = await fakes.webhook(APP[1], 'charge.success', { data: { reference: pay.reference, status: 'success' }, signature: '' })
    expect([...forged.statuses, ...unsigned.statuses].every((s) => s === 401)).toBe(true)
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ paymentStatus: 'UNPAID' })
    expect((await db.payment.findMany({ where: { bookingId: id } })).map((p) => p.status)).toEqual(['PENDING'])
    // A correctly signed webhook for a payment Paystack says is still pending does not confirm it either:
    // the app asks Paystack, it does not take the webhook's word for the amount
    await fakes.webhook(APP[0], 'charge.success', { data: { reference: pay.reference, status: 'success', amount: 1, currency: 'GHS' } })
    const after = await db.booking.findUniqueOrThrow({ where: { id }, include: { payments: true } })
    expect(after.paymentStatus, `a signed webhook claiming 1 pesewa was paid left the payment ${after.payments[0].status}`).toBe('UNPAID')
    await expectInvariants()
  })

  test('the guest cancels at the moment the payment lands: the money is either kept for a standing booking or owed back in full', async ({ world }) => {
    test.setTimeout(400_000)
    const host = await world.host()
    const home = await world.listing(host)
    const lost: string[] = []
    // Before the fix (finding F11) this went wrong about 1 round in 10, so it is given many chances
    const MOST = Math.max(ROUNDS * 4, 60)
    let rounds = 0
    for (let round = 0; round < MOST && lost.length === 0; round++, rounds++) {
      const guest = await world.guest()
      const id = await world.mustBook(guest, home.id)
      const pay = await world.startPayment(guest, id)
      await fakes.setTx(pay.reference!, { status: 'success' })
      const replies = await together(() => world.verify(guest, pay.reference!, { server: 0 }), () => cancel(guest, id, { server: 1 }))
      expect(serverErrors(replies), `round ${round}`).toEqual([])
      // Paystack keeps telling us until we listen: the webhook settles whatever the race left open
      await fakes.webhook(APP[1], 'charge.success', { reference: pay.reference })
      const row = await db.booking.findUniqueOrThrow({ where: { id }, include: { payments: true, refund: true } })
      const state = `round ${round}: ${row.status}/${row.paymentStatus}, payments ${row.payments.map((p) => p.status)}, refund ${row.refund ? `${row.refund.reason} ${row.refund.amount}` : 'none'}`
      const charged = row.payments.some((p) => p.status === 'SUCCESS')
      // The guest paid in full and the stay is off, but nothing says they are owed their money
      if (row.status === 'CANCELLED' && charged && (!row.refund || Math.abs(row.refund.amount - row.totalPrice) > 0.005)) lost.push(state)
      if (row.status !== 'CANCELLED') expect(row, state).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
      // Whoever lost was told so: a cancel that lost to the payment is refused, not half done
      if (row.status !== 'CANCELLED') expect(replies[1].status, state).toBe(409)
    }
    measured(lost.length ? `cancel at the moment of payment: on round ${rounds} the booking was left cancelled and paid with no refund on record` : `cancel at the moment of payment: clean in all ${rounds} rounds`)
    expect(lost).toEqual([])
    await expectInvariants()
  })

  test('the expiry job runs at the moment a late payment lands: paid and kept, or ended and owed back', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    for (let round = 0; round < ROUNDS; round++) {
      const guest = await world.guest()
      const id = await world.mustBook(guest, home.id)
      const pay = await world.startPayment(guest, id)
      // An hour and a half passes: the one-hour pay-by time and the 15 minutes of grace are over
      await ageBooking(id, 1.5 / 24)
      await fakes.setTx(pay.reference!, { status: 'success' })
      const replies = await together(() => world.verify(guest, pay.reference!, { server: 0 }), () => cron('expire-bookings', { server: 1 }), () => cron('expire-bookings', { server: 0 }))
      expect(serverErrors(replies), `round ${round}`).toEqual([])
      const row = await db.booking.findUniqueOrThrow({ where: { id }, include: { payments: true, refund: true } })
      const state = `round ${round}: ${row.status}/${row.paymentStatus}, payments ${row.payments.map((p) => p.status)}, refund ${row.refund?.reason ?? 'none'}`
      if (row.status === 'CANCELLED') { expect(row.refund, state).not.toBeNull(); expect(row.refund!.amount, state).toBeCloseTo(row.totalPrice, 2) }
      else expect(row, state).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    }
    await expectInvariants()
  })
})

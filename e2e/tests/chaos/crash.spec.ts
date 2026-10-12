import { spawnSync } from 'child_process'
import path from 'path'
import pg from 'pg'
import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes, until } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { measured } from '../../lib/race'
import { APP, call, cron, type Actor, type World } from '../../lib/world'

// Things breaking underneath the app: the server killed half way through
// sending money, the database gone, the database slow, no connections left.
// These run alone, one at a time, after everything else (project "chaos").

const RUN = path.resolve(__dirname, '../../run.mjs')
const launcher = (...args: string[]) => { const r = spawnSync('node', [RUN, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv }); if (r.status !== 0) throw new Error(`launcher ${args.join(' ')} failed: ${r.stdout}${r.stderr}`) }
const DAY = 86_400_000
const NO_LEAK = /at .*\(.*:\d+:\d+\)|node_modules|prisma|sk_test|ECONNREFUSED|postgres(ql)?:\/\/|\bstack\b/i
/** A connection to the local Postgres that is not the app's and not Prisma's, to pull levers with. */
const admin = (database: string) => new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', password: 'e2e', database })

async function due(world: World, host: Actor) {
  const guest = await world.guest()
  const home = await world.listing(host, { priceNightly: 100 })
  const { id } = await world.paidBooking(guest, home.id, { nights: 2 })
  const b = await db.booking.findUniqueOrThrow({ where: { id } })
  await ageBooking(id, Math.ceil((b.checkIn.getTime() - Date.now()) / DAY) + 3)
  return id
}
const makeStale = (bookingId: string) => db.payout.updateMany({ where: { bookingId }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000), initiatedAt: new Date(Date.now() - 2 * 3_600_000) } })

test.describe('the server is killed half way', () => {
  test.afterEach(() => { launcher('app:start', '3201') })

  test('killed while asking Paystack to pay a host, before Paystack answered: after the restart the host is paid once', async ({ world }) => {
    const host = await world.host()
    const id = await due(world, host)
    const undo = await fakes.rule('transfer', 'hang', { match: `booking ${id}` })
    void cron('process-payouts', { server: 1, timeoutMs: 60_000 })
    await until(async () => (await fakes.calls({ endpoint: 'transfer', match: `booking ${id}` })).length > 0, 'the transfer request to reach Paystack')
    launcher('app:kill', '3201')
    await undo()
    const left = await db.payout.findFirstOrThrow({ where: { bookingId: id } })
    measured(`killed mid-transfer: the payout row was left ${left.status}, claimed at ${left.initiatedAt ? 'a known time' : 'no time'}`)
    expect(left.status).toBe('PENDING')
    launcher('app:start', '3201')
    // Straight away the job leaves it alone: the claim is fresh, the first attempt might still be in flight
    await cron('process-payouts', { server: 0 })
    expect(await fakes.transfers(`booking ${id}`)).toHaveLength(0)
    // Once the claim is old enough to be a dead run, it is sent, with the same reference
    await makeStale(id)
    await cron('process-payouts', { server: 1 })
    await expect.poll(async () => (await db.payout.findFirstOrThrow({ where: { bookingId: id } })).status).toBe('PROCESSING')
    const transfers = await fakes.transfers(`booking ${id}`)
    expect(transfers).toHaveLength(1)
    expect(transfers[0].reference).toBe(left.paystackTransferReference)
    expect(await db.payout.count({ where: { bookingId: id } })).toBe(1)
    await expectInvariants()
  })

  test('killed after Paystack took the transfer but before the answer was stored: the host is still paid exactly once', async ({ world }) => {
    const host = await world.host()
    const id = await due(world, host)
    // Paystack accepts the transfer, but its answer takes 6 seconds: the server dies while waiting
    const undo = await fakes.rule('transfer', 'delay', { match: `booking ${id}`, delayMs: 6000, times: 1 })
    void cron('process-payouts', { server: 1, timeoutMs: 60_000 })
    await until(async () => (await fakes.calls({ endpoint: 'transfer', match: `booking ${id}` })).length > 0, 'the transfer request to reach Paystack')
    launcher('app:kill', '3201')
    const accepted = await until(async () => { const t = await fakes.transfers(`booking ${id}`); return t.length ? t : null }, 'Paystack to accept the transfer', 15_000)
    await undo()
    launcher('app:start', '3201')
    expect((await db.payout.findFirstOrThrow({ where: { bookingId: id } })).status).toBe('PENDING')
    // The dead run is picked up and sent again with the same reference: Paystack refuses the second one
    await makeStale(id)
    await cron('process-payouts', { server: 0 })
    await cron('process-payouts', { server: 1 })
    const transfers = await fakes.transfers(`booking ${id}`)
    expect(transfers, 'Paystack holds one transfer for this booking').toHaveLength(1)
    expect(transfers[0].transfer_code).toBe(accepted[0].transfer_code)
    const mid = await db.payout.findFirstOrThrow({ where: { bookingId: id } })
    measured(`killed after Paystack accepted the transfer: the resumed attempt was refused as a duplicate (${transfers[0].duplicateAttempts} time(s)) and the payout row is ${mid.status}: ${mid.failureReason ?? 'no reason'}`)
    // Paystack then reports the transfer it did make as successful
    await fakes.webhook(APP[0], 'transfer.success', { reference: transfers[0].reference })
    const done = await db.payout.findFirstOrThrow({ where: { bookingId: id } })
    expect.soft(done.status, `F11: the money reached the host, but the payout row says ${done.status} (${done.failureReason ?? ''})`).toBe('COMPLETED')
    // Whatever the row says, nothing may ever send this booking's money a second time
    await db.payout.updateMany({ where: { bookingId: id }, data: { lastFailedAt: new Date(Date.now() - 3 * 3_600_000) } })
    await cron('process-payouts'); await cron('process-payouts')
    expect(await fakes.transfers(`booking ${id}`), 'still one transfer after two more runs').toHaveLength(1)
    await expectInvariants()
  })

  test('killed while confirming a payment with Paystack: the guest is confirmed once when Paystack calls again', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const id = await world.mustBook(guest, home.id)
    const pay = await world.startPayment(guest, id)
    await fakes.setTx(pay.reference!, { status: 'success' })
    const undo = await fakes.rule('verify', 'delay', { match: pay.reference, delayMs: 6000, times: 1 })
    void world.verify(guest, pay.reference!, { server: 1, timeoutMs: 60_000 })
    await until(async () => (await fakes.calls({ endpoint: 'verify', match: pay.reference })).length > 0, 'the verify request to reach Paystack')
    launcher('app:kill', '3201')
    await undo()
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ paymentStatus: 'UNPAID' })
    launcher('app:start', '3201')
    await fakes.webhook(APP[1], 'charge.success', { reference: pay.reference, times: 3 })
    await world.verify(guest, pay.reference!, { server: 0 })
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    expect((await db.payment.findMany({ where: { bookingId: id } })).map((p) => p.status)).toEqual(['SUCCESS'])
    await expectInvariants()
  })
})

test.describe('the database misbehaves', () => {
  test('the database refuses every connection: plain errors, nothing leaked, and the app recovers by itself', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const dates = world.dates(2)
    const lever = admin('postgres')
    await lever.connect()
    await db.$disconnect()
    try {
      await lever.query(`ALTER DATABASE fiegh_e2e ALLOW_CONNECTIONS false`)
      await lever.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'fiegh_e2e' AND pid <> pg_backend_pid()`)
      const down = {
        search: await call('GET', '/api/listings?limit=5', undefined, { timeoutMs: 30_000 }),
        listing: await call('GET', `/api/listings/${home.id}`, undefined, { timeoutMs: 30_000 }),
        session: await guest.call('GET', '/api/auth/session', undefined, { timeoutMs: 30_000 }),
        booking: await guest.call('POST', '/api/bookings', { listingId: home.id, rentalMode: 'SHORT_STAY', ...dates }, { timeoutMs: 30_000 }),
        signIn: await call('POST', '/api/auth/signin', { identifier: guest.email, password: guest.password }, { timeoutMs: 30_000 }),
        payoutJob: await cron('process-payouts', { timeoutMs: 30_000 }),
        homePage: await call('GET', '/', undefined, { timeoutMs: 30_000 }),
        termsPage: await call('GET', '/terms', undefined, { timeoutMs: 30_000 }),
      }
      measured(`with the database down: ${Object.entries(down).map(([k, r]) => `${k} ${r.status}`).join(', ')}`)
      for (const [name, reply] of Object.entries(down)) {
        expect(reply.status, `${name} answered within 30 s`).not.toBe(0)
        if (!name.endsWith('Page')) expect(reply.text.slice(0, 2000), `${name} leaks nothing`).not.toMatch(NO_LEAK)
      }
      // Nothing is reported as done that was not
      expect(down.booking.status).toBeGreaterThanOrEqual(500)
      expect(down.signIn.status).toBeGreaterThanOrEqual(400)
      // Pages that need no data still load
      expect(down.termsPage.status).toBe(200)
    } finally {
      await lever.query(`ALTER DATABASE fiegh_e2e ALLOW_CONNECTIONS true`)
      await lever.end()
    }
    // No restart: the app finds the database again on its own
    await until(async () => (await call('GET', '/api/listings?limit=5')).status === 200, 'the app to recover on server 0', 30_000)
    await until(async () => (await call('GET', '/api/listings?limit=5', undefined, { server: 1 })).status === 200, 'the app to recover on server 1', 30_000)
    expect(await db.booking.count({ where: { listingId: home.id } }), 'the booking that was refused was not made').toBe(0)
    expect((await world.book(guest, home.id, dates)).status).toBe(201)
    await expectInvariants()
  })

  test('the database is slow (a table locked for 4 seconds): requests wait and then succeed', async ({ world }) => {
    const host = await world.host()
    await world.listing(host)
    const lever = admin('fiegh_e2e')
    await lever.connect()
    await lever.query('BEGIN')
    await lever.query('LOCK TABLE "Listing" IN ACCESS EXCLUSIVE MODE')
    const started = Date.now()
    const waiting = Promise.all([call('GET', '/api/listings?limit=5', undefined, { timeoutMs: 40_000 }), call('GET', '/api/listings?limit=5', undefined, { server: 1, timeoutMs: 40_000 })])
    await new Promise((r) => setTimeout(r, 4000)) // the one fixed wait in the suite: it IS the fault being injected
    await lever.query('COMMIT')
    await lever.end()
    const replies = await waiting
    measured(`with the Listing table locked for 4 s, search answered ${replies.map((r) => r.status)} after ${Date.now() - started} ms`)
    expect(replies.map((r) => r.status)).toEqual([200, 200])
  })

  test('no database connections are left: what a visitor gets, and whether it mends when they are freed', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    await db.$disconnect()
    const hogs: pg.Client[] = []
    try {
      // Take every connection the server allows (60, the limit of the small Supabase computes)
      for (let i = 0; i < 70; i++) { const c = admin('fiegh_e2e'); try { await c.connect(); hogs.push(c) } catch { break } }
      const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => call('GET', i % 2 ? `/api/listings/${home.id}` : '/api/listings?limit=5', undefined, { server: (i % 2) as 0 | 1, timeoutMs: 40_000 })))
      const counts = burst.reduce<Record<string, number>>((all, r) => ({ ...all, [r.status]: (all[r.status] ?? 0) + 1 }), {})
      measured(`with ${hogs.length} connections taken by something else, 40 requests answered: ${JSON.stringify(counts)}`)
      expect(burst.filter((r) => r.status === 0), 'every request is answered within 40 s').toHaveLength(0)
      for (const r of burst.filter((x) => x.status >= 500)) expect(r.text.slice(0, 1000)).not.toMatch(NO_LEAK)
    } finally { await Promise.all(hogs.map((c) => c.end().catch(() => {}))) }
    await until(async () => (await call('GET', '/api/listings?limit=5')).status === 200, 'search to work again', 30_000)
    await until(async () => (await call('GET', '/api/listings?limit=5', undefined, { server: 1 })).status === 200, 'search to work again on server 1', 30_000)
  })
})

test.describe('jobs', () => {
  const JOBS = ['process-payouts', 'complete-bookings', 'process-refunds', 'send-messages', 'expire-bookings', 'check-disputes', 'rent-reminders', 'listing-check-reminders', 'update-exchange-rate', 'cleanup']
  // Here, with nothing else running, so a job's answer is about this test only
  test('every cron route started on two servers at the same moment answers 200 both times', async () => {
    for (const job of JOBS) {
      const runs = await Promise.all([cron(job, { server: 0 }), cron(job, { server: 1 })])
      expect(runs.map((r) => r.status), job).toEqual([200, 200])
    }
  })
})

test.describe('the exchange rate moves between the payment and the payout', () => {
  // Here, alone: the rate is one row that every booking on the site reads
  test('the host is never sent more cedis than 90% of what the guest was charged', async ({ world }) => {
    test.fail(true, 'F17: the payout is converted at the rate on the day it is sent, not the rate the guest was charged at')
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { priceNightly: 100 })
    const { id } = await world.paidBooking(guest, home.id, { nights: 2 })
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId: id, status: 'SUCCESS' } })
    const b = await db.booking.findUniqueOrThrow({ where: { id } })
    await ageBooking(id, Math.ceil((b.checkIn.getTime() - Date.now()) / DAY) + 3)
    const rate = await db.exchangeRate.findFirstOrThrow({ orderBy: { updatedAt: 'desc' } })
    try {
      // The cedi loses 15% against the dollar before the host is paid
      await db.exchangeRate.update({ where: { id: rate.id }, data: { usdToGhs: Math.round(payment.usdToGhs! * 1.15 * 100) / 100 } })
      await cron('process-payouts')
      const [transfer] = await until(async () => { const t = await fakes.transfers(`booking ${id}`); return t.length ? t : null }, 'the transfer')
      measured(`the guest was charged ${payment.amountPesewas} pesewas; after the rate moved 15% the host was sent ${transfer.amount} (${Math.round(transfer.amount / payment.amountPesewas! * 1000) / 10}% of it)`)
      expect(transfer.amount).toBeLessThanOrEqual(Math.round(payment.amountPesewas! * 0.9) + 1)
    } finally {
      await db.exchangeRate.update({ where: { id: rate.id }, data: { usdToGhs: rate.usdToGhs } })
    }
  })
})

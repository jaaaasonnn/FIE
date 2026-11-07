import { test, expect } from '../../lib/test'
import { db, ageBooking } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { allowForRounds, ROUNDS, measured, serverErrors, together } from '../../lib/race'
import { cron, type Reply } from '../../lib/world'
import { claimedRetryNobodyIsSending, failedPayout, listedBy, paystackAsked, saidAbout, settledPayout } from '../../lib/payoutRetry'

test.beforeEach(allowForRounds)

// AS2: what the race "a failed payout is retried while the normal job runs" saw, made deterministic. The payout
// job works on every payout in the database, so a run another test starts can take a payout's retry: the
// payout is paid once, and that run's answer (not this test's runs') lists it. No payout code is changed.
//
// Each test has its own host and bookings and checks only its own payouts. Its runs of the job also work on
// other tests' payouts, as every test that runs the job does; each test here checks the payout itself once it
// has settled, so another test's run taking one of these payouts does not make it fail.

const SINGLE = Math.max(1, Math.ceil(ROUNDS / 3))
const MANY = Math.max(20, ROUNDS)
const MIN = 60_000
const DAY = 86_400_000
const three = () => together(() => cron('process-payouts', { server: 0 }), () => cron('process-payouts', { server: 1 }), () => cron('process-payouts', { server: 1 }))

test.describe('payout retries: a run another test started can take the retry', () => {
  test('(b) another run takes the retry first: the three runs after it list nothing, the payout is paid once', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < SINGLE; round++) {
      const { bookingId, payoutId } = await failedPayout(world, host)
      const other = await cron('process-payouts', { server: 0 }) // as another test's run
      const runs = await three()
      expect(serverErrors([other, ...runs]), `round ${round}`).toEqual([])
      // The retry is no longer FAILED and the payout was made a moment ago: none of the three may touch it
      for (const run of runs) expect(saidAbout(run, bookingId, payoutId), `round ${round}`).toEqual([])
      const payout = await settledPayout(payoutId)
      measured(`(b) round ${round + 1}: listed by ${listedBy([other, ...runs], bookingId, payoutId, ['the earlier run', 'run 1', 'run 2', 'run 3'])}`)
      expect(payout, `round ${round}: ${payout.failureReason}`).toMatchObject({ status: 'PROCESSING', retryCount: 1 })
      expect(await fakes.transfers(`booking ${bookingId}`), `round ${round}`).toHaveLength(1)
    }
    await expectInvariants()
  })

  test('(a) another run has claimed the retry and is on its way to Paystack: the payout is checked once it settles, and is paid once', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < SINGLE; round++) {
      const { bookingId, payoutId, reference } = await failedPayout(world, host)
      // The run that claims the retry is held up at its first call to Paystack (the lookup)
      const undo = await fakes.rule('transfer-lookup', 'delay', { match: reference, delayMs: 4_000, times: 1 })
      const started = Date.now()
      const other = cron('process-payouts', { server: 0 })
      await expect.poll(async () => (await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).retryCount, { intervals: [10], timeout: 10_000 }).toBe(1)
      const runs = await three()
      expect(serverErrors(runs), `round ${round}`).toEqual([])
      for (const run of runs) expect(saidAbout(run, bookingId, payoutId), `round ${round}`).toEqual([])
      const meanwhile = (await paystackAsked(started, bookingId, reference)).map((c) => `${c.endpoint} ${c.answeredAt ? `answered ${c.status}` : 'not answered yet'}`)
      // Checked only once no run is working on it: straight after the three runs it is still PENDING
      const payout = await settledPayout(payoutId)
      const done = await other
      await undo()
      measured(`(a) round ${round + 1}: while the claimer waited, Paystack: ${meanwhile.join(', ') || 'not asked'}; listed by ${listedBy([done, ...runs], bookingId, payoutId, ['the claiming run', 'run 1', 'run 2', 'run 3'])}`)
      expect(payout, `round ${round}: ${payout.failureReason}`).toMatchObject({ status: 'PROCESSING', retryCount: 1 })
      expect(await fakes.transfers(`booking ${bookingId}`), `round ${round}`).toHaveLength(1)
    }
    await expectInvariants()
  })

  test('(a2) the run that claimed the retry dies before calling Paystack: nothing happens until the 15-minute limit, then the next run sends it exactly once', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < SINGLE; round++) {
      // The failure is fresh, so no run (this test's or another's) retries it on its own; and its payout exists
      // before the stay falls due, so no run holds the stay in an older list of due stays (AS17)
      const { bookingId, payoutId, reference } = await failedPayout(world, host, { due: false, rowFirst: true })
      // Claimed a moment after the payout was made, then the claiming run died
      await claimedRetryNobodyIsSending(payoutId, 0)
      const started = Date.now()
      const runs = await three()
      expect(serverErrors(runs), `round ${round}`).toEqual([])
      for (const run of runs) expect(saidAbout(run, bookingId, payoutId), `round ${round}`).toEqual([])
      expect(await db.payout.findUniqueOrThrow({ where: { id: payoutId } }), `round ${round}`).toMatchObject({ status: 'PENDING', retryCount: 1, initiatedAt: null })
      expect(await paystackAsked(started, bookingId, reference), `round ${round}: Paystack was asked before the limit`).toEqual([])
      // Past the 15-minute stale-claim limit (in production a retry's payout is always older than that)
      await db.payout.update({ where: { id: payoutId }, data: { createdAt: new Date(Date.now() - 16 * MIN) } })
      const next = await cron('process-payouts')
      expect(serverErrors([next]), `round ${round}`).toEqual([])
      const payout = await settledPayout(payoutId)
      const asked = (await paystackAsked(started, bookingId, reference)).map((c) => `${c.endpoint} ${c.status}`)
      measured(`(a2) round ${round + 1}: listed by ${listedBy([next], bookingId, payoutId, ['the next run'])}; Paystack: ${asked.join(', ')}`)
      expect(payout, `round ${round}: ${payout.failureReason}`).toMatchObject({ status: 'PROCESSING', retryCount: 1 })
      // Asked first under the same reference (nothing held), then sent once
      expect(asked, `round ${round}`).toEqual(['transfer-lookup 404', 'transfer 200'])
      expect(await fakes.transfers(`booking ${bookingId}`), `round ${round}`).toHaveLength(1)
    }
    await expectInvariants()
  })

  test('(a2) on demand: a run holding the stay in an older list of due stays never reaches its payout (AS17)', async ({ world }) => {
    const host = await world.host()
    // Run R is held at another stay's transfer, with its list of due stays read once this stay has fallen due
    const guest = await world.guest()
    const other = await world.listing(host, { priceNightly: 100 })
    const { id: earlier } = await world.paidBooking(guest, other.id, { nights: 2 })
    const b = await db.booking.findUniqueOrThrow({ where: { id: earlier } })
    await ageBooking(earlier, Math.ceil((b.checkIn.getTime() - Date.now()) / DAY) + 3)
    const hold = await fakes.rule('transfer', 'delay', { match: `booking ${earlier}`, delayMs: 15_000, times: 1 })
    let r: Promise<Reply> | undefined
    try {
      const { bookingId, payoutId, reference } = await failedPayout(world, host, {
        due: false, rowFirst: true,
        onDue: async () => {
          r = cron('process-payouts', { server: 0 })
          await expect.poll(async () => (await db.payout.findFirst({ where: { bookingId: earlier } }))?.initiatedAt ?? null, { intervals: [20], timeout: 10_000 }).not.toBeNull()
        },
      })
      await claimedRetryNobodyIsSending(payoutId, 0)
      const started = Date.now()
      const done = await r!
      expect(serverErrors([done])).toEqual([])
      expect(saidAbout(done, bookingId, payoutId)).toEqual([])
      expect(await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).toMatchObject({ status: 'PENDING', retryCount: 1, initiatedAt: null })
      expect(await paystackAsked(started, bookingId, reference), 'Paystack was asked before the limit').toEqual([])
    } finally {
      await r?.catch(() => undefined)
      await hold()
    }
  })

  test('(c) three runs at once find a retry due, the payout made long ago: exactly one transfer each round', async ({ world }) => {
    const host = await world.host()
    const tally: Record<string, number> = {}
    for (let round = 0; round < MANY; round++) {
      const { bookingId, payoutId } = await failedPayout(world, host)
      // As in production: the payout was made long before its retry, so the stale-claim rule may see it too
      await db.payout.update({ where: { id: payoutId }, data: { createdAt: new Date(Date.now() - 120 * MIN) } })
      const runs = await three()
      expect(serverErrors(runs), `round ${round}`).toEqual([])
      const payout = await settledPayout(payoutId)
      expect(payout, `round ${round}: ${payout.failureReason}`).toMatchObject({ status: 'PROCESSING', retryCount: 1 })
      expect(await fakes.transfers(`booking ${bookingId}`), `round ${round}`).toHaveLength(1)
      const key = listedBy(runs, bookingId, payoutId).replace(/run \d/g, 'a run')
      tally[key] = (tally[key] ?? 0) + 1
    }
    for (const [what, n] of Object.entries(tally)) measured(`(c) ${n} of ${MANY} rounds: listed by ${what}`)
    await expectInvariants()
  })

  test('(d) three runs at once find a retry whose claimer died: exactly one transfer each round', async ({ world }) => {
    const host = await world.host()
    const tally: Record<string, number> = {}
    for (let round = 0; round < MANY; round++) {
      const { bookingId, payoutId } = await failedPayout(world, host, { due: false })
      // Claimed and abandoned, the payout made long ago: every run's stale-claim rule picks it up at once
      await claimedRetryNobodyIsSending(payoutId, 120 * MIN)
      const runs = await three()
      expect(serverErrors(runs), `round ${round}`).toEqual([])
      const payout = await settledPayout(payoutId)
      expect(payout, `round ${round}: ${payout.failureReason}`).toMatchObject({ status: 'PROCESSING', retryCount: 1 })
      expect(await fakes.transfers(`booking ${bookingId}`), `round ${round}`).toHaveLength(1)
      // AS6: the runs that lose the claim also say "paid", with the payout still PENDING (recorded, not asserted)
      const key = runs.map((r) => saidAbout(r, bookingId, payoutId).join(' + ') || 'nothing').sort().join(' | ')
      tally[key] = (tally[key] ?? 0) + 1
    }
    for (const [what, n] of Object.entries(tally)) measured(`(d) ${n} of ${MANY} rounds: ${what}`)
    await expectInvariants()
  })
})

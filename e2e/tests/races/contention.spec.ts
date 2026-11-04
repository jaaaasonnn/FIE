// AS3: many bookings at one instant, through the contention lane (an app server whose distance from Postgres each
// test sets, run.mjs and lib/lane.ts), so each booking's Serializable transaction is open as long as it would be
// on Vercel and Supabase. Every test makes its own guests and homes and depends on no other test. The file is its own
// project (`contention`, playwright.config.ts), run alone after the Chromium suite: its bursts load the one Postgres
// for about 12 minutes, and beside them the timing-bound races ran out of time. Ten rounds each, whatever E2E_ROUNDS says.
//
// Realistic (5-15 ms, Vercel's dub1 beside Supabase's eu-west-1): every booking is made, nobody is told "busy".
// Stress (30-80 ms): Postgres lets one of these transactions through at a time (they read the same small tables
// whole, AS3), so a burst can outrun the retry ceiling and some guests are told "busy". That rate is printed, not
// asserted; what is asserted is that nothing is ever booked twice and every answer matches what was written.
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { expectInvariants } from '../../lib/invariants'
import { REALISTIC, STRESS, setLaneLatency } from '../../lib/lane'
import { measured, serverErrors, together } from '../../lib/race'
import { LANE, type Reply, type World } from '../../lib/world'

const ROUNDS = 10
const BUSY = 'We are busy right now. Please try again in a moment.'

// One after another: each burst is the stated size, and the lane's distance is the one its test set
test.describe.configure({ mode: 'default' })
test.beforeEach(({}, testInfo) => testInfo.setTimeout(900_000))

/**
 * n guests, each booking a different home of one host, all at one instant, ROUNDS times. Checks every answer
 * against the database: a 201 is that guest's one booking, on their home, with its nights held once; a 503
 * "busy" wrote nothing. Returns the counts.
 */
async function differentHomes(world: World, n: number, latency: string) {
  const host = await world.host()
  const tally = { made: 0, busy: 0, other: [] as string[], slowestMs: 0 }
  for (let round = 0; round < ROUNDS; round++) {
    const pairs = await Promise.all(Array.from({ length: n }, async () => ({ guest: await world.guest(), home: await world.listing(host), dates: world.dates(2) })))
    const replies = await together(...pairs.map(({ guest, home, dates }) => async () => {
      const started = Date.now()
      const reply = await world.book(guest, home.id, { ...dates, server: LANE })
      tally.slowestMs = Math.max(tally.slowestMs, Date.now() - started)
      return reply
    }))
    for (const reply of replies) {
      if (reply.status === 201) tally.made++
      else if (reply.status === 503 && reply.json?.error === BUSY) tally.busy++
      else tally.other.push(`round ${round}: ${reply.status} ${reply.text.slice(0, 160)}`)
    }
    for (const [i, { guest, home }] of pairs.entries()) {
      const rows = await db.booking.findMany({ where: { guestId: guest.id }, select: { id: true, listingId: true, status: true } })
      const onHome = await db.booking.count({ where: { listingId: home.id } })
      if (replies[i].status === 201) {
        expect(rows, `round ${round}, guest ${i}: the booking they were told about, once`).toEqual([{ id: replies[i].json.booking.id, listingId: home.id, status: 'CONFIRMED' }])
        expect(onHome, `round ${round}, home ${i}: booked once`).toBe(1)
        expect(await db.blockedDate.count({ where: { listingId: home.id } }), `round ${round}, home ${i}: two nights held, once each`).toBe(2)
      } else {
        expect(rows, `round ${round}, guest ${i}: nothing written`).toEqual([])
        expect(onHome, `round ${round}, home ${i}: not booked`).toBe(0)
      }
    }
  }
  const rate = ((100 * tally.busy) / (n * ROUNDS)).toFixed(1)
  measured(`${n} guests on ${n} homes at one instant, ${ROUNDS} rounds, ${latency} ms from the database: ${tally.made} booked, ${tally.busy} answered 503 busy (${rate}%), ${tally.other.length} other; slowest answer ${tally.slowestMs} ms`)
  expect(tally.other, 'no answer but "booked" or "busy"').toEqual([])
  expect(tally.made + tally.busy).toBe(n * ROUNDS)
  await expectInvariants()
  return tally
}

test.describe('races: a burst of bookings at a realistic distance from the database, 5-15 ms (AS3)', () => {
  test.beforeEach(() => setLaneLatency(REALISTIC))

  test('ten guests book ten different homes at one instant, ten rounds: every booking is made, nobody is told "busy"', async ({ world }) => {
    const tally = await differentHomes(world, 10, REALISTIC)
    expect(tally.busy, 'nobody is told "busy"').toBe(0)
    expect(tally.made).toBe(100)
  })

  test('twenty guests book twenty different homes at one instant, ten rounds: every booking is made, nobody is told "busy"', async ({ world }) => {
    const tally = await differentHomes(world, 20, REALISTIC)
    expect(tally.busy, 'nobody is told "busy"').toBe(0)
    expect(tally.made).toBe(200)
  })
})

test.describe('races: a burst of bookings far from the database, 30-80 ms (AS3 stress)', () => {
  test.beforeEach(() => setLaneLatency(STRESS))

  test('ten guests book ten different homes at one instant, ten rounds: nothing booked twice, every answer true (busy rate printed)', async ({ world }) => {
    await differentHomes(world, 10, STRESS)
  })

  test('twenty guests book twenty different homes at one instant, ten rounds: nothing booked twice, every answer true (busy rate printed)', async ({ world }) => {
    await differentHomes(world, 20, STRESS)
  })

  test('ten guests want the same dates on one home at one instant, ten rounds: exactly one booking each time, nobody told "busy"', async ({ world }) => {
    const host = await world.host()
    const n = 10
    let busy = 0
    for (let round = 0; round < ROUNDS; round++) {
      const home = await world.listing(host)
      const dates = world.dates(2)
      const guests = await Promise.all(Array.from({ length: n }, () => world.guest()))
      const replies: Reply[] = await together(...guests.map((guest) => () => world.book(guest, home.id, { ...dates, server: LANE })))
      expect(serverErrors(replies.filter((r) => r.status !== 503)), `round ${round}`).toEqual([])
      busy += replies.filter((r) => r.status === 503).length
      const won = replies.filter((r) => r.status === 201)
      expect(won, `round ${round}: one guest gets the dates`).toHaveLength(1)
      for (const r of replies.filter((r) => r.status !== 201 && r.status !== 503)) expect(r.status, `round ${round}: ${r.text.slice(0, 160)}`).toBe(409)
      const bookings = await db.booking.findMany({ where: { listingId: home.id }, select: { id: true } })
      expect(bookings.map((b) => b.id), `round ${round}: one booking on the home`).toEqual([won[0].json.booking.id])
      expect(await db.blockedDate.count({ where: { listingId: home.id } }), `round ${round}: its two nights held once`).toBe(2)
    }
    measured(`${n} guests on the same dates at one instant, ${ROUNDS} rounds, ${STRESS} ms: one booking each round; ${busy} answered 503 busy`)
    expect(busy, 'nobody is told "busy": the others are told the dates are taken').toBe(0)
    await expectInvariants()
  })
})

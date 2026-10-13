import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { allowForRounds, ROUNDS, measured, serverErrors, statuses, together } from '../../lib/race'
import { call, cron, freshIp } from '../../lib/world'

test.beforeEach(allowForRounds)

// Accounts and limits when requests arrive together.

const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`

test.describe('races: accounts', () => {
  test('two people sign up with the same email at the same instant: one account', async () => {
    const made: string[] = []
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const email = `e2e-twin-${tag()}@fiegh.test`
        const join = (server: 0 | 1, casing: (s: string) => string) => call('POST', '/api/auth/signup', { name: 'E2E Twin', email: casing(email), password: 'Twin-pass-12345', role: 'GUEST' }, { server })
        const replies = await together(() => join(0, (s) => s), () => join(1, (s) => s.toUpperCase()), () => join(0, (s) => ` ${s} `))
        const rows = await db.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })
        made.push(...rows.map((r) => r.id))
        expect(rows, `round ${round}: ${JSON.stringify(statuses(replies))}`).toHaveLength(1)
        expect(replies.filter((r) => r.status === 201)).toHaveLength(1)
      }
    } finally { const { purge } = await import('../../lib/db'); await purge(made) }
  })

  test('two people sign up with the same phone number at the same instant: one account', async () => {
    const made: string[] = []
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const phone = `024${Math.floor(1000000 + Math.random() * 8999999)}`
        const join = (server: 0 | 1, written: string) => call('POST', '/api/auth/signup', { name: 'E2E Twin', email: `e2e-twin-${tag()}@fiegh.test`, phone: written, password: 'Twin-pass-12345', role: 'GUEST' }, { server })
        const replies = await together(() => join(0, phone), () => join(1, `+233${phone.slice(1)}`))
        const rows = await db.user.findMany({ where: { phone: { endsWith: phone.slice(1) } }, select: { id: true } })
        made.push(...rows.map((r) => r.id))
        expect(rows, `round ${round}: ${JSON.stringify(statuses(replies))}`).toHaveLength(1)
        expect(replies.filter((r) => r.status === 201)).toHaveLength(1)
      }
    } finally { const { purge } = await import('../../lib/db'); await purge(made) }
  })

  test('the person who loses a simultaneous sign-up is told the address is taken, not that something broke', async () => {
    test.fail(true, 'F8: the loser of two simultaneous sign-ups gets HTTP 500 "Failed to create account" instead of 409')
    const made: string[] = []
    try {
      const errors: string[] = []
      for (let round = 0; round < 6; round++) {
        const email = `e2e-twin-${tag()}@fiegh.test`
        const replies = await together(...[0, 1, 0, 1].map((server) => () => call('POST', '/api/auth/signup', { name: 'E2E Twin', email, password: 'Twin-pass-12345', role: 'GUEST' }, { server: server as 0 | 1 })))
        made.push(...replies.filter((r) => r.status === 201).map((r) => r.json.user.id))
        errors.push(...serverErrors(replies))
      }
      expect(errors).toEqual([])
    } finally { const { purge } = await import('../../lib/db'); await purge(made) }
  })

  test('one reset link is used twice at the same instant: the password is changed once', async ({ world }) => {
    for (let round = 0; round < Math.max(1, Math.ceil(ROUNDS / 3)); round++) {
      const person = await world.guest()
      expect((await call('POST', '/api/auth/forgot-password', { email: person.email })).status).toBe(200)
      const token = new URL(await person.linkFrom('Reset your')).searchParams.get('token')!
      const reset = (password: string, server: 0 | 1) => call('POST', '/api/auth/reset-password', { token, password }, { server })
      const replies = await together(() => reset('First-new-pass-1', 0), () => reset('Second-new-pass-2', 1))
      expect(serverErrors(replies), `round ${round}`).toEqual([])
      expect(replies.filter((r) => r.status === 200), `round ${round}: ${JSON.stringify(statuses(replies))}`).toHaveLength(1)
      const winner = replies[0].status === 200 ? 'First-new-pass-1' : 'Second-new-pass-2'
      const loser = replies[0].status === 200 ? 'Second-new-pass-2' : 'First-new-pass-1'
      const tryIn = (password: string) => call('POST', '/api/auth/signin', { identifier: person.email, password })
      expect((await tryIn(winner)).status).toBe(200)
      expect((await tryIn(loser)).status).toBe(401)
      expect((await tryIn(person.password)).status).toBe(401)
      // The old session is gone
      expect((await person.call('GET', '/api/auth/session')).json?.user ?? null).toBeNull()
      // And the link cannot be used a third time
      expect((await reset('Third-new-pass-3', 0)).status).toBe(400)
    }
  })

  test('signing out everywhere while other requests are in flight: no errors, and nothing works afterwards', async ({ world }) => {
    const person = await world.guest()
    const second = await call('POST', '/api/auth/signin', { identifier: person.email, password: person.password }, { server: 1 })
    const other = /fiegh_session=([^;]+)/.exec(second.headers.get('set-cookie') ?? '')![1]
    const reads = Array.from({ length: 12 }, (_, i) => () => person.call('GET', i % 2 ? '/api/auth/session' : `/api/bookings?guestId=${person.id}`, undefined, { server: (i % 2) as 0 | 1 }))
    const replies = await together(...reads.slice(0, 6), () => person.call('POST', '/api/auth/signout', { everywhere: true }), ...reads.slice(6))
    expect(serverErrors(replies)).toEqual([])
    expect(await db.session.count({ where: { userId: person.id } })).toBe(0)
    expect((await person.call('GET', `/api/bookings?guestId=${person.id}`)).status).toBe(401)
    expect((await call('GET', `/api/bookings?guestId=${person.id}`, undefined, { cookie: other, server: 1 })).status).toBe(401)
  })
})

test.describe('races: limits when requests arrive together', () => {
  test('twenty wrong passwords at the same instant: no more than 5 are checked', async ({ world }) => {
    const person = await world.guest()
    const ip = freshIp()
    const replies = await together(...Array.from({ length: 20 }, (_, i) => () => call('POST', '/api/auth/signin', { identifier: person.email, password: `wrong-${i}` }, { ip, server: (i % 2) as 0 | 1 })))
    expect(serverErrors(replies)).toEqual([])
    const checked = replies.filter((r) => r.status === 401).length
    measured(`${checked} of 20 simultaneous guesses had their password checked (the limit is 5)`)
    expect(checked).toBeLessThanOrEqual(5)
  })

  test('the sign-in limit holds once the burst is over', async ({ world }) => {
    const person = await world.guest()
    const ip = freshIp()
    await together(...Array.from({ length: 8 }, (_, i) => () => call('POST', '/api/auth/signin', { identifier: person.email, password: `wrong-${i}` }, { ip })))
    // Whatever got through at once, the account is now locked, even for the right password
    expect((await call('POST', '/api/auth/signin', { identifier: person.email, password: person.password }, { ip })).status).toBe(429)
    expect((await call('POST', '/api/auth/signin', { identifier: person.email, password: person.password }, { ip: freshIp() })).status).toBe(429)
  })

  test('six instant bookings at the same instant by one guest: two are held unpaid, the other four are refused', async ({ world }) => {
    const host = await world.host()
    for (let round = 0; round < ROUNDS; round++) {
      const guest = await world.guest()
      const homes = await Promise.all(Array.from({ length: 6 }, () => world.listing(host)))
      const replies = await together(...homes.map((home, i) => () => world.book(guest, home.id, { ...world.dates(1), server: (i % 2) as 0 | 1 })))
      expect(serverErrors(replies), `round ${round}`).toEqual([])
      expect(statuses(replies), `round ${round}`).toEqual([201, 201, 429, 429, 429, 429])
      expect(await db.booking.count({ where: { guestId: guest.id, status: 'CONFIRMED', paymentStatus: 'UNPAID' } })).toBe(2)
    }
  })

  test('forty messages at the same instant: no more than 30 are sent', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host)
    const replies = await together(...Array.from({ length: 40 }, (_, i) => () => guest.call('POST', '/api/messages', { receiverId: host.id, listingId: home.id, content: `E2E message ${i}` }, { server: (i % 2) as 0 | 1 })))
    expect(serverErrors(replies)).toEqual([])
    const sent = await db.message.count({ where: { senderId: guest.id } })
    measured(`${sent} of 40 simultaneous messages were stored (the limit is 30 an hour)`)
    expect(sent).toBeLessThanOrEqual(30)
  })

  test('five sign-ups an hour from one address holds when ten arrive together', async () => {
    const ip = freshIp()
    const made: string[] = []
    try {
      const replies = await together(...Array.from({ length: 10 }, (_, i) => () => call('POST', '/api/auth/signup', { name: 'E2E Burst', email: `e2e-burst-${tag()}-${i}@fiegh.test`, password: 'Burst-pass-12345', role: 'GUEST' }, { ip, server: (i % 2) as 0 | 1 })))
      expect(serverErrors(replies)).toEqual([])
      made.push(...replies.filter((r) => r.status === 201).map((r) => r.json.user.id))
      measured(`${made.length} of 10 simultaneous sign-ups from one address made an account (the limit is 5 an hour)`)
      expect(made.length).toBeLessThanOrEqual(5)
    } finally { const { purge } = await import('../../lib/db'); await purge(made); await cron('send-messages'); void fakes }
  })
})

test('the rules about money and dates hold after every race in this file', async () => { await expectInvariants() })

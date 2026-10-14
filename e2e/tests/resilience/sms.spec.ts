import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes, until } from '../../lib/fakes'
import { cron, type World } from '../../lib/world'

// SMS through the fake Arkesel: a real booking's SMS, delivery reports, and
// every way Arkesel can answer. Each test uses phone numbers nobody else has,
// and failure rules are matched on those numbers, so tests running side by
// side never affect each other.

const SMS_PATH = '/api/webhooks/sms/arkesel/'
/** A Ghana mobile number nobody else in this run has: national form, and the form Arkesel is sent */
const newPhone = () => {
  const national = `024${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  return { national, msisdn: `233${national.slice(1)}` }
}

async function personWithPhone(world: World) {
  const phone = newPhone()
  const person = await world.person('GUEST', { phone: phone.national })
  return { person, ...phone }
}

/** One SMS waiting to go to this person, as notify() would have written it */
async function queueSms(userId: string, body = 'FieGH: An end-to-end test SMS.') {
  return db.messageLog.create({
    data: {
      event: 'booking.confirmed', channel: 'SMS', userId, recipientRole: 'GUEST', recipientMasked: '+233 24 *** **00',
      dedupeKey: `e2e-sms:${userId}:${Date.now()}:${Math.random()}`, body, status: 'QUEUED', provider: 'arkesel',
    },
  })
}

/** Runs the send job until this person's SMS have all been tried */
async function tried(userId: string, timeoutMs = 25_000) {
  return until(async () => {
    await cron('send-messages')
    const rows = await db.messageLog.findMany({ where: { userId, channel: 'SMS' } })
    return rows.length > 0 && rows.every((m) => !['QUEUED', 'SENDING'].includes(m.status)) ? rows : null
  }, 'the SMS to be tried', timeoutMs)
}
/** A retry is due five minutes later: bring it forward */
const dueNow = (userId: string) => db.messageLog.updateMany({ where: { userId, channel: 'SMS', status: 'FAILED' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })

test.describe('SMS through Arkesel', () => {
  test('a paid booking sends each side one plain SMS from FieGH, to the number in 233 form, with a signed report link', async ({ world }) => {
    const host = await world.host()
    const hostPhone = newPhone()
    await db.user.update({ where: { id: host.id }, data: { phone: `+233${hostPhone.national.slice(1)}` } })
    const { person: guest, msisdn } = await personWithPhone(world)
    const home = await world.listing(host)
    const booking = await world.paidBooking(guest, home.id)

    const rows = await until(async () => {
      await cron('send-messages')
      const sent = await db.messageLog.findMany({ where: { bookingId: booking.id, channel: 'SMS', event: 'booking.confirmed' } })
      return sent.length === 2 && sent.every((m) => m.status === 'SENT') ? sent : null
    }, 'both confirmation SMS to be sent', 25_000)

    for (const [userId, number] of [[guest.id, msisdn], [host.id, hostPhone.msisdn]] as const) {
      const row = rows.find((r) => r.userId === userId)!
      const received = await fakes.sms({ to: number })
      expect(received, number).toHaveLength(1)
      expect(received[0]).toMatchObject({ sender: 'FieGH', message: row.body, sandbox: false })
      expect(received[0].message.length).toBeLessThanOrEqual(160)
      expect(received[0].message).toMatch(/^[\x20-\x7E]+$/)
      expect(row.providerMessageId).toBe(received[0].id)
      expect(received[0].callback_url).toMatch(new RegExp(`${SMS_PATH}${row.id}/[0-9a-f]{64}$`))
    }
    // Nothing goes twice on later runs
    await cron('send-messages')
    expect(await fakes.sms({ to: msisdn })).toHaveLength(1)
  })

  test('a delivery report marks the SMS delivered once; a forged link or a wrong id changes nothing', async ({ world }) => {
    const { person, msisdn } = await personWithPhone(world)
    const queued = await queueSms(person.id)
    await tried(person.id)
    const [sms] = await fakes.sms({ to: msisdn })
    expect((await fakes.smsReport(sms.id, 'DELIVERED', { forged: true })).statuses).toEqual([404])
    expect((await fakes.smsReport(sms.id, 'DELIVERED', { smsId: 'not-the-id' })).statuses).toEqual([404])
    expect(await db.messageLog.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: 'SENT', deliveryStatus: null })

    expect((await fakes.smsReport(sms.id, 'SUBMITTED')).statuses).toEqual([200])
    expect(await db.messageLog.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: 'SENT', deliveryStatus: 'SUBMITTED' })
    // The same report three times at once, then a late failure: delivered, once
    expect((await fakes.smsReport(sms.id, 'DELIVERED', { times: 3 })).statuses).toEqual([200, 200, 200])
    expect((await fakes.smsReport(sms.id, 'EXPIRED', { method: 'POST' })).statuses).toEqual([200])
    const row = await db.messageLog.findUniqueOrThrow({ where: { id: queued.id } })
    expect(row).toMatchObject({ status: 'DELIVERED', deliveryStatus: 'DELIVERED' })
    expect(row.deliveryUpdatedAt).not.toBeNull()
    // A report never makes the job send it again
    await cron('send-messages')
    expect(await fakes.sms({ to: msisdn })).toHaveLength(1)
  })

  test('an SMS that was not delivered is marked so, never FAILED, and is not sent again', async ({ world }) => {
    const { person, msisdn } = await personWithPhone(world)
    const queued = await queueSms(person.id)
    await tried(person.id)
    const [sms] = await fakes.sms({ to: msisdn })
    expect((await fakes.smsReport(sms.id, 'NOT_DELIVERED')).statuses).toEqual([200])
    expect(await db.messageLog.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: 'UNDELIVERED', deliveryStatus: 'NOT_DELIVERED' })
    await cron('send-messages')
    expect(await fakes.sms({ to: msisdn })).toHaveLength(1)
  })
})

test.describe('Arkesel failing', () => {
  test('out of credit (402): retried later with an SMS_LOW_BALANCE alert, and sent once after a top-up', async ({ world }) => {
    const { person, msisdn } = await personWithPhone(world)
    const undo = await fakes.rule('arkesel', 'http402', { match: msisdn })
    await queueSms(person.id)
    const rows = await tried(person.id)
    expect(rows.map((r) => r.status)).toEqual(['FAILED'])
    expect(rows[0].error).toBe('Arkesel refused the message (HTTP 402, Insufficient balance or invalid coverage!)')
    await until(async () => (await fakes.sentry('SMS_LOW_BALANCE')).length > 0, 'an SMS_LOW_BALANCE report to Sentry')
    expect(await fakes.sms({ to: msisdn })).toHaveLength(0)
    await undo()
    await dueNow(person.id)
    const after = await tried(person.id)
    expect(after.map((r) => [r.status, r.attempts])).toEqual([['SENT', 2]])
    expect(await fakes.sms({ to: msisdn })).toHaveLength(1)
  })

  for (const behaviour of ['http429', 'http502', 'http503'] as const) {
    test(`a ${behaviour.slice(4)} is retried and then sent once`, async ({ world }) => {
      const { person, msisdn } = await personWithPhone(world)
      const undo = await fakes.rule('arkesel', behaviour, { match: msisdn, times: 1 })
      await queueSms(person.id)
      expect((await tried(person.id)).map((r) => r.status)).toEqual(['FAILED'])
      await undo()
      await dueNow(person.id)
      expect((await tried(person.id)).map((r) => r.status)).toEqual(['SENT'])
      expect(await fakes.sms({ to: msisdn })).toHaveLength(1)
    })
  }

  for (const [behaviour, why] of [['http500', 'a 500'], ['malformed', 'a 200 that cannot be read'], ['reset', 'a dropped connection']] as const) {
    test(`${why} is UNKNOWN and never sent again`, async ({ world }) => {
      const { person, msisdn } = await personWithPhone(world)
      const undo = await fakes.rule('arkesel', behaviour, { match: msisdn })
      await queueSms(person.id)
      const rows = await tried(person.id)
      await undo()
      expect(rows.map((r) => r.status)).toEqual(['UNKNOWN'])
      await db.messageLog.updateMany({ where: { userId: person.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
      await cron('send-messages'); await cron('send-messages')
      expect((await fakes.calls({ endpoint: 'arkesel', match: msisdn })).length).toBe(1)
    })
  }

  test('no answer within the time limit is UNKNOWN and never sent again', async ({ world }) => {
    const { person, msisdn } = await personWithPhone(world)
    const undo = await fakes.rule('arkesel', 'hang', { match: msisdn })
    await queueSms(person.id)
    const rows = await tried(person.id, 40_000)
    await undo()
    expect(rows.map((r) => r.status)).toEqual(['UNKNOWN'])
    expect(rows[0].error).toMatch(/^Outcome unknown \((Arkesel did not answer in time|no answer within 8 seconds)\)/)
    await cron('send-messages')
    expect((await fakes.calls({ endpoint: 'arkesel', match: msisdn })).length).toBe(1)
  })

  test('a refused sender ID or key is given up at once, with an alert, and not sent twice', async ({ world }) => {
    for (const [behaviour, message] of [['http422', 'The sender id is not registered.'], ['http401', 'Authentication failed (fake)']] as const) {
      const { person, msisdn } = await personWithPhone(world)
      const undo = await fakes.rule('arkesel', behaviour, { match: msisdn, message })
      await queueSms(person.id)
      const rows = await tried(person.id)
      await undo()
      expect(rows.map((r) => [r.status, r.attempts]), behaviour).toEqual([['GAVE_UP', 1]])
      expect(rows[0].error).toContain(message)
      await cron('send-messages')
      expect(await fakes.sms({ to: msisdn })).toHaveLength(0)
    }
  })

  test('a stored number that is not a mobile is given up without calling Arkesel, and is not stored in the log', async ({ world }) => {
    const { person } = await personWithPhone(world)
    // A fixed line passes the sign-up check but is not a mobile: refused before Arkesel is called
    await db.user.update({ where: { id: person.id }, data: { phone: '0302123456' } })
    await queueSms(person.id)
    const rows = await tried(person.id)
    expect(rows.map((r) => [r.status, r.error])).toEqual([['GAVE_UP', 'Not a valid Ghana mobile number']])
    expect((await fakes.calls({ endpoint: 'arkesel', match: '302123456' })).length).toBe(0)
    expect(JSON.stringify(rows)).not.toContain('302123456')
  })
})

test.describe('the SMS balance job', () => {
  test('reads the balance and alerts once a day when it is below the level', async () => {
    await db.authRequest.deleteMany({ where: { kind: 'SMS_BALANCE_ALERTED' } })
    try {
      await fakes.setSmsBalance(100_000)
      expect((await cron('sms-balance')).json).toMatchObject({ mode: 'live', ok: true, smsBalance: 100000, low: false, alerted: false })
      await fakes.setSmsBalance(120)
      expect((await cron('sms-balance')).json).toMatchObject({ smsBalance: 120, threshold: 500, low: true, alerted: true })
      expect((await cron('sms-balance')).json).toMatchObject({ low: true, alerted: false })
      await until(async () => (await fakes.sentry('SMS_BALANCE_LOW')).length > 0, 'an SMS_BALANCE_LOW report to Sentry')
      // A dry run calls nothing
      const before = (await fakes.calls({ endpoint: 'arkesel-balance' })).length
      expect((await cron('sms-balance', { dryRun: true })).json).toMatchObject({ mode: 'dry-run', called: false })
      expect((await fakes.calls({ endpoint: 'arkesel-balance' })).length).toBe(before)
    } finally {
      await fakes.setSmsBalance(100_000)
      await db.authRequest.deleteMany({ where: { kind: 'SMS_BALANCE_ALERTED' } })
    }
  })
})

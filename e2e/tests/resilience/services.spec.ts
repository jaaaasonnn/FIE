import fs from 'fs'
import path from 'path'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes, until } from '../../lib/fakes'
import { measured, serverErrors, together } from '../../lib/race'
import { cron } from '../../lib/world'

// Email, storage and the exchange-rate service failing.

/** A piece of an email address nobody else has: the rule is set on it before the person is made. */
/** Runs the send job until this person's emails have been tried (other tests' runs of the job are going on beside this one). */
async function tried(userId: string) {
  return until(async () => {
    await cron('send-messages')
    const rows = await db.messageLog.findMany({ where: { userId, channel: 'EMAIL' } })
    return rows.length > 0 && rows.every((m) => !['QUEUED', 'SENDING'].includes(m.status)) ? rows : null
  }, 'the emails to be tried', 20_000)
}
const newTag = () => `svc${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`

test.describe('email failing', () => {
  test('Resend answers 500: the message is kept and sent on a later run, once', async ({ world }) => {
    const tag = newTag()
    const undo = await fakes.rule('resend', 'http500', { match: tag })
    const person = await world.guest({ tag })
    const failed = await tried(person.id)
    expect(failed.every((m) => m.status === 'FAILED' || m.status === 'PENDING'), JSON.stringify(failed.map((m) => m.status))).toBe(true)
    expect(await fakes.inbox(person.email)).toHaveLength(0)
    await undo()
    // The retry is due five minutes later
    await db.messageLog.updateMany({ where: { userId: person.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }).catch(() => {})
    await until(async () => { await cron('send-messages'); return (await db.messageLog.count({ where: { userId: person.id, channel: 'EMAIL', status: 'SENT' } })) === failed.length }, 'the kept emails to be sent', 15_000)
    const inbox = await fakes.inbox(person.email)
    expect(inbox).toHaveLength(failed.length)
    expect(new Set(inbox.map((m) => m.subject)).size).toBe(inbox.length)
  })

  test('Resend refuses the message outright: given up at once, Sentry is told, nothing is sent twice', async ({ world }) => {
    const tag = newTag()
    const undo = await fakes.rule('resend', 'http400', { match: tag, message: 'Invalid `to` field' })
    const person = await world.guest({ tag })
    const rows = await tried(person.id)
    await undo()
    measured(`after Resend refused with HTTP 400 the emails are ${[...new Set(rows.map((m) => m.status))]}`)
    expect(rows.every((m) => m.status === 'GAVE_UP'), JSON.stringify(rows.map((m) => m.status))).toBe(true)
    await cron('send-messages')
    expect(await fakes.inbox(person.email)).toHaveLength(0)
  })

  test('Resend drops the connection half way: the message is closed as unsure and never sent again', async ({ world }) => {
    const tag = newTag()
    const undo = await fakes.rule('resend', 'reset', { match: tag })
    const person = await world.guest({ tag })
    const rows = await tried(person.id)
    await undo()
    expect(rows.every((m) => m.status === 'UNKNOWN'), JSON.stringify(rows.map((m) => m.status))).toBe(true)
    await cron('send-messages'); await cron('send-messages')
    // It may or may not have reached the person: sending again could mean two copies, so it is not sent again
    expect(await fakes.inbox(person.email)).toHaveLength(0)
  })

  test('the send job starts on two servers at once: each email goes once', async ({ world }) => {
    const people = await Promise.all(Array.from({ length: 4 }, () => world.guest()))
    const runs = await together(() => cron('send-messages', { server: 0 }), () => cron('send-messages', { server: 1 }), () => cron('send-messages', { server: 0 }), () => cron('send-messages', { server: 1 }))
    expect(serverErrors(runs)).toEqual([])
    for (const person of people) {
      const inbox = await until(async () => { const m = await fakes.inbox(person.email); return m.length >= 2 ? m : null }, `the emails to ${person.email}`)
      expect(inbox.map((m) => m.subject).sort(), 'one welcome and one confirmation link, no copies').toEqual(['Confirm your email address for FieGH', 'Welcome to FieGH'])
    }
  })
})

test.describe('storage failing', () => {
  const photo = () => { const form = new FormData(); form.append('photos', new File([fs.readFileSync(path.join(__dirname, '../../fixtures/photo.jpg'))], 'photo.jpg', { type: 'image/jpeg' })); return form }

  test('a photo upload works, and the file is where the listing says it is', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    const up = await host.call('POST', `/api/listings/${home.id}/photos`, undefined, { form: photo() })
    expect(up.status, up.text).toBe(200)
    const photos: string[] = JSON.parse((await db.listing.findUniqueOrThrow({ where: { id: home.id } })).photos)
    expect(photos).toHaveLength(1)
    expect(photos[0]).toContain(`/storage/v1/object/public/listing-photos/${home.id}/`)
    expect(await fakes.files(`listing-photos/${home.id}/`)).toHaveLength(1)
  })

  test('storage answers 500: the host is told, and the listing does not point at a photo that is not there', async ({ world }) => {
    const host = await world.host()
    const home = await world.listing(host)
    const undo = await fakes.rule('storage', 'http500', { match: home.id })
    const up = await host.call('POST', `/api/listings/${home.id}/photos`, undefined, { form: photo() })
    await undo()
    expect(up.status).toBeGreaterThanOrEqual(400)
    expect(up.text).not.toMatch(/at .*:\d+:\d+|node_modules|e2e-service-key/)
    expect(JSON.parse((await db.listing.findUniqueOrThrow({ where: { id: home.id } })).photos)).toEqual([])
  })
})

test.describe('jobs', () => {
  test('the exchange-rate service fails: the rate in force is kept', async () => {
    const before = await db.exchangeRate.findFirstOrThrow({ orderBy: { updatedAt: 'desc' } })
    const undo = await fakes.rule('rate', 'http500', {})
    const run = await cron('update-exchange-rate')
    await undo()
    expect(run.status).toBeLessThan(600)
    const after = await db.exchangeRate.findFirstOrThrow({ orderBy: { updatedAt: 'desc' } })
    expect(after.usdToGhs).toBe(before.usdToGhs)
  })
})

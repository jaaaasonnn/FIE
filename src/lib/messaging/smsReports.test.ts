import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/lib/testing/fakeDb'

// SMS delivery reports: the signed link, the route Arkesel calls, and what a
// report may change in the message log. Against the in-memory database; no
// test here reaches anything outside.

const state = vi.hoisted(() => ({ tables: {} as Tables }))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { GET, POST } from '@/app/api/webhooks/sms/arkesel/[logId]/[sig]/route'
import { FINAL_REPORTS, SMS_REPORT_PATH, deliveryReportUrl, recordDeliveryReport, reportSignature, reportSignatureValid } from '@/lib/messaging/smsReports'
import { LIMITS, SMS_REPORT_REFUSED } from '@/lib/rateLimit'

const SECRET = 'sms-webhook-secret-for-tests-only-0123456789'
const SMS_ID = '9b752841-7ee7-4d40-b4fe-768bfb1da4f0'
const NOW = new Date('2027-03-01T10:00:00Z')

const sign = (logId: string) => crypto.createHmac('sha256', SECRET).update(`sms-report:${logId}`).digest('hex')
const sent = (over: Record<string, unknown> = {}) => {
  const row = {
    id: `msg_${(state.tables.messageLog ?? []).length + 1}`, event: 'booking.confirmed', channel: 'SMS', provider: 'arkesel',
    status: 'SENT', providerMessageId: SMS_ID, deliveryStatus: null, deliveryUpdatedAt: null, sentAt: NOW, ...over,
  }
  ;(state.tables.messageLog ??= []).push(row)
  return row
}
let ipCount = 0
const freshIp = () => `10.1.${Math.floor(++ipCount / 250)}.${ipCount % 250}`
/** Arkesel calling the link: GET with the two query parameters, unless told otherwise */
const report = async (logId: string, { sig = sign(logId), smsId = SMS_ID, status = 'DELIVERED', method = 'GET', ip = '10.0.0.1', body, type }: {
  sig?: string; smsId?: string | null; status?: string | null; method?: 'GET' | 'POST'; ip?: string; body?: string; type?: string
} = {}) => {
  const query = new URLSearchParams()
  if (smsId !== null) query.set('sms_id', smsId)
  if (status !== null) query.set('status', status)
  const req = new Request(`https://fiegh.com${SMS_REPORT_PATH}/${logId}/${sig}${query.size ? `?${query}` : ''}`, {
    method, headers: { 'x-real-ip': ip, ...(type ? { 'content-type': type } : {}) }, ...(body !== undefined ? { body } : {}),
  })
  const handler = method === 'GET' ? GET : POST
  const res = await handler(req, { params: Promise.resolve({ logId, sig }) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const refusals = () => (state.tables.authRequest ?? []).filter((r) => r.kind === SMS_REPORT_REFUSED)

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key]
  vi.unstubAllEnvs()
  vi.stubEnv('SMS_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('NEXTAUTH_SECRET', 'nextauth-secret-for-tests')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

describe('the report link', () => {
  it('is signed for one row, and only with a secret of at least 32 characters', () => {
    expect(deliveryReportUrl('https://fiegh.com', 'msg_1')).toBe(`https://fiegh.com${SMS_REPORT_PATH}/msg_1/${sign('msg_1')}`)
    expect(reportSignature('msg_1', SECRET)).not.toBe(reportSignature('msg_2', SECRET))
    for (const secret of ['', '   ', 'x'.repeat(31)]) {
      vi.stubEnv('SMS_WEBHOOK_SECRET', secret)
      expect(deliveryReportUrl('https://fiegh.com', 'msg_1')).toBeNull()
      expect(reportSignatureValid('msg_1', sign('msg_1'))).toBe(false)
    }
  })

  it('accepts only the signature for that row, compared in constant time', () => {
    expect(reportSignatureValid('msg_1', sign('msg_1'))).toBe(true)
    expect(reportSignatureValid('msg_2', sign('msg_1'))).toBe(false)
    expect(reportSignatureValid('msg_1', sign('msg_1').toUpperCase())).toBe(false)
    expect(reportSignatureValid('msg_1', sign('msg_1').slice(0, 63))).toBe(false)
    expect(reportSignatureValid('msg_1', '')).toBe(false)
    expect(reportSignatureValid('msg_1', crypto.createHmac('sha256', 'another-secret-of-enough-length-000').update('sms-report:msg_1').digest('hex'))).toBe(false)
    const source = fs.readFileSync(path.resolve(__dirname, 'smsReports.ts'), 'utf8')
    expect(source).toContain('crypto.timingSafeEqual(')
    expect(source).not.toMatch(/signature ===|=== signature|smsId ===|providerMessageId ===/)
  })
})

describe('a delivery report', () => {
  it('marks a sent SMS delivered, with Arkesel\'s word and the time', async () => {
    const row = sent()
    expect(await report(row.id)).toEqual({ status: 200, json: { received: true } })
    expect(row).toMatchObject({ status: 'DELIVERED', deliveryStatus: 'DELIVERED', deliveryUpdatedAt: NOW })
  })

  it('marks it UNDELIVERED for every final failure, and never FAILED, which would send it again', async () => {
    for (const word of ['NOT_DELIVERED', 'EXPIRED', 'PROHIBITED', 'not_delivered']) {
      const row = sent()
      expect((await report(row.id, { status: word })).status).toBe(200)
      expect(row, word).toMatchObject({ status: 'UNDELIVERED', deliveryStatus: word.toUpperCase() })
    }
    expect(Object.values(FINAL_REPORTS)).not.toContain('FAILED')
  })

  it('notes a report that is not final and changes nothing else', async () => {
    for (const word of ['SUBMITTED', 'QUEUED', 'SENT']) {
      const row = sent()
      expect((await report(row.id, { status: word })).status).toBe(200)
      expect(row, word).toMatchObject({ status: 'SENT', deliveryStatus: word })
    }
  })

  it('is idempotent: the same report again, or a late one, changes nothing after the final one', async () => {
    const row = sent()
    await report(row.id, { status: 'DELIVERED' })
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    for (const word of ['DELIVERED', 'EXPIRED', 'SUBMITTED']) expect((await report(row.id, { status: word })).status).toBe(200)
    expect(row).toMatchObject({ status: 'DELIVERED', deliveryStatus: 'DELIVERED', deliveryUpdatedAt: NOW })
    // Two reports at the same instant: one final word wins, and it stays
    const other = sent()
    await Promise.all([report(other.id, { status: 'DELIVERED' }), report(other.id, { status: 'EXPIRED' })])
    expect(['DELIVERED', 'UNDELIVERED']).toContain(other.status)
    const settled = other.status
    await report(other.id, { status: settled === 'DELIVERED' ? 'EXPIRED' : 'DELIVERED' })
    expect(other.status).toBe(settled)
  })

  it('changes only a SENT row: never one that was not sent, gave up, or whose outcome is unknown', async () => {
    for (const status of ['QUEUED', 'SENDING', 'FAILED', 'GAVE_UP', 'UNKNOWN', 'LOGGED', 'SKIPPED']) {
      const row = sent({ status })
      expect((await report(row.id)).status, status).toBe(200)
      expect(row, status).toMatchObject({ status, deliveryStatus: null })
    }
    expect(await recordDeliveryReport({ logId: sent({ status: 'UNKNOWN' }).id, smsId: SMS_ID, status: 'DELIVERED' })).toBe('not-sent')
  })

  it('takes the two values from a POST body too, as JSON or a form', async () => {
    const a = sent()
    expect((await report(a.id, { method: 'POST', smsId: null, status: null, type: 'application/json', body: JSON.stringify({ sms_id: SMS_ID, status: 'DELIVERED' }) })).status).toBe(200)
    expect(a.status).toBe('DELIVERED')
    const b = sent()
    expect((await report(b.id, { method: 'POST', smsId: null, status: null, type: 'application/x-www-form-urlencoded', body: `sms_id=${SMS_ID}&status=EXPIRED` })).status).toBe(200)
    expect(b.status).toBe('UNDELIVERED')
    // A JSON body that cannot be read is 400
    expect((await report(sent().id, { method: 'POST', smsId: null, status: null, type: 'application/json', body: '{"sms_id": "x\\u0000"}' })).status).toBe(400)
  })

  it('answers 400 for a report with no status, or a null byte in the query, and changes nothing', async () => {
    const row = sent()
    expect((await report(row.id, { status: null })).status).toBe(400)
    expect((await report(row.id, { status: 'DELIVERED; DROP' })).status).toBe(400)
    expect((await report(row.id, { status: 'DELIVERED\u0000' })).status).toBe(400)
    expect(row.status).toBe('SENT')
  })
})

describe('a report that is refused', () => {
  it('is 404, whatever was wrong, and changes nothing', async () => {
    const row = sent()
    const other = sent({ providerMessageId: 'another-id' })
    const email = sent({ channel: 'EMAIL', provider: 'resend' })
    const cases = [
      () => report(row.id, { sig: sign('msg_999') }),                  // a signature for another row
      () => report(row.id, { sig: 'f'.repeat(64) }),                    // a made-up signature
      () => report(row.id, { sig: 'not-hex' }),
      () => report(row.id, { smsId: 'another-id' }),                    // the provider's id does not match
      () => report(row.id, { smsId: null }),
      () => report(other.id, { smsId: SMS_ID }),
      () => report(email.id),                                          // not an Arkesel SMS
      () => report('msg_404'),                                         // no such row, though signed
      () => report('../../users', { sig: sign('../../users') }),
    ]
    for (const [i, attempt] of cases.entries()) {
      const res = await attempt()
      expect(res, `case ${i}`).toEqual({ status: 404, json: { error: 'Not found' } })
    }
    expect(row).toMatchObject({ status: 'SENT', deliveryStatus: null })
    expect(other).toMatchObject({ status: 'SENT', deliveryStatus: null })
    expect(email).toMatchObject({ status: 'SENT', deliveryStatus: null })
  })

  it('refuses every report while no secret is set', async () => {
    const row = sent()
    vi.stubEnv('SMS_WEBHOOK_SECRET', '')
    expect((await report(row.id)).status).toBe(404)
    expect(row.status).toBe('SENT')
  })

  it('is counted against the caller\'s address, which is refused outright after 20 in an hour', async () => {
    const row = sent()
    const ip = freshIp()
    for (let i = 0; i < LIMITS.smsReportRefusalsPerIp.max; i++) expect((await report(row.id, { sig: 'f'.repeat(64), ip })).status).toBe(404)
    expect(refusals()).toHaveLength(20)
    // Now even a good report from that address is refused, before anything is checked
    expect((await report(row.id, { ip })).status).toBe(429)
    expect(row.status).toBe('SENT')
    // Another address is not affected, and a good report writes no count
    expect((await report(row.id, { ip: freshIp() })).status).toBe(200)
    expect(refusals()).toHaveLength(20)
    expect(row.status).toBe('DELIVERED')
    // An hour later the address may try again
    vi.setSystemTime(new Date(NOW.getTime() + 61 * 60_000))
    expect((await report(sent().id, { ip })).status).toBe(200)
  })

  it('stores no address, only a hash of it', async () => {
    await report(sent().id, { sig: 'f'.repeat(64), ip: '10.9.8.7' })
    expect(JSON.stringify(state.tables.authRequest)).not.toContain('10.9.8.7')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real Arkesel adapter, the real switch, the real sending job and the real
// test-SMS script, against a stubbed fetch and an in-memory message log. No
// test here can reach Arkesel: fetch is replaced before every test, and the
// key is a made-up one.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ logs: [] as Row[], users: [] as Row[] }))
const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)

vi.mock('@/lib/db', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
      const value = row[key] ?? null
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; lte?: Date }
        if ('in' in c && !c.in!.includes(value)) return false
        if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
        return true
      }
      return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond
    })
  const apply = (row: Row, data: Row) => {
    for (const [key, v] of Object.entries(data)) {
      row[key] = v !== null && typeof v === 'object' && 'increment' in v ? (row[key] as number) + (v as { increment: number }).increment : v
    }
  }
  return {
    db: {
      user: {
        findUnique: async ({ where }: { where: Row }) => {
          const row = state.users.find((u) => matches(u, where))
          return row ? { ...row } : null
        },
      },
      messageLog: {
        findMany: async ({ where, take }: { where: Row; take?: number }) => {
          await tick()
          return state.logs.filter((l) => matches(l, where)).slice(0, take).map((l) => ({ ...l }))
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const rows = state.logs.filter((l) => matches(l, where))
          rows.forEach((r) => apply(r, data))
          return { count: rows.length }
        },
        update: async ({ where, data }: { where: Row; data: Row }) => {
          const row = state.logs.find((l) => l.id === where.id)!
          apply(row, data)
          return { ...row }
        },
      },
    },
  }
})

import crypto from 'crypto'
import { channelGate } from '@/lib/messaging/config'
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, runMessages } from '@/lib/messaging/deliver'
import { PROVIDERS } from '@/lib/messaging/providers'
import { ARKESEL_BALANCE_URL, ARKESEL_SEND_URL, arkeselBalance, arkeselSms, sendArkesel, senderIdValid } from '@/lib/messaging/providers/arkesel'
import type { OutgoingMessage } from '@/lib/messaging/providers/types'
import { SMS_REPORT_PATH } from '@/lib/messaging/smsReports'
import { TEST_SMS_TEXT, planTestSms, runTestSms } from '@/lib/messaging/testSms'

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2027-03-01T10:00:00Z')
const MIN = 60 * 1000
const KEY = 'ark_test_NotARealKey_7d1e93b0c4'
const SECRET = 'sms-webhook-secret-for-tests-only-0123456789'
const PHONE = '0241234567'
const at = (ms: number) => new Date(NOW.getTime() + ms)

const fetchMock = vi.fn()
const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })
const accepted = (id = '9b752841-7ee7-4d40-b4fe-768bfb1da4f0') => answer(200, { status: 'success', data: [{ recipient: '233241234567', id }] })
const sentOk = () => fetchMock.mockImplementation(async () => accepted())
/** The one request made, as Arkesel would receive it */
const request = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit]
  return { url, init, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }
}
const message = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  to: PHONE, from: 'FieGH', text: 'FieGH: Booking confirmed. Details: https://fiegh.com/bookings/booking_1',
  idempotencyKey: 'booking.confirmed:booking_1:guest_1:SMS', signal: new AbortController().signal, ...over,
})
const live = () => {
  vi.stubEnv('MESSAGING_ENABLED', 'true')
  vi.stubEnv('SMS_PROVIDER', 'arkesel')
}
/** One SMS waiting to go, as notify() would have written it */
const queue = (over: Row = {}) => {
  const n = state.logs.length + 1
  const row = {
    id: `msg_${n}`, event: 'booking.confirmed', channel: 'SMS', userId: 'guest_1', recipientRole: 'GUEST',
    recipientMasked: '+233 24 *** **67', bookingId: 'booking_1', dedupeKey: `booking.confirmed:booking_${n}:guest_1:SMS`,
    subject: null, body: 'FieGH: Booking confirmed. Details: https://fiegh.com/bookings/booking_1', status: 'QUEUED', provider: 'arkesel',
    providerMessageId: null, error: null, attempts: 0, claimedAt: null, nextAttemptAt: null, sentAt: null, alertedAt: null,
    deliveryStatus: null, deliveryUpdatedAt: null, createdAt: NOW, ...over,
  }
  state.logs.push(row)
  return row
}
const consoleSpies = () => (['error', 'warn', 'info', 'log', 'debug'] as const).map((method) => vi.mocked(console[method]))
/** Everything a key or a number could leak into: the message log, the console and Sentry */
const everythingRecorded = () => JSON.stringify([
  state.logs,
  consoleSpies().map((spy) => spy.mock.calls),
  sentry.captureMessage.mock.calls,
  sentry.captureException.mock.calls,
])
const lowBalanceAlerts = () => sentry.captureMessage.mock.calls.filter(([, ctx]) => ctx?.tags?.messaging_issue === 'SMS_LOW_BALANCE')

beforeEach(() => {
  state.logs.length = 0
  state.users.length = 0
  state.users.push({ id: 'guest_1', email: 'ama@example.test', phone: '+233241234567' })
  sentry.captureException.mockReset()
  sentry.captureMessage.mockReset()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => { throw new Error('this test did not expect a call to Arkesel') })
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('ARKESEL_API_KEY', KEY)
  vi.stubEnv('NEXTAUTH_URL', 'https://fiegh.com')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'warn', 'info', 'log', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

// Whatever a test did, the key and any whole phone number must not have been written anywhere
afterEach(() => {
  const recorded = everythingRecorded()
  expect(recorded).not.toContain(KEY)
  expect(recorded).not.toMatch(/233241234567|0241234567|241234567/)
  vi.restoreAllMocks()
})

// ─── The adapter ────────────────────────────────────────────────────────────

describe('the Arkesel adapter', () => {
  it('is an SMS adapter named arkesel, and the only place the name leads', () => {
    expect(arkeselSms).toMatchObject({ name: 'arkesel', channel: 'SMS' })
    expect(arkeselSms.testOnly).toBeUndefined()
    expect(PROVIDERS.arkesel).toBe(arkeselSms)
  })

  it('posts one message to Arkesel\'s v2 send endpoint and returns its id', async () => {
    sentOk()
    expect(await sendArkesel(message())).toEqual({ ok: true, providerMessageId: '9b752841-7ee7-4d40-b4fe-768bfb1da4f0' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init, headers, body } = request()
    expect(url).toBe(ARKESEL_SEND_URL)
    expect(init.method).toBe('POST')
    expect(headers['Content-Type']).toBe('application/json')
    expect(body).toEqual({ sender: 'FieGH', message: message().text, recipients: ['233241234567'] })
  })

  it('puts the key in the api-key header only, never in the message', async () => {
    sentOk()
    await sendArkesel(message())
    const { headers, init } = request()
    expect(headers['api-key']).toBe(KEY)
    expect(init.body as string).not.toContain(KEY)
    expect(Object.entries(headers).filter(([, v]) => v.includes(KEY)).map(([k]) => k)).toEqual(['api-key'])
  })

  it('sends every accepted form of a Ghana mobile number as 233XXXXXXXXX', async () => {
    sentOk()
    for (const to of ['0241234567', '+233241234567', '233241234567', '+233 24 123 4567']) await sendArkesel(message({ to }))
    expect(fetchMock.mock.calls.map((_, i) => request(i).body.recipients)).toEqual(Array(4).fill(['233241234567']))
  })

  it('refuses for good, without calling Arkesel, a number that is not a Ghana mobile number', async () => {
    for (const to of ['0302123456', '+447700900123', '024123456', 'not a number', '+2330241234567']) {
      expect(await sendArkesel(message({ to })), to).toEqual({ ok: false, retryable: false, issue: 'BAD_NUMBER', error: 'Not a valid Ghana mobile number' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses for good, without calling Arkesel, a sender ID Arkesel would refuse and a text that is not one plain SMS', async () => {
    for (const from of ['', 'FieGH Ghana Ltd', 'Fie-GH', '12345']) {
      expect(await sendArkesel(message({ from })), from).toMatchObject({ ok: false, retryable: false, issue: 'SENDER_ID' })
    }
    for (const text of ['x'.repeat(161), 'Café', 'a`b', '']) {
      expect(await sendArkesel(message({ text })), text).toMatchObject({ ok: false, retryable: false, issue: 'CONTENT' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(senderIdValid('FieGH')).toBe(true)
    expect(senderIdValid('FieGH Homes')).toBe(true)
  })

  it('asks for a delivery report only when it is given a report link, and uses the sandbox only when asked', async () => {
    sentOk()
    await sendArkesel(message({ reportUrl: 'https://fiegh.com/api/webhooks/sms/arkesel/msg_1/abc' }))
    await sendArkesel(message(), { sandbox: true })
    expect(request(0).body.callback_url).toBe('https://fiegh.com/api/webhooks/sms/arkesel/msg_1/abc')
    expect(request(0).body.sandbox).toBeUndefined()
    expect(request(1).body.callback_url).toBeUndefined()
    expect(request(1).body.sandbox).toBe(true)
  })

  it('waits for a missing key without calling Arkesel', async () => {
    vi.stubEnv('ARKESEL_API_KEY', '')
    expect(await sendArkesel(message())).toEqual({ ok: false, retryable: true, error: 'ARKESEL_API_KEY is not set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [429, true, undefined],
    [502, true, undefined],
    [503, true, undefined],
    [504, true, undefined],
    [402, true, 'LOW_BALANCE'],
    [401, false, 'AUTH'],
    [403, false, 'ACCOUNT'],
    [404, false, undefined],
  ])('maps HTTP %i to retryable=%s (%s)', async (status, retryable, issue) => {
    fetchMock.mockImplementation(async () => answer(status, { status: 'error', message: 'Refused' }))
    const result = await sendArkesel(message())
    expect(result).toMatchObject({ ok: false, retryable, error: `Arkesel refused the message (HTTP ${status}, Refused)` })
    expect((result as { issue?: string }).issue).toBe(issue)
  })

  it('tells a refused sender ID from other refused fields', async () => {
    fetchMock.mockImplementation(async () => answer(422, { status: 'error', message: 'The sender id is not registered.' }))
    expect(await sendArkesel(message())).toMatchObject({ ok: false, retryable: false, issue: 'SENDER_ID' })
    fetchMock.mockImplementation(async () => answer(422, { status: 'error', message: 'The message field is required.' }))
    expect(await sendArkesel(message())).toMatchObject({ ok: false, retryable: false, issue: 'CONTENT' })
  })

  it('throws on a 500 or any other 5xx it is not sure about, so it is never retried', async () => {
    for (const status of [500, 501, 505]) {
      fetchMock.mockImplementation(async () => answer(status, { status: 'error', message: 'SMS request failed!' }))
      await expect(sendArkesel(message())).rejects.toThrow(`Arkesel refused the message (HTTP ${status}, SMS request failed!)`)
    }
  })

  it('refuses for good a number Arkesel lists as invalid', async () => {
    fetchMock.mockImplementation(async () => answer(200, { status: 'success', data: [{ 'invalid numbers': ['233241234567'] }] }))
    expect(await sendArkesel(message())).toEqual({ ok: false, retryable: false, issue: 'BAD_NUMBER', error: 'Arkesel refused the number as invalid' })
  })

  it('throws on a 200 it cannot read, since the message may have gone', async () => {
    for (const body of [undefined, {}, { status: 'success' }, { status: 'success', data: [] }, { status: 'success', data: [{ recipient: '233241234567' }] }, { data: 'x' }]) {
      fetchMock.mockImplementation(async () => answer(200, body))
      await expect(sendArkesel(message()), JSON.stringify(body)).rejects.toThrow('Arkesel answered 200 without an id for the message')
    }
  })

  it('takes the key and any number out of an error, even when Arkesel repeats them back', async () => {
    fetchMock.mockImplementation(async () => answer(422, { status: 'error', message: `Key ${KEY} cannot send to 233241234567` }))
    const result = await sendArkesel(message())
    expect(result).toMatchObject({ ok: false, error: 'Arkesel refused the message (HTTP 422, Key [key] cannot send to [number])' })
  })

  it('still gives a safe error when the refusal is not JSON', async () => {
    fetchMock.mockImplementation(async () => answer(503))
    expect(await sendArkesel(message())).toEqual({ ok: false, retryable: true, error: 'Arkesel refused the message (HTTP 503)' })
  })

  it('throws fixed words on a network error, so nothing of the error is kept', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError(`fetch failed: ${KEY} 233241234567`) })
    await expect(sendArkesel(message())).rejects.toThrow(/^Arkesel could not be reached$/)
  })

  it('throws on a timeout, and stops when the sending job\'s own limit passes', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
    }))
    const sending = sendArkesel(message({ signal: controller.signal }))
    controller.abort()
    await expect(sending).rejects.toThrow(/^Arkesel did not answer in time$/)
  })

  it('writes nothing to the console, whatever happens', async () => {
    for (const reply of [() => accepted(), () => answer(402, { message: 'Insufficient balance or invalid coverage!' }), () => answer(500), () => { throw new Error('x') }]) {
      fetchMock.mockImplementation(async () => reply())
      await sendArkesel(message()).catch(() => {})
    }
    for (const spy of consoleSpies()) expect(spy).not.toHaveBeenCalled()
  })
})

describe('the Arkesel balance', () => {
  it('reads the SMS balance with the key in the header', async () => {
    fetchMock.mockImplementation(async () => answer(200, { status: 'success', data: { sms_balance: '2003', main_balance: 'GHS 20.99' } }))
    expect(await arkeselBalance()).toEqual({ ok: true, smsBalance: 2003, mainBalance: 'GHS 20.99' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ARKESEL_BALANCE_URL)
    expect((init.headers as Record<string, string>)['api-key']).toBe(KEY)
  })

  it('gives a safe error, never the key, when it cannot be read', async () => {
    fetchMock.mockImplementation(async () => answer(401, { message: `Invalid key ${KEY}` }))
    expect(await arkeselBalance()).toEqual({ ok: false, error: 'Arkesel refused the balance check (HTTP 401, Invalid key [key])' })
    fetchMock.mockImplementation(async () => answer(200, { status: 'success', data: { sms_balance: 'lots' } }))
    expect(await arkeselBalance()).toEqual({ ok: false, error: 'Arkesel answered without an SMS balance' })
    vi.stubEnv('ARKESEL_API_KEY', '')
    fetchMock.mockClear()
    expect(await arkeselBalance()).toEqual({ ok: false, error: 'ARKESEL_API_KEY is not set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── The switch ─────────────────────────────────────────────────────────────

describe('switching Arkesel on', () => {
  it('is live only with MESSAGING_ENABLED exactly "true" and SMS_PROVIDER=arkesel', () => {
    const cases: [string | undefined, string | undefined, boolean][] = [
      [undefined, undefined, false], ['true', undefined, false], [undefined, 'arkesel', false],
      ['TRUE', 'arkesel', false], ['1', 'arkesel', false], ['yes', 'arkesel', false],
      ['true', 'log', false], ['true', 'Arkesel', false], ['true', 'arkesel ', true], ['true', 'arkesel', true],
    ]
    for (const [enabled, provider, liveNow] of cases) {
      vi.unstubAllEnvs()
      if (enabled !== undefined) vi.stubEnv('MESSAGING_ENABLED', enabled)
      if (provider !== undefined) vi.stubEnv('SMS_PROVIDER', provider)
      expect(channelGate('SMS').live, `${enabled} ${provider}`).toBe(liveNow)
    }
  })

  it('is never an email adapter, and is live in production', () => {
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    vi.stubEnv('EMAIL_PROVIDER', 'arkesel')
    expect(channelGate('EMAIL').live).toBe(false)
    vi.stubEnv('SMS_PROVIDER', 'arkesel')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(channelGate('SMS')).toEqual({ live: true, provider: 'arkesel' })
  })

  it('calls nothing while either switch is off: SMS are closed as logged', async () => {
    for (const [enabled, provider] of [['false', 'arkesel'], ['true', 'log'], ['true', '']]) {
      vi.stubEnv('MESSAGING_ENABLED', enabled)
      vi.stubEnv('SMS_PROVIDER', provider)
      const row = queue()
      await runMessages()
      expect(row.status).toBe('LOGGED')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── The sending job ────────────────────────────────────────────────────────

describe('the send-messages job with Arkesel', () => {
  beforeEach(live)

  it('sends from FieGH to the number in 233 form and records Arkesel\'s id', async () => {
    sentOk()
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'sent', attempts: 1 }])
    expect(request().body).toMatchObject({ sender: 'FieGH', recipients: ['233241234567'], message: row.body })
    expect(row).toMatchObject({ status: 'SENT', provider: 'arkesel', providerMessageId: '9b752841-7ee7-4d40-b4fe-768bfb1da4f0', sentAt: NOW, error: null })
  })

  it('takes the sender from SMS_SENDER_ID', async () => {
    sentOk()
    vi.stubEnv('SMS_SENDER_ID', 'FieGH Homes')
    queue()
    await runMessages()
    expect(request().body.sender).toBe('FieGH Homes')
  })

  it('asks for a delivery report on a link signed for that one row, only when the secret is set', async () => {
    sentOk()
    queue()
    await runMessages()
    expect(request(0).body.callback_url).toBeUndefined()
    // Too short to be a secret: treated as unset
    vi.stubEnv('SMS_WEBHOOK_SECRET', 'short')
    queue()
    await runMessages()
    expect(request(1).body.callback_url).toBeUndefined()
    vi.stubEnv('SMS_WEBHOOK_SECRET', SECRET)
    const row = queue()
    await runMessages()
    const signature = crypto.createHmac('sha256', SECRET).update(`sms-report:${row.id}`).digest('hex')
    expect(request(2).body.callback_url).toBe(`https://fiegh.com${SMS_REPORT_PATH}/${row.id}/${signature}`)
    // The secret is never stored or logged
    expect(everythingRecorded()).not.toContain(SECRET)
  })

  it('retries a low balance on the usual schedule, with one SMS_LOW_BALANCE alert a run, then gives up', async () => {
    fetchMock.mockImplementation(async () => answer(402, { status: 'error', message: 'Insufficient balance or invalid coverage!' }))
    const rows = [queue(), queue(), queue()]
    expect((await runMessages()).results.map((r) => r.action)).toEqual(['will-retry', 'will-retry', 'will-retry'])
    expect(lowBalanceAlerts()).toHaveLength(1)
    expect(lowBalanceAlerts()[0][1]).toMatchObject({ level: 'error', fingerprint: ['messaging', 'SMS_LOW_BALANCE'], contexts: { message: { provider: 'arkesel', held: 3 } } })
    for (const row of rows) expect(row).toMatchObject({ status: 'FAILED', attempts: 1, nextAttemptAt: at(RETRY_DELAYS_MS[0]) })
    // A second run before the wait is over calls nothing and alerts nothing
    await runMessages({ now: at(MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(lowBalanceAlerts()).toHaveLength(1)
    let now = 0
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      now += RETRY_DELAYS_MS[attempt - 2]
      await runMessages({ now: at(now) })
    }
    expect(rows.map((r) => r.status)).toEqual(['GAVE_UP', 'GAVE_UP', 'GAVE_UP'])
    expect(lowBalanceAlerts()).toHaveLength(MAX_ATTEMPTS)
  })

  it('sends a low-balance message once the account is topped up', async () => {
    fetchMock.mockImplementationOnce(async () => answer(402, { message: 'Insufficient balance or invalid coverage!' }))
    const row = queue()
    await runMessages()
    sentOk()
    await runMessages({ now: at(RETRY_DELAYS_MS[0]) })
    expect(row).toMatchObject({ status: 'SENT', attempts: 2 })
  })

  it('retries 429, 502, 503 and 504 with the same message', async () => {
    for (const status of [429, 502, 503, 504]) {
      state.logs.length = 0
      fetchMock.mockReset()
      fetchMock.mockImplementationOnce(async () => answer(status, { message: 'Busy' }))
      const row = queue()
      await runMessages()
      expect(row, String(status)).toMatchObject({ status: 'FAILED', attempts: 1 })
      sentOk()
      await runMessages({ now: at(RETRY_DELAYS_MS[0]) })
      expect(row, String(status)).toMatchObject({ status: 'SENT', attempts: 2 })
    }
    expect(lowBalanceAlerts()).toHaveLength(0)
  })

  it('records a 500 as unknown and never retries it', async () => {
    fetchMock.mockImplementation(async () => answer(500, { status: 'error', message: 'SMS request failed!' }))
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'unknown' }])
    expect(row.status).toBe('UNKNOWN')
    expect(row.error).toBe('Outcome unknown (Arkesel refused the message (HTTP 500, SMS request failed!)). It is not sent again in case it went.')
    await runMessages({ now: at(600 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('records a timeout and a network error as unknown and never retries them', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('fetch failed') })
    const first = queue()
    await runMessages()
    expect(first).toMatchObject({ status: 'UNKNOWN', error: 'Outcome unknown (Arkesel could not be reached). It is not sent again in case it went.' })
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 5)
      return controller.signal
    })
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('The operation timed out', 'TimeoutError')))
    }))
    const second = queue()
    await runMessages()
    expect(second.status).toBe('UNKNOWN')
    expect(second.error).toMatch(/^Outcome unknown \((Arkesel did not answer in time|no answer within 8 seconds)\)/)
    await runMessages({ now: at(600 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up at once, with an alert, on a bad key, an inactive account or a refused sender ID', async () => {
    for (const [status, text] of [[401, 'Invalid API key'], [403, 'Inactive SMS Gateway!'], [422, 'The sender id is not registered.']] as const) {
      fetchMock.mockImplementation(async () => answer(status, { status: 'error', message: text }))
      const row = queue()
      await runMessages()
      expect(row, String(status)).toMatchObject({ status: 'GAVE_UP', attempts: 1, error: `Arkesel refused the message (HTTP ${status}, ${text})` })
    }
    const gaveUp = sentry.captureMessage.mock.calls.filter(([, ctx]) => ctx?.tags?.messaging_issue === 'GAVE_UP')
    expect(gaveUp).toHaveLength(3)
    expect(lowBalanceAlerts()).toHaveLength(0)
  })

  it('gives up on a stored number that is not a mobile, without calling Arkesel or recording the number', async () => {
    state.users[0].phone = '0302123456'
    const row = queue()
    await runMessages()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(row).toMatchObject({ status: 'GAVE_UP', error: 'Not a valid Ghana mobile number' })
    expect(everythingRecorded()).not.toContain('302123456')
  })

  it('never stores the key, even when Arkesel repeats it in a refusal', async () => {
    fetchMock.mockImplementation(async () => answer(422, { status: 'error', message: `Bad key ${KEY}` }))
    const row = queue()
    await runMessages()
    expect(row.error).toBe('Arkesel refused the message (HTTP 422, Bad key [key])')
  })

  it('does not send again on the next run, or when two runs overlap', async () => {
    sentOk()
    queue()
    await Promise.all([runMessages(), runMessages()])
    await runMessages({ now: at(10 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ─── The manual test SMS ────────────────────────────────────────────────────

describe('the manual test SMS', () => {
  const printed = () => {
    const lines: string[] = []
    return { lines, print: (line: string) => { lines.push(line) } }
  }

  it('refuses without --confirm, saying what it would send and to whom (masked)', () => {
    expect(planTestSms([PHONE])).toEqual({ ok: false, why: 'This sends a real SMS to +233 24 *** **67, which is charged. Add --confirm to send it.' })
    expect(planTestSms([PHONE, '--sandbox'])).toEqual({ ok: false, why: 'This sends a sandbox SMS to +233 24 *** **67. Add --confirm to send it.' })
  })

  it('refuses anything but one valid Ghana mobile number, and unknown options', () => {
    expect(planTestSms(['--confirm'])).toMatchObject({ ok: false, why: 'Give exactly one Ghana mobile number.' })
    expect(planTestSms([PHONE, '0201234567', '--confirm'])).toMatchObject({ ok: false, why: 'Give exactly one Ghana mobile number.' })
    expect(planTestSms(['0302123456', '--confirm'])).toMatchObject({ ok: false })
    expect(planTestSms([PHONE, '--confirm', '--force'])).toEqual({ ok: false, why: 'Unknown option --force.' })
    expect(planTestSms(['+233241234567', '--confirm'])).toEqual({ ok: true, to: '233241234567', sandbox: false })
  })

  it('refuses without ARKESEL_API_KEY or with a sender ID Arkesel would refuse', () => {
    vi.stubEnv('ARKESEL_API_KEY', '')
    expect(planTestSms([PHONE, '--confirm'])).toEqual({ ok: false, why: 'ARKESEL_API_KEY is not set.' })
    vi.stubEnv('ARKESEL_API_KEY', KEY)
    vi.stubEnv('SMS_SENDER_ID', 'FieGH Ghana Limited')
    expect(planTestSms([PHONE, '--confirm'])).toEqual({ ok: false, why: 'SMS_SENDER_ID must be 1 to 11 letters, digits or spaces.' })
  })

  it('sends one fixed message in Arkesel\'s sandbox with --sandbox, whatever the switches say, and prints the id', async () => {
    sentOk()
    const out = printed()
    expect(await runTestSms([PHONE, '--confirm', '--sandbox'], out.print)).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(request().body).toEqual({ sender: 'FieGH', message: TEST_SMS_TEXT, recipients: ['233241234567'], sandbox: true })
    expect(out.lines).toEqual([
      'Sending one sandbox (not delivered, not charged) test SMS to +233 24 *** **67 from FieGH',
      'Sent. Arkesel id: 9b752841-7ee7-4d40-b4fe-768bfb1da4f0',
    ])
    // Nothing written to the database
    expect(state.logs).toHaveLength(0)
    expect(TEST_SMS_TEXT.length).toBeLessThanOrEqual(160)
  })

  it('sends a real one without --sandbox, and prints safe reasons when it fails', async () => {
    sentOk()
    expect(await runTestSms([PHONE, '--confirm'], printed().print)).toBe(0)
    expect(request().body.sandbox).toBeUndefined()

    fetchMock.mockImplementation(async () => answer(402, { message: `Insufficient balance ${KEY}` }))
    let out = printed()
    expect(await runTestSms([PHONE, '--confirm'], out.print)).toBe(1)
    expect(out.lines[1]).toBe('Not sent. Arkesel refused the message (HTTP 402, Insufficient balance [key]) Top up the Arkesel account.')

    fetchMock.mockImplementation(async () => { throw new TypeError('fetch failed') })
    out = printed()
    expect(await runTestSms([PHONE, '--confirm'], out.print)).toBe(1)
    expect(out.lines[1]).toBe('Outcome unknown: Arkesel could not be reached. Check the SMS history in the Arkesel dashboard before trying again.')

    const nothing = printed()
    expect(await runTestSms([PHONE], nothing.print)).toBe(1)
    expect(nothing.lines.join('\n')).not.toMatch(/241234567/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real Resend adapter, the real switch and the real sending job, against
// a stubbed fetch and an in-memory message log. No test here can reach
// Resend: fetch is replaced before every test, and the key is a made-up one.

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

import { channelGate } from '@/lib/messaging/config'
import { RETRY_DELAYS_MS, runMessages } from '@/lib/messaging/deliver'
import { PROVIDERS } from '@/lib/messaging/providers'
import { RESEND_URL, resendEmail } from '@/lib/messaging/providers/resend'
import type { OutgoingMessage } from '@/lib/messaging/providers/types'
import { planTestSend, runTestSend } from '@/lib/messaging/testSend'

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2027-03-01T10:00:00Z')
const MIN = 60 * 1000
const KEY = 're_test_NotARealKey_4f9c2a71d0'
const GUEST_EMAIL = 'ama.owusu@example.test'
const at = (ms: number) => new Date(NOW.getTime() + ms)

const fetchMock = vi.fn()
const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })
const sentOk = () => fetchMock.mockImplementation(async () => answer(200, { id: 'resend_id_1' }))
/** The one request made, as Resend would receive it */
const request = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit]
  return { url, init, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }
}
const message = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  to: GUEST_EMAIL, from: 'FieGH <support@fiegh.com>', replyTo: 'support@fiegh.com',
  subject: 'Booking confirmed', text: 'Your booking is confirmed.', html: '<p>Your booking is confirmed.</p>',
  idempotencyKey: 'booking.confirmed:booking_1:guest_1:EMAIL', signal: new AbortController().signal, ...over,
})

const live = () => {
  vi.stubEnv('MESSAGING_ENABLED', 'true')
  vi.stubEnv('EMAIL_PROVIDER', 'resend')
}
/** One email waiting to go, as notify() would have written it */
const queue = (over: Row = {}) => {
  const row = {
    id: `msg_${state.logs.length + 1}`, event: 'booking.confirmed', channel: 'EMAIL', userId: 'guest_1', recipientRole: 'GUEST',
    recipientMasked: 'a***@example.test', bookingId: 'booking_1', dedupeKey: 'booking.confirmed:booking_1:guest_1:EMAIL',
    subject: 'Booking confirmed', body: 'Your booking is confirmed.\n\nFieGH', status: 'QUEUED', provider: 'resend',
    providerMessageId: null, error: null, attempts: 0, claimedAt: null, nextAttemptAt: null, sentAt: null, alertedAt: null,
    createdAt: NOW, ...over,
  }
  state.logs.push(row)
  return row
}
const consoleSpies = () => (['error', 'warn', 'info', 'log', 'debug'] as const).map((method) => vi.mocked(console[method]))
/** Everything a key could leak into: the message log, the console and Sentry */
const everythingRecorded = () => JSON.stringify([
  state.logs,
  consoleSpies().map((spy) => spy.mock.calls),
  sentry.captureMessage.mock.calls,
  sentry.captureException.mock.calls,
])

beforeEach(() => {
  state.logs.length = 0
  state.users.length = 0
  state.users.push({ id: 'guest_1', email: GUEST_EMAIL, phone: null })
  sentry.captureException.mockReset()
  sentry.captureMessage.mockReset()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => { throw new Error('this test did not expect a call to Resend') })
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('RESEND_API_KEY', KEY)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'warn', 'info', 'log', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

// Whatever a test did, the key must not have been written anywhere
afterEach(() => {
  expect(everythingRecorded()).not.toContain(KEY)
  vi.restoreAllMocks()
})

// ─── The adapter ────────────────────────────────────────────────────────────

describe('the Resend adapter', () => {
  it('is an email adapter named resend, and the only place the name leads', () => {
    expect(resendEmail).toMatchObject({ name: 'resend', channel: 'EMAIL' })
    expect(PROVIDERS.resend).toBe(resendEmail)
  })

  it('posts the message to Resend and returns its id', async () => {
    sentOk()
    const signal = new AbortController().signal
    expect(await resendEmail.send(message({ signal }))).toEqual({ ok: true, providerMessageId: 'resend_id_1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init, headers, body } = request()
    expect(url).toBe(RESEND_URL)
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(signal)
    expect(headers).toEqual({
      Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
      'Idempotency-Key': 'booking.confirmed:booking_1:guest_1:EMAIL',
    })
    expect(body).toEqual({
      from: 'FieGH <support@fiegh.com>', to: [GUEST_EMAIL], reply_to: 'support@fiegh.com',
      subject: 'Booking confirmed', text: 'Your booking is confirmed.', html: '<p>Your booking is confirmed.</p>',
    })
  })

  it('sends the from and reply-to it is given, unchanged', async () => {
    sentOk()
    await resendEmail.send(message({ from: 'FieGH Stays <hello@mail.fiegh.com>', replyTo: 'help@fiegh.com' }))
    expect(request().body).toMatchObject({ from: 'FieGH Stays <hello@mail.fiegh.com>', reply_to: 'help@fiegh.com' })
  })

  it('puts the key in the Authorization header only, never in the message', async () => {
    sentOk()
    await resendEmail.send(message())
    const { url, init, headers } = request()
    expect(url).not.toContain(KEY)
    expect(init.body as string).not.toContain(KEY)
    expect(Object.entries(headers).filter(([, value]) => value.includes(KEY)).map(([name]) => name)).toEqual(['Authorization'])
  })

  it('counts a 2xx with no readable id as sent', async () => {
    fetchMock.mockImplementation(async () => answer(200))
    expect(await resendEmail.send(message())).toEqual({ ok: true })
  })

  it.each([429, 500, 502, 503])('says a %i can be tried again', async (status) => {
    fetchMock.mockImplementation(async () => answer(status, { name: 'application_error', message: 'Try again later' }))
    expect(await resendEmail.send(message())).toEqual({
      ok: false, retryable: true, error: `Resend refused the message (HTTP ${status}, application_error: Try again later)`,
    })
  })

  it.each([400, 401, 403, 404, 422])('says a %i will not fix itself', async (status) => {
    fetchMock.mockImplementation(async () => answer(status, { name: 'validation_error', message: 'The domain is not verified' }))
    expect(await resendEmail.send(message())).toEqual({
      ok: false, retryable: false, error: `Resend refused the message (HTTP ${status}, validation_error: The domain is not verified)`,
    })
  })

  it('still gives a safe error when the refusal is not JSON', async () => {
    fetchMock.mockImplementation(async () => answer(503))
    expect(await resendEmail.send(message())).toEqual({ ok: false, retryable: true, error: 'Resend refused the message (HTTP 503)' })
  })

  it('takes the key out of an error even when Resend repeats it back', async () => {
    fetchMock.mockImplementation(async () => answer(401, { name: 'invalid_api_key', message: `API key ${KEY} is invalid. ${'x'.repeat(500)}` }))
    const result = await resendEmail.send(message())
    expect(result).toMatchObject({ ok: false, retryable: false })
    const error = (result as { error: string }).error
    expect(error).toContain('API key [key] is invalid')
    expect(error).not.toContain(KEY)
    expect(error.length).toBeLessThan(220)
  })

  it('throws fixed words on a network error, so it is never retried and nothing of the error is kept', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError(`fetch failed: ECONNRESET with Bearer ${KEY} to ${GUEST_EMAIL}`) })
    const error = await resendEmail.send(message()).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Resend could not be reached')
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it('throws on a timeout, so it is never retried', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('The operation timed out', 'TimeoutError')))
    }))
    const sending = resendEmail.send(message({ signal: controller.signal }))
    controller.abort()
    await expect(sending).rejects.toThrow('Resend did not answer in time')
  })

  it('throws on a 409, because Resend may already be sending that message', async () => {
    fetchMock.mockImplementation(async () => answer(409, { name: 'concurrent_idempotent_requests', message: 'Same key, still in progress' }))
    await expect(resendEmail.send(message())).rejects.toThrow('Resend refused the message (HTTP 409, concurrent_idempotent_requests: Same key, still in progress)')
  })

  it.each([undefined, '', '   '])('calls nothing when RESEND_API_KEY is %j, and says it can be tried again', async (value) => {
    vi.stubEnv('RESEND_API_KEY', value as string)
    expect(await resendEmail.send(message())).toEqual({ ok: false, retryable: true, error: 'RESEND_API_KEY is not set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('writes nothing to the console, whatever happens', async () => {
    sentOk()
    await resendEmail.send(message())
    fetchMock.mockImplementation(async () => answer(401, { name: 'invalid_api_key', message: `API key ${KEY} is invalid` }))
    await resendEmail.send(message())
    fetchMock.mockImplementation(async () => { throw new Error(`boom ${KEY}`) })
    await resendEmail.send(message()).catch(() => {})
    for (const spy of consoleSpies()) expect(spy).not.toHaveBeenCalled()
  })
})

// ─── The switch ─────────────────────────────────────────────────────────────

describe('switching Resend on', () => {
  const OFF: [string, string][] = [
    ['', 'resend'], ['TRUE', 'resend'], ['1', 'resend'], ['yes', 'resend'], ['true ', 'resend'],
    ['true', ''], ['true', 'log'], ['true', 'Resend'], ['true', 'resend-email'],
  ]

  it.each(OFF)('sends nothing with MESSAGING_ENABLED=%j and EMAIL_PROVIDER=%j', async (enabled, provider) => {
    vi.stubEnv('MESSAGING_ENABLED', enabled)
    vi.stubEnv('EMAIL_PROVIDER', provider)
    expect(channelGate('EMAIL')).toMatchObject({ live: false, provider: 'log' })
    const row = queue()
    const run = await runMessages()
    expect(run.email).toEqual({ live: false, provider: 'log' })
    expect(run.results).toMatchObject([{ action: 'closed' }])
    expect(row).toMatchObject({ status: 'LOGGED', attempts: 0, sentAt: null, providerMessageId: null })
    expect(fetchMock).not.toHaveBeenCalled()
    // Closed for good: switching on afterwards does not send it
    live()
    sentOk()
    await runMessages({ now: at(5 * MIN) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is live only with MESSAGING_ENABLED=true and EMAIL_PROVIDER=resend', () => {
    expect(channelGate('EMAIL')).toMatchObject({ live: false })
    live()
    expect(channelGate('EMAIL')).toEqual({ live: true, provider: 'resend' })
  })

  it('is never an SMS adapter', () => {
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    vi.stubEnv('SMS_PROVIDER', 'resend')
    expect(channelGate('SMS')).toMatchObject({ live: false, provider: 'log', reason: 'SMS_PROVIDER names no SMS adapter' })
  })
})

// ─── Through the sending job ────────────────────────────────────────────────

describe('the send-messages job with Resend', () => {
  beforeEach(live)

  it('sends from "FieGH <support@fiegh.com>" with reply-to support@fiegh.com, and records Resend\'s id', async () => {
    sentOk()
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'sent', attempts: 1 }])
    expect(request().body).toMatchObject({
      from: 'FieGH <support@fiegh.com>', reply_to: 'support@fiegh.com', to: [GUEST_EMAIL], subject: 'Booking confirmed',
    })
    expect(request().headers['Idempotency-Key']).toBe(row.dedupeKey)
    expect(row).toMatchObject({ status: 'SENT', provider: 'resend', providerMessageId: 'resend_id_1', sentAt: NOW, error: null, attempts: 1 })
  })

  it('takes the sender from EMAIL_FROM and the reply-to from SUPPORT_EMAIL', async () => {
    vi.stubEnv('EMAIL_FROM', 'FieGH Stays <hello@mail.fiegh.com>')
    vi.stubEnv('SUPPORT_EMAIL', 'help@fiegh.com')
    sentOk()
    queue()
    await runMessages()
    expect(request().body).toMatchObject({ from: 'FieGH Stays <hello@mail.fiegh.com>', reply_to: 'help@fiegh.com' })
  })

  it('no longer reads EMAIL_FROM_NAME or EMAIL_FROM_ADDRESS', async () => {
    vi.stubEnv('EMAIL_FROM_NAME', 'Old Name')
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'old@fiegh.com')
    sentOk()
    queue()
    await runMessages()
    expect(request().body.from).toBe('FieGH <support@fiegh.com>')
  })

  it('does not send again on the next run, or when two runs overlap', async () => {
    sentOk()
    queue()
    await Promise.all([runMessages(), runMessages()])
    await runMessages({ now: at(5 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('marks a refusal failed with a safe message, retries it on schedule with the same key, and does not crash', async () => {
    fetchMock.mockImplementation(async () => answer(500, { name: 'application_error', message: `Could not deliver to ${GUEST_EMAIL}` }))
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'will-retry', attempts: 1 }])
    expect(row).toMatchObject({
      status: 'FAILED', attempts: 1, providerMessageId: null, sentAt: null, nextAttemptAt: at(RETRY_DELAYS_MS[0]),
      error: 'Resend refused the message (HTTP 500, application_error: Could not deliver to [email])',
    })
    // Not before its time
    await runMessages({ now: at(RETRY_DELAYS_MS[0] - 1) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    sentOk()
    expect((await runMessages({ now: at(RETRY_DELAYS_MS[0]) })).results).toMatchObject([{ action: 'sent', attempts: 2 }])
    expect(row).toMatchObject({ status: 'SENT', providerMessageId: 'resend_id_1', error: null })
    expect(request(1).headers['Idempotency-Key']).toBe(request(0).headers['Idempotency-Key'])
  })

  it('gives up at once, with one alert, on a refusal that will not fix itself', async () => {
    fetchMock.mockImplementation(async () => answer(403, { name: 'validation_error', message: 'The fiegh.com domain is not verified' }))
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'gave-up' }])
    expect(row).toMatchObject({ status: 'GAVE_UP', error: 'Resend refused the message (HTTP 403, validation_error: The fiegh.com domain is not verified)' })
    await runMessages({ now: at(600 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
  })

  it('never stores the key, even when Resend\'s error repeats it', async () => {
    fetchMock.mockImplementation(async () => answer(401, { name: 'invalid_api_key', message: `API key ${KEY} is invalid` }))
    const row = queue()
    await runMessages()
    expect(row).toMatchObject({ status: 'GAVE_UP', error: 'Resend refused the message (HTTP 401, invalid_api_key: API key [key] is invalid)' })
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
    expect(everythingRecorded()).not.toContain(KEY)
  })

  it('records a network error as unknown, never retries it, and carries on with the rest', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError(`fetch failed with Bearer ${KEY}`) })
    fetchMock.mockImplementation(async () => answer(200, { id: 'resend_id_2' }))
    const first = queue()
    const second = queue({ dedupeKey: 'refund.sent:refund_1:guest_1:EMAIL', event: 'refund.sent', createdAt: at(1) })
    const run = await runMessages()
    expect(run.results.map((r) => r.action)).toEqual(['unknown', 'sent'])
    expect(first).toMatchObject({ status: 'UNKNOWN', attempts: 1, error: 'Outcome unknown (Resend could not be reached). It is not sent again in case it went.' })
    expect(second).toMatchObject({ status: 'SENT', providerMessageId: 'resend_id_2' })
    await runMessages({ now: at(600 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('records a timeout as unknown and never retries it', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 5)
      return controller.signal
    })
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('The operation timed out', 'TimeoutError')))
    }))
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'unknown' }])
    expect(row.status).toBe('UNKNOWN')
    expect(row.error).toMatch(/^Outcome unknown \((Resend did not answer in time|no answer within 8 seconds)\)/)
    await runMessages({ now: at(600 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('records a 409 as unknown and never retries it', async () => {
    fetchMock.mockImplementation(async () => answer(409, { name: 'concurrent_idempotent_requests', message: 'Still in progress' }))
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'unknown' }])
    expect(row).toMatchObject({ status: 'UNKNOWN' })
    await runMessages({ now: at(600 * MIN) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('waits for a missing key without calling Resend, then sends once the key is there', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'will-retry' }])
    expect(row).toMatchObject({ status: 'FAILED', error: 'RESEND_API_KEY is not set', nextAttemptAt: at(RETRY_DELAYS_MS[0]) })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('RESEND_API_KEY', KEY)
    sentOk()
    await runMessages({ now: at(RETRY_DELAYS_MS[0]) })
    expect(row).toMatchObject({ status: 'SENT', providerMessageId: 'resend_id_1' })
  })

  it('skips someone with no address without calling Resend', async () => {
    state.users[0].email = null
    const row = queue()
    expect((await runMessages()).results).toMatchObject([{ action: 'skipped' }])
    expect(row).toMatchObject({ status: 'SKIPPED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves a row that was skipped or only logged when it was written alone', async () => {
    sentOk()
    queue({ status: 'SKIPPED', error: 'optional emails are turned off' })
    queue({ status: 'LOGGED', dedupeKey: 'other' })
    expect((await runMessages()).checked).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── The manual test script ─────────────────────────────────────────────────

describe('the manual test email', () => {
  const printed: string[] = []
  const print = (line: string) => { printed.push(line) }
  beforeEach(() => { printed.length = 0 })

  it.each([
    [['you@example.test'], 'This sends a real email to you@example.test. Add --confirm to send it.'],
    [['--confirm'], 'Give exactly one email address.'],
    [[], 'Give exactly one email address.'],
    [['a@example.test', 'b@example.test', '--confirm'], 'Give exactly one email address.'],
    [['not-an-address', '--confirm'], 'That is not a valid email address.'],
    [['you@example.test', '--confirm', '--force'], 'Unknown option --force.'],
    [['you@example.test', '--Confirm'], 'Unknown option --Confirm.'],
  ])('refuses %j and sends nothing', async (args, why) => {
    sentOk()
    expect(planTestSend(args)).toEqual({ ok: false, why })
    expect(await runTestSend(args, print)).toBe(1)
    expect(printed[0]).toBe(`Nothing sent. ${why}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses without RESEND_API_KEY', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    expect(await runTestSend(['you@example.test', '--confirm'], print)).toBe(1)
    expect(printed[0]).toBe('Nothing sent. RESEND_API_KEY is not set.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends one email to the address given with --confirm, whatever the switches say, and prints the id', async () => {
    sentOk()
    expect(await runTestSend([' You@Example.test ', '--confirm'], print, NOW)).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(request().body).toMatchObject({
      to: ['you@example.test'], from: 'FieGH <support@fiegh.com>', reply_to: 'support@fiegh.com', subject: 'FieGH test email',
    })
    expect(printed.at(-1)).toBe('Sent. Resend id: resend_id_1')
    expect(printed.join('\n')).not.toContain(KEY)
    expect(state.logs).toHaveLength(0)
  })

  it('prints a safe reason when Resend refuses or cannot be reached', async () => {
    fetchMock.mockImplementation(async () => answer(401, { name: 'invalid_api_key', message: `API key ${KEY} is invalid` }))
    expect(await runTestSend(['you@example.test', '--confirm'], print)).toBe(1)
    expect(printed.at(-1)).toBe('Not sent. Resend refused the message (HTTP 401, invalid_api_key: API key [key] is invalid)')
    fetchMock.mockImplementation(async () => { throw new Error(`boom ${KEY}`) })
    expect(await runTestSend(['you@example.test', '--confirm'], print)).toBe(1)
    expect(printed.at(-1)).toContain('Outcome unknown: Resend could not be reached.')
    expect(printed.join('\n')).not.toContain(KEY)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/lib/testing/fakeDb'

// The hourly SMS balance check and its cron route, against a stubbed fetch
// and the in-memory database. No test here can reach Arkesel.

const state = vi.hoisted(() => ({ tables: {} as Tables }))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(), captureMessage: vi.fn(),
  withMonitor: vi.fn((_slug: string, run: () => unknown) => run()),
}))
vi.mock('@sentry/nextjs', () => sentry)

import fs from 'fs'
import path from 'path'
import { GET, POST } from '@/app/api/cron/sms-balance/route'
import { ARKESEL_BALANCE_URL } from '@/lib/messaging/providers/arkesel'
import { runSmsBalance } from '@/lib/messaging/smsBalance'

const KEY = 'ark_test_NotARealKey_7d1e93b0c4'
const NOW = new Date('2027-03-01T10:20:00Z')
const HOUR = 60 * 60 * 1000
const fetchMock = vi.fn()
const balance = (sms: unknown) => fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { sms_balance: sms, main_balance: 'GHS 2.10' } }), { status: 200 }))
const lowAlerts = () => sentry.captureMessage.mock.calls.filter(([, ctx]) => ctx?.tags?.messaging_issue === 'SMS_BALANCE_LOW')
const live = () => {
  vi.stubEnv('MESSAGING_ENABLED', 'true')
  vi.stubEnv('SMS_PROVIDER', 'arkesel')
  vi.stubEnv('SMS_LOW_BALANCE_ALERT', '500')
}
const cron = (query = '', method: 'GET' | 'POST' = 'GET', secret: string | null = 'cron-secret-value') =>
  (method === 'GET' ? GET : POST)(new Request(`https://fiegh.com/api/cron/sms-balance${query}`, { method, headers: secret ? { authorization: `Bearer ${secret}` } : {} }))

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key]
  sentry.captureMessage.mockReset()
  sentry.withMonitor.mockClear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => { throw new Error('this test did not expect a call to Arkesel') })
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('ARKESEL_API_KEY', KEY)
  vi.stubEnv('CRON_SECRET', 'cron-secret-value')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

describe('the SMS balance check', () => {
  it('never calls Arkesel unless MESSAGING_ENABLED=true and SMS_PROVIDER=arkesel are both set', async () => {
    vi.stubEnv('SMS_LOW_BALANCE_ALERT', '500')
    for (const [enabled, provider] of [[undefined, undefined], ['true', undefined], [undefined, 'arkesel'], ['TRUE', 'arkesel'], ['true', 'log'], ['true', 'fail-drill-sms'], ['false', 'arkesel']]) {
      vi.stubEnv('MESSAGING_ENABLED', enabled ?? '')
      vi.stubEnv('SMS_PROVIDER', provider ?? '')
      expect(await runSmsBalance(), `${enabled} ${provider}`).toMatchObject({ mode: 'off', called: false })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls nothing without a usable SMS_LOW_BALANCE_ALERT, or on a dry run', async () => {
    live()
    for (const value of ['', '0', '-5', 'lots', '1.5']) {
      vi.stubEnv('SMS_LOW_BALANCE_ALERT', value)
      expect(await runSmsBalance(), value).toMatchObject({ mode: 'off', called: false, reason: 'SMS_LOW_BALANCE_ALERT is not set to a whole number above zero' })
    }
    vi.stubEnv('SMS_LOW_BALANCE_ALERT', '500')
    expect(await runSmsBalance({ dryRun: true })).toMatchObject({ mode: 'dry-run', called: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the balance once and stays quiet while it is at or above the level', async () => {
    live()
    balance('500')
    expect(await runSmsBalance()).toEqual({ mode: 'live', called: true, ok: true, smsBalance: 500, threshold: 500, low: false, alerted: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(ARKESEL_BALANCE_URL)
    expect(lowAlerts()).toHaveLength(0)
  })

  it('alerts below the level, at most once a day', async () => {
    live()
    balance('120')
    expect(await runSmsBalance()).toMatchObject({ low: true, alerted: true, smsBalance: 120 })
    expect(lowAlerts()).toHaveLength(1)
    expect(lowAlerts()[0][0]).toBe('The SMS account is running low: 120 SMS credits left (alert level 500). Top up Arkesel.')
    expect(lowAlerts()[0][1]).toMatchObject({ fingerprint: ['messaging', 'SMS_BALANCE_LOW'] })
    // Every hour for the rest of the day: still low, no more alerts
    for (let h = 1; h < 24; h++) {
      vi.setSystemTime(new Date(NOW.getTime() + h * HOUR))
      expect(await runSmsBalance()).toMatchObject({ low: true, alerted: false })
    }
    expect(lowAlerts()).toHaveLength(1)
    // The next day, one more
    vi.setSystemTime(new Date(NOW.getTime() + 24 * HOUR + 1000))
    expect(await runSmsBalance()).toMatchObject({ alerted: true })
    expect(lowAlerts()).toHaveLength(2)
  })

  it('runs at the same instant never alert twice; at worst the alert comes on the next run', async () => {
    live()
    balance(3)
    const runs = await Promise.all([runSmsBalance(), runSmsBalance(), runSmsBalance()])
    // The count-first slot can refuse a burst early, never late
    expect(runs.filter((r) => 'alerted' in r && r.alerted).length).toBeLessThanOrEqual(1)
    const before = lowAlerts().length
    expect(before).toBeLessThanOrEqual(1)
    vi.setSystemTime(new Date(NOW.getTime() + HOUR))
    await runSmsBalance()
    expect(lowAlerts()).toHaveLength(1)
  })

  it('reports a balance it cannot read, without an alert and without the key', async () => {
    live()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ message: `Invalid key ${KEY}` }), { status: 401 }))
    const run = await runSmsBalance()
    expect(run).toEqual({ mode: 'live', called: true, ok: false, error: 'Arkesel refused the balance check (HTTP 401, Invalid key [key])' })
    expect(lowAlerts()).toHaveLength(0)
    expect(JSON.stringify([run, vi.mocked(console.warn).mock.calls, sentry.captureMessage.mock.calls])).not.toContain(KEY)
  })
})

describe('the sms-balance cron route', () => {
  it('needs the cron secret', async () => {
    live()
    expect((await cron('', 'GET', null)).status).toBe(401)
    expect((await cron('', 'POST', 'wrong')).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sentry.withMonitor).not.toHaveBeenCalled()
  })

  it('runs under a Sentry monitor on the schedule vercel.json gives it, and ?dryRun=1 calls nothing', async () => {
    live()
    const res = await cron('?dryRun=1', 'POST')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mode: 'dry-run', called: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sentry.withMonitor).toHaveBeenCalledWith('sms-balance-cron', expect.any(Function), expect.objectContaining({ schedule: { type: 'crontab', value: '20 * * * *' }, timezone: 'UTC' }))
    const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../vercel.json'), 'utf8'))
    expect(vercel.crons).toContainEqual({ path: '/api/cron/sms-balance', schedule: '20 * * * *' })
  })

  it('reads the balance on a live run', async () => {
    live()
    balance('9000')
    expect(await (await cron()).json()).toMatchObject({ mode: 'live', smsBalance: 9000, low: false })
  })
})

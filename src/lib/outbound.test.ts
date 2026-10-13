import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MONEY_TIMEOUT_MS, OutboundTimeoutError, READ_RETRIES, READ_TIMEOUT_MS, STORAGE_TIMEOUT_MS,
  fetchWithLimit, readWithRetry, sendOnce,
} from '@/lib/outbound'

// A server that takes the connection and never answers: the call ends only when its signal says so
const silent = () => vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
}))
const answers = (...statuses: number[]) => {
  const mock = vi.fn(async () => new Response('{}', { status: statuses[Math.min(mock.mock.calls.length - 1, statuses.length - 1)] }))
  return mock
}

afterEach(() => { vi.unstubAllGlobals() })

describe('the limits', () => {
  it('are 10 seconds for a read and 15 for a transfer or a refund', () => {
    expect(READ_TIMEOUT_MS).toBe(10_000)
    expect(MONEY_TIMEOUT_MS).toBe(15_000)
    expect(STORAGE_TIMEOUT_MS).toBe(30_000)
  })
})

describe('a call that moves money', () => {
  it('gives up when the limit passes, and says it was a timeout', async () => {
    const fetchMock = silent()
    vi.stubGlobal('fetch', fetchMock)
    const started = Date.now()
    await expect(sendOnce('https://api.paystack.co/transfer', { method: 'POST' }, 60)).rejects.toBeInstanceOf(OutboundTimeoutError)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is made once, whatever the answer: a 500 is not sent again', async () => {
    const fetchMock = answers(500)
    vi.stubGlobal('fetch', fetchMock)
    expect((await sendOnce('https://api.paystack.co/transfer', { method: 'POST' })).status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is made once when the connection drops, and the error is passed on as it is', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendOnce('https://api.paystack.co/refund', { method: 'POST' })).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('a read', () => {
  it('is tried again after a 5xx or a 429, up to the cap, then hands back the last answer', async () => {
    const fetchMock = answers(500, 429, 503, 200)
    vi.stubGlobal('fetch', fetchMock)
    expect((await readWithRetry('https://api.paystack.co/bank')).status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1 + READ_RETRIES)
  })

  it('stops at the first answer that is not a server fault', async () => {
    for (const status of [200, 400, 404]) {
      const fetchMock = answers(status)
      vi.stubGlobal('fetch', fetchMock)
      expect((await readWithRetry('https://api.paystack.co/bank')).status).toBe(status)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('is tried again after a dropped connection, and succeeds when the next one works', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 })).mockRejectedValueOnce(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    expect((await readWithRetry('https://api.paystack.co/bank')).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never waits longer than its one limit, retries included', async () => {
    const fetchMock = silent()
    vi.stubGlobal('fetch', fetchMock)
    const started = Date.now()
    await expect(readWithRetry('https://api.paystack.co/bank', {}, 80)).rejects.toBeInstanceOf(OutboundTimeoutError)
    expect(Date.now() - started).toBeLessThan(2000)
    // A timeout is the end: the limit has been used up
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('the storage client\'s fetch', () => {
  it('gives up when its limit passes', async () => {
    vi.stubGlobal('fetch', silent())
    await expect(fetchWithLimit(60)('https://storage.example/upload')).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

describe('every call out of the app', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })

  it('goes through lib/outbound.ts: no server code calls fetch by itself', () => {
    const bare = [...files(path.join(ROOT, 'src/lib')), ...files(path.join(ROOT, 'src/app/api'))]
      .filter((file) => /(^|[^.\w])fetch\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file))
      .sort()
    // The helper itself, and Resend, whose time limit is the signal the message job hands it
    expect(bare).toEqual(['src/lib/messaging/providers/resend.ts', 'src/lib/outbound.ts'])
    expect(fs.readFileSync(path.join(ROOT, 'src/lib/messaging/providers/resend.ts'), 'utf8')).toContain('signal: message.signal')
  })

  it('gives the storage client a time limit too', () => {
    expect(fs.readFileSync(path.join(ROOT, 'src/lib/supabase.ts'), 'utf8')).toContain('global: { fetch: fetchWithLimit(STORAGE_TIMEOUT_MS) }')
  })
})

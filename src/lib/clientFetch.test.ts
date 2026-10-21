import { describe, expect, it, vi } from 'vitest'
import { checkSession, fetchRetry, isLoadFailure } from '@/lib/clientFetch'

// G6 and G1: one lost request must not leave a page stuck or sign a person out.

const answer = (status: number, body: unknown = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
const dropped = () => Promise.reject(new TypeError('Failed to fetch'))
const noWait = { sleep: async () => {} }

describe('a read on a weak connection', () => {
  it('is tried again after a dropped connection, and the answer is used', async () => {
    const fetcher = vi.fn().mockImplementationOnce(dropped).mockResolvedValueOnce(answer(200, { ok: true }))
    const res = await fetchRetry('/api/x', undefined, { ...noWait, fetcher })
    expect(res.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('is tried again after a 502, 503, 504 or 500, and not after a 404 or 403', async () => {
    for (const status of [500, 502, 503, 504]) {
      const fetcher = vi.fn().mockResolvedValueOnce(answer(status)).mockResolvedValueOnce(answer(200))
      expect((await fetchRetry('/api/x', undefined, { ...noWait, fetcher })).status).toBe(200)
    }
    for (const status of [400, 401, 403, 404, 409]) {
      const fetcher = vi.fn().mockResolvedValue(answer(status))
      expect((await fetchRetry('/api/x', undefined, { ...noWait, fetcher })).status).toBe(status)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it('stops after three tries, waiting a little longer each time', async () => {
    const waits: number[] = []
    const fetcher = vi.fn().mockImplementation(dropped)
    await expect(fetchRetry('/api/x', undefined, { fetcher, sleep: async (ms) => waits.push(ms) })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([500, 1500])
    const failing = vi.fn().mockResolvedValue(answer(502, '<html>Bad gateway</html>'))
    const res = await fetchRetry('/api/x', undefined, { ...noWait, fetcher: failing })
    expect(isLoadFailure(res)).toBe(true)
    expect(failing).toHaveBeenCalledTimes(3)
  })

  it('never repeats a write', async () => {
    const fetcher = vi.fn()
    await expect(fetchRetry('/api/x', { method: 'POST' }, { ...noWait, fetcher })).rejects.toThrow(/reads only/)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('the session check', () => {
  it('says signed out only on a 401', async () => {
    expect(await checkSession({ ...noWait, fetcher: vi.fn().mockResolvedValue(answer(401, { user: null })) })).toEqual({ kind: 'signed-out' })
    expect(await checkSession({ ...noWait, fetcher: vi.fn().mockResolvedValue(answer(200, { user: { id: 'u1' } })) })).toEqual({ kind: 'user', user: { id: 'u1' } })
  })

  it('does not take a lost answer, a 5xx or a page that is not JSON as signed out', async () => {
    expect(await checkSession({ ...noWait, fetcher: vi.fn().mockImplementation(dropped) })).toEqual({ kind: 'unknown' })
    expect(await checkSession({ ...noWait, fetcher: vi.fn().mockResolvedValue(answer(502, '<html>Bad gateway</html>')) })).toEqual({ kind: 'unknown' })
    expect(await checkSession({ ...noWait, fetcher: vi.fn().mockResolvedValue(answer(200, '<html>captive portal</html>')) })).toEqual({ kind: 'unknown' })
  })

  it('a session check that fails once and then answers finds the person', async () => {
    const fetcher = vi.fn().mockImplementationOnce(dropped).mockResolvedValueOnce(answer(200, { user: { id: 'u1' } }))
    expect(await checkSession({ ...noWait, fetcher })).toEqual({ kind: 'user', user: { id: 'u1' } })
  })
})

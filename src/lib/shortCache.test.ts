import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SHORT_CACHE_MS, cached, forgetCached } from '@/lib/shortCache'

let t = 0
const now = () => t

beforeEach(() => { forgetCached(); t = 1_000_000 })

describe('the short cache for public reads', () => {
  it('asks once in the time it keeps an answer, then again', async () => {
    const load = vi.fn().mockResolvedValueOnce(15.5).mockResolvedValueOnce(15.7)
    expect(await cached('rate', load, { now })).toBe(15.5)
    t += SHORT_CACHE_MS - 1
    expect(await cached('rate', load, { now })).toBe(15.5)
    expect(load).toHaveBeenCalledTimes(1)
    t += 2
    expect(await cached('rate', load, { now })).toBe(15.7)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('requests arriving together share one fetch', async () => {
    let release!: (v: number) => void
    const load = vi.fn(() => new Promise<number>((r) => { release = r }))
    const both = Promise.all([cached('rate', load, { now }), cached('rate', load, { now })])
    release(15.5)
    expect(await both).toEqual([15.5, 15.5])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never keeps a failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('pool timeout')).mockResolvedValueOnce(15.5)
    await expect(cached('rate', load, { now })).rejects.toThrow('pool timeout')
    expect(await cached('rate', load, { now })).toBe(15.5)
  })

  it('forgets on request', async () => {
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    await cached('k', load, { now })
    forgetCached('k')
    expect(await cached('k', load, { now })).toBe(2)
  })
})

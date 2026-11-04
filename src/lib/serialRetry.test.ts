import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)

import { BUSY_TRY_AGAIN, BusyError, SERIAL_ATTEMPTS, SERIAL_BACKOFF_MS, SERIAL_CEILING_MS, isSerializationFailure, serialPause, withSerialRetry } from '@/lib/serialRetry'

const aborted = () => new Prisma.PrismaClientKnownRequestError('could not serialize access', { code: 'P2034', clientVersion: 'test' })
const noPause = { pause: async () => {} }
const alwaysAborted = async () => { throw aborted() }

/** A clock that moves only when told: by each pause, and by `runMs` for each run of the transaction */
function clock(runMs = 0) {
  let t = 1_000_000
  const pauses: number[] = []
  const runStarts: number[] = []
  return {
    pauses, runStarts,
    now: () => t,
    pause: async (ms: number) => { pauses.push(ms); t += ms },
    run: async () => { runStarts.push(t); t += runMs; throw aborted() },
    elapsed: () => t - 1_000_000,
  }
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  sentry.captureMessage.mockClear()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('running an aborted transaction again', () => {
  it('passes a clean result straight on, running once', async () => {
    const run = vi.fn(async () => 'booked')
    expect(await withSerialRetry(run, noPause)).toBe('booked')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs again after Postgres aborts it, and gives the answer of the run that went through', async () => {
    const run = vi.fn(async () => 'booked').mockRejectedValueOnce(aborted()).mockRejectedValueOnce(aborted())
    expect(await withSerialRetry(run, noPause)).toBe('booked')
    expect(run).toHaveBeenCalledTimes(3)
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('gives up after SERIAL_ATTEMPTS runs (12), as "busy", never as the abort itself', async () => {
    expect(SERIAL_ATTEMPTS).toBe(12)
    const run = vi.fn(alwaysAborted)
    await expect(withSerialRetry(run, noPause)).rejects.toBeInstanceOf(BusyError)
    expect(run).toHaveBeenCalledTimes(SERIAL_ATTEMPTS)
    expect(new BusyError().message).toBe(BUSY_TRY_AGAIN)
  })

  it('does not run again for anything else: a real conflict is an answer', async () => {
    const conflict = Object.assign(new Error('DATE_CONFLICT'), { code: 'DATE_CONFLICT' })
    const run = vi.fn(async () => { throw conflict })
    await expect(withSerialRetry(run, noPause)).rejects.toBe(conflict)
    expect(run).toHaveBeenCalledTimes(1)
    expect(isSerializationFailure(conflict)).toBe(false)
    expect(isSerializationFailure(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }))).toBe(false)
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })
})

describe('the pause before each further run', () => {
  it('grows: each step doubles from about 50 ms until it reaches 2 s, and never goes past 2 s', () => {
    const steps = Array.from({ length: SERIAL_ATTEMPTS - 1 }, (_, i) => serialPause(i + 1, 1))
    expect(steps.slice(0, 7)).toEqual([50, 100, 200, 400, 800, 1600, 2000])
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1])
    expect(Math.max(...steps)).toBe(SERIAL_BACKOFF_MS.max)
    // The shortest pause of a later run is never shorter than the shortest of an earlier one
    for (let run = 2; run < SERIAL_ATTEMPTS; run++) expect(serialPause(run, 0)).toBeGreaterThanOrEqual(serialPause(run - 1, 0))
  })

  it('is spread at random between half its step and the whole of it, so runs that collided do not meet again', () => {
    for (let run = 1; run < SERIAL_ATTEMPTS; run++) {
      const step = Math.min(SERIAL_BACKOFF_MS.max, SERIAL_BACKOFF_MS.first * 2 ** (run - 1))
      expect(serialPause(run, 0)).toBe(Math.round(step / 2))
      expect(serialPause(run, 0.999999)).toBe(step)
      expect(serialPause(run, 0.5)).toBeGreaterThan(serialPause(run, 0))
      expect(serialPause(run, 0.5)).toBeLessThan(serialPause(run, 0.999999))
    }
    // Two requests that collided draw different pauses
    const a = Array.from({ length: 200 }, () => serialPause(5))
    expect(new Set(a).size).toBeGreaterThan(50)
    for (const ms of a) { expect(ms).toBeGreaterThanOrEqual(400); expect(ms).toBeLessThanOrEqual(800) }
  })

  it('withSerialRetry waits exactly the drawn pause before each further run', async () => {
    const draws = [0.1, 0.9, 0.3, 0.7, 0.5]
    let i = 0
    const c = clock()
    const run = vi.fn(async () => 'booked')
    for (let n = 0; n < draws.length; n++) run.mockRejectedValueOnce(aborted())
    expect(await withSerialRetry(run, { pause: c.pause, now: c.now, random: () => draws[i++] })).toBe('booked')
    expect(c.pauses).toEqual(draws.map((r, n) => serialPause(n + 1, r)))
  })
})

describe('the time ceiling', () => {
  it('starts no further run after SERIAL_CEILING_MS (13 s), even with runs left', async () => {
    expect(SERIAL_CEILING_MS).toBe(13_000)
    // Longest pauses, instant runs: 50+100+200+400+800+1600+2000x4 = 11150 ms; one more 2000 would pass 13 s
    const c = clock()
    await expect(withSerialRetry(c.run, { pause: c.pause, now: c.now, random: () => 0.999999 })).rejects.toBeInstanceOf(BusyError)
    expect(c.runStarts).toHaveLength(11)
    expect(c.runStarts.length).toBeLessThan(SERIAL_ATTEMPTS)
    expect(c.elapsed()).toBeLessThanOrEqual(SERIAL_CEILING_MS)
  })

  it('counts the time the runs themselves take: slow runs give up sooner, and none starts after 13 s', async () => {
    const c = clock(1_500)
    await expect(withSerialRetry(c.run, { pause: c.pause, now: c.now, random: () => 0.5 })).rejects.toBeInstanceOf(BusyError)
    for (const start of c.runStarts) expect(start - 1_000_000).toBeLessThanOrEqual(SERIAL_CEILING_MS)
    // 1.5 s runs and three-quarter pauses: the seventh run ends at 12.9 s, and its 1.5 s pause would pass 13 s
    expect(c.runStarts).toHaveLength(7)
    // Each run 1.5 s, so the request is over by the ceiling plus one run
    expect(c.elapsed()).toBeLessThanOrEqual(SERIAL_CEILING_MS + 1_500)
  })
})

describe('when it gives up', () => {
  it('reports it to Sentry once, tagged, with IDs and counts only, and logs the runs and the total wait', async () => {
    const c = clock()
    await expect(withSerialRetry(c.run, { op: 'booking', ids: { listingId: 'lst_1', guestId: 'usr_2' }, pause: c.pause, now: c.now, random: () => 0 })).rejects.toBeInstanceOf(BusyError)
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
    const [message, report] = sentry.captureMessage.mock.calls[0]
    expect(message).toMatch(/aborted on every run/)
    expect(report).toMatchObject({ level: 'warning', tags: { area: 'database', db_issue: 'SERIAL_RETRY_EXHAUSTED', serial_op: 'booking' }, fingerprint: ['serial-retry-exhausted', 'booking'] })
    const facts = report.contexts.serialRetry
    expect(Object.keys(facts).sort()).toEqual(['attempts', 'elapsedMs', 'guestId', 'listingId', 'op', 'waitedMs', 'why'])
    expect(facts).toMatchObject({ op: 'booking', attempts: SERIAL_ATTEMPTS, why: 'attempts', listingId: 'lst_1', guestId: 'usr_2' })
    expect(facts.waitedMs).toBe(c.pauses.reduce((a, b) => a + b, 0))
    expect(facts.waitedMs).toBeGreaterThan(0)
    // The log line carries the same facts
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toEqual(facts)
  })

  it('reports a give-up at the ceiling too, saying so', async () => {
    const c = clock()
    await expect(withSerialRetry(c.run, { op: 'calendar-block', ids: { listingId: 'lst_9' }, pause: c.pause, now: c.now, random: () => 0.999999 })).rejects.toBeInstanceOf(BusyError)
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
    expect(sentry.captureMessage.mock.calls[0][1].contexts.serialRetry).toMatchObject({ op: 'calendar-block', attempts: 11, why: 'ceiling', listingId: 'lst_9' })
  })

  it('every caller names what it is and passes IDs only', () => {
    const ROOT = path.resolve(__dirname, '..')
    const callers = ['app/api/bookings/route.ts', 'app/api/listings/[id]/blocked-dates/route.ts', 'lib/depositCover.ts', 'lib/listingChecks.ts']
    for (const file of callers) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const label = /TransactionIsolationLevel\.Serializable \}\), \{ op: '([a-z-]+)', ids: \{ ([^}]*) \} \}\)/.exec(source)
      expect(label, file).not.toBeNull()
      for (const part of label![2].split(',').map((p) => p.trim())) expect(part, file).toMatch(/^[a-zA-Z]+Id(: [a-zA-Z.]+Id)?$|^instalmentId: instalment\.id$|^bookingId: booking\.id$|^listingId: id$/)
    }
  })
})

describe('every Serializable transaction in the app', () => {
  const ROOT = path.resolve(__dirname, '..')
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })

  it('is run again when Postgres aborts it: none answers an abort as if it were a real clash', () => {
    const serializable = files(ROOT).filter((file) => fs.readFileSync(file, 'utf8').includes('isolationLevel: Prisma.TransactionIsolationLevel.Serializable'))
    expect(serializable.map((file) => path.relative(ROOT, file)).sort()).toEqual([
      'app/api/bookings/route.ts', 'app/api/listings/[id]/blocked-dates/route.ts', 'lib/depositCover.ts', 'lib/listingChecks.ts',
    ])
    for (const file of serializable) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source.match(/withSerialRetry\(\(\) => db\.\$transaction\(/g), file).toHaveLength(source.match(/TransactionIsolationLevel\.Serializable/g)!.length)
      // P2034 is handled in one place only
      expect(source, file).not.toContain("'P2034'")
    }
  })
})

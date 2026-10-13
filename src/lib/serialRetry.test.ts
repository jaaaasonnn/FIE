import fs from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { BUSY_TRY_AGAIN, BusyError, SERIAL_BACKOFF_MS, SERIAL_RETRIES, isSerializationFailure, withSerialRetry } from '@/lib/serialRetry'

const aborted = () => new Prisma.PrismaClientKnownRequestError('could not serialize access', { code: 'P2034', clientVersion: 'test' })
const noPause = async () => {}

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
  })

  it('gives up after the cap, as "busy", never as the abort itself', async () => {
    const run = vi.fn(async () => { throw aborted() })
    await expect(withSerialRetry(run, noPause)).rejects.toBeInstanceOf(BusyError)
    expect(run).toHaveBeenCalledTimes(1 + SERIAL_RETRIES)
    expect(new BusyError().message).toBe(BUSY_TRY_AGAIN)
  })

  it('does not run again for anything else: a real conflict is an answer', async () => {
    const conflict = Object.assign(new Error('DATE_CONFLICT'), { code: 'DATE_CONFLICT' })
    const run = vi.fn(async () => { throw conflict })
    await expect(withSerialRetry(run, noPause)).rejects.toBe(conflict)
    expect(run).toHaveBeenCalledTimes(1)
    expect(isSerializationFailure(conflict)).toBe(false)
    expect(isSerializationFailure(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }))).toBe(false)
  })

  it('waits a short random time, within the limits, before each further run', async () => {
    const pauses: number[] = []
    await expect(withSerialRetry(async () => { throw aborted() }, async (ms) => { pauses.push(ms) })).rejects.toBeInstanceOf(BusyError)
    expect(pauses).toHaveLength(SERIAL_RETRIES)
    for (const ms of pauses) {
      expect(ms).toBeGreaterThanOrEqual(SERIAL_BACKOFF_MS.min)
      expect(ms).toBeLessThanOrEqual(SERIAL_BACKOFF_MS.max)
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

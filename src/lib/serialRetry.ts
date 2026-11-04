// Running a Serializable transaction again when Postgres aborts it.
//
// Under Serializable isolation Postgres aborts a transaction whenever it
// cannot prove that running it beside another one is safe. That happens to
// transactions that have nothing to do with each other (two guests booking
// two different homes), so an abort is not an answer: it means "run it
// again". Only what the transaction itself finds on a clean run is an answer.
//
// The body of a transaction given to withSerialRetry may be run several
// times. It must only read and write the database through its `tx`, and
// anything it sets outside must be reset at its start: no payment, message,
// fetch or log of an outcome inside it. Those come after it has committed.

import * as Sentry from '@sentry/nextjs'
import { Prisma } from '@prisma/client'

/**
 * How many times a transaction is run at most, the first run included.
 * While the tables are small Postgres reads them whole, so every booking in
 * flight collides with every other (AS3). Ten guests booking ten homes at
 * one instant, 30-80 ms from the database, needed more than the 9 runs and
 * about 1 s of pauses this used to allow.
 */
export const SERIAL_ATTEMPTS = 12
/**
 * The pause before a further run grows each time: about 50 ms before the
 * second run, doubling up to SERIAL_BACKOFF_MS.max. Each pause is a random
 * time between half its step and the whole of it, so runs that collided do
 * not meet again at the same moment.
 */
export const SERIAL_BACKOFF_MS = { first: 50, max: 2_000 }
/**
 * No further run starts once this long has passed since the first began, so
 * a request always ends: at worst this plus one run (Prisma's 5 s transaction
 * limit and 2 s wait for a connection). Chosen by measuring (AS3, REPORT.md):
 * bursts of 10 and 20 bookings 30-80 ms from the database were told "busy"
 * less often than under the old rules, and the slowest answer was 14.2 s;
 * 8 s was worse than the old rules, 14 s took 15.5 s. Vercel Pro with Fluid
 * compute stops a function at 300 s by default.
 */
export const SERIAL_CEILING_MS = 13_000

/** What the person is told when every run was aborted. Nothing was written. */
export const BUSY_TRY_AGAIN = 'We are busy right now. Please try again in a moment.'

/** Every run was aborted by Postgres. Nothing was written. */
export class BusyError extends Error {
  constructor() {
    super(BUSY_TRY_AGAIN)
    this.name = 'BusyError'
  }
}

/** True for Postgres aborting a transaction to keep it serializable, or to break a deadlock (Prisma's P2034). */
export function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
}

/**
 * The pause before run `run + 1` (run counts from 1): random, between half
 * and all of min(first x 2^(run-1), max). `random` is a number in [0, 1).
 */
export function serialPause(run: number, random: number = Math.random()): number {
  const step = Math.min(SERIAL_BACKOFF_MS.max, SERIAL_BACKOFF_MS.first * 2 ** (run - 1))
  return Math.round(step / 2 + random * (step / 2))
}

export type SerialRetryOptions = {
  /** What the transaction is, for the alert and the log: 'booking', 'calendar-block', … */
  op?: string
  /** IDs only (never names, emails, phones or dates): what the alert carries about the person and the thing */
  ids?: Record<string, string | undefined>
  /** For tests */
  pause?: (ms: number) => Promise<unknown>
  now?: () => number
  random?: () => number
}

/** Every run was aborted: one warning to Sentry and one log line. IDs and counts only. */
function reportGivenUp(o: SerialRetryOptions, attempts: number, waitedMs: number, elapsedMs: number, why: 'attempts' | 'ceiling') {
  const op = o.op ?? 'unnamed'
  const facts = { op, attempts, waitedMs, elapsedMs, why, ...o.ids }
  console.warn('[serialRetry] gave up: the person was told "busy"', facts)
  Sentry.captureMessage('A serializable transaction was aborted on every run: the person was told to try again', {
    level: 'warning',
    tags: { area: 'database', db_issue: 'SERIAL_RETRY_EXHAUSTED', serial_op: op },
    fingerprint: ['serial-retry-exhausted', op],
    contexts: { serialRetry: facts },
  })
}

/**
 * Runs `transaction`, and runs it again each time Postgres aborts it, after
 * a pause that grows (serialPause), until SERIAL_ATTEMPTS runs or until the
 * next run would start after SERIAL_CEILING_MS. Any other error, and any
 * result, is passed straight on. Throws BusyError if it was aborted every
 * time, after reporting it.
 */
export async function withSerialRetry<T>(transaction: () => Promise<T>, o: SerialRetryOptions = {}): Promise<T> {
  const pause = o.pause ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = o.now ?? Date.now
  const random = o.random ?? Math.random
  const started = now()
  let waited = 0
  for (let run = 1; ; run++) {
    try {
      return await transaction()
    } catch (error) {
      if (!isSerializationFailure(error)) throw error
      if (run >= SERIAL_ATTEMPTS) {
        reportGivenUp(o, run, waited, now() - started, 'attempts')
        throw new BusyError()
      }
      const ms = serialPause(run, random())
      if (now() - started + ms > SERIAL_CEILING_MS) {
        reportGivenUp(o, run, waited, now() - started, 'ceiling')
        throw new BusyError()
      }
      await pause(ms)
      waited += ms
    }
  }
}

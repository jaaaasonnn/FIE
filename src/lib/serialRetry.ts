// Running a Serializable transaction again when Postgres aborts it.
//
// Under Serializable isolation Postgres aborts a transaction whenever it
// cannot prove that running it beside another one is safe. That happens to
// transactions that have nothing to do with each other (two guests booking
// two different homes), so an abort is not an answer: it means "run it
// again". Only what the transaction itself finds on a clean run is an answer.

import { Prisma } from '@prisma/client'

/**
 * How many times an aborted transaction is run again before giving up.
 * While the tables are small Postgres reads them whole, so every booking in
 * flight collides with every other. Measured on the test stack with four
 * sets of race tests running together: 4 was not always enough for ten
 * bookings at one instant, 8 was, every time.
 */
export const SERIAL_RETRIES = 8
/** The pause before each further run: a random time between these, so two that collided do not collide again. */
export const SERIAL_BACKOFF_MS = { min: 20, max: 200 }

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
 * Runs `transaction`, and runs it again (up to SERIAL_RETRIES times, after a
 * short random pause) each time Postgres aborts it. Any other error, and any
 * result, is passed straight on. Throws BusyError if it was aborted every time.
 */
export async function withSerialRetry<T>(transaction: () => Promise<T>, pause: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  for (let run = 0; ; run++) {
    try {
      return await transaction()
    } catch (error) {
      if (!isSerializationFailure(error)) throw error
      if (run >= SERIAL_RETRIES) throw new BusyError()
      await pause(SERIAL_BACKOFF_MS.min + Math.random() * (SERIAL_BACKOFF_MS.max - SERIAL_BACKOFF_MS.min))
    }
  }
}

// Every call this app makes to another company's API goes through here, so
// none can wait for ever. A call with no time limit holds a request, or a
// whole cron run, until the platform kills it.
//
// Two kinds of call, with the limits in this one file:
//  - reads (looking something up) may be tried again, inside one limit;
//  - calls that move money, or make something, are tried ONCE. A call that
//    was cut off may still have gone through, so the caller must find out
//    what happened before it ever sends again (see lib/payouts.ts).

/** The longest a read may take, all attempts together. */
export const READ_TIMEOUT_MS = 10_000
/** The longest a transfer or a refund may take. One attempt. */
export const MONEY_TIMEOUT_MS = 15_000
/** The longest a file upload to storage, or any other storage call, may take. */
export const STORAGE_TIMEOUT_MS = 30_000
/** The longest one call to send a message (an email or an SMS) may take. One attempt. */
export const MESSAGE_TIMEOUT_MS = 8_000
/** How many times a read is tried again after a failure that answered quickly. */
export const READ_RETRIES = 2
/** The pause before each further attempt at a read. */
export const READ_BACKOFF_MS = [300, 900]

/** What the person is told when Paystack does not answer in time. */
export const PAYSTACK_NOT_ANSWERING = 'Paystack is not answering. Please try again in a moment.'

/** The other side did not answer in time. Whatever was asked for may or may not have happened. */
export class OutboundTimeoutError extends Error {
  constructor(public readonly limitMs: number) {
    super(`No answer within ${limitMs / 1000} seconds`)
    this.name = 'OutboundTimeoutError'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One attempt with a time limit. The limit covers reading the body too, as
 * long as the caller reads it straight away. Throws OutboundTimeoutError when
 * the limit passes, and the usual error when the connection fails.
 */
async function attempt(url: string, init: RequestInit, limitMs: number, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal })
  } catch (error) {
    // The limit passed (AbortSignal.timeout raises a TimeoutError)
    if (signal.aborted || (error as { name?: string } | null)?.name === 'TimeoutError') throw new OutboundTimeoutError(limitMs)
    throw error
  }
}

/**
 * A call that moves money or makes something: a transfer, a refund, a new
 * payment page, a transfer recipient, an SMS. One attempt, never repeated here.
 * `stop` is the caller's own signal (the sending job's limit, say): the call
 * ends at whichever comes first, and either way it is a timeout.
 */
export function sendOnce(url: string, init: RequestInit, limitMs: number = MONEY_TIMEOUT_MS, stop?: AbortSignal): Promise<Response> {
  const limit = AbortSignal.timeout(limitMs)
  return attempt(url, init, limitMs, stop ? AbortSignal.any([limit, stop]) : limit)
}

/**
 * A read. Tried again, up to READ_RETRIES times, when the connection fails or
 * the answer is a 5xx or a 429, with a short pause each time. Everything
 * happens inside one limit of READ_TIMEOUT_MS, so the caller never waits
 * longer than that whatever goes wrong.
 */
export async function readWithRetry(url: string, init: RequestInit = {}, limitMs: number = READ_TIMEOUT_MS): Promise<Response> {
  const signal = AbortSignal.timeout(limitMs)
  for (let tries = 0; ; tries++) {
    const last = tries >= READ_RETRIES
    try {
      const res = await attempt(url, init, limitMs, signal)
      if (last || (res.status < 500 && res.status !== 429)) return res
      // Let go of an answer that will not be used
      await res.body?.cancel().catch(() => {})
    } catch (error) {
      if (last || error instanceof OutboundTimeoutError) throw error
    }
    await sleep(READ_BACKOFF_MS[tries] ?? READ_BACKOFF_MS[READ_BACKOFF_MS.length - 1])
    if (signal.aborted) throw new OutboundTimeoutError(limitMs)
  }
}

/** A `fetch` for a client library (storage) that gives every call a time limit. */
export function fetchWithLimit(limitMs: number): typeof fetch {
  return (input, init) => {
    const limit = AbortSignal.timeout(limitMs)
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, limit]) : limit })
  }
}

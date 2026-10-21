// Loading data in the browser on a weak connection (G6, G1). One lost request
// must not leave a page stuck or say something false ("unavailable", "signed
// out"): a read is tried again a few times, a little later each time, and if
// it still fails the page says so plainly and offers to try again.
//
// Only for reads (GET). A write is never repeated here: the server could have
// done it already.

/** Waits between tries: three tries in all, over about two seconds. */
export const RETRY_DELAYS_MS = [500, 1500] as const

/** Answers worth asking again: the server or something in front of it did not get to answer properly. */
const RETRY_STATUSES = new Set([408, 500, 502, 503, 504])

/** What a page shows when a read still fails after its tries. */
export const LOAD_FAILED = 'Something went wrong loading this page. Check your connection and try again.'

/** True for an answer that is not about the thing asked for, but a failure to answer: the page says LOAD_FAILED, not the server's words. */
export function isLoadFailure(res: Pick<Response, 'status'>): boolean {
  return RETRY_STATUSES.has(res.status)
}

type Options = {
  delays?: readonly number[]
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<unknown>
}

/**
 * The browser's fetch, for a read, tried again after a dropped connection or an answer in
 * RETRY_STATUSES. Gives back the last answer the server gave (the caller
 * checks it with isLoadFailure), or throws if no answer came at all.
 */
export async function fetchRetry(input: string, init?: RequestInit, options: Options = {}): Promise<Response> {
  const { delays = RETRY_DELAYS_MS, fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = options
  if (init?.method && init.method.toUpperCase() !== 'GET') throw new Error('fetchRetry is for reads only')
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= delays.length
    try {
      const res = await fetcher(input, init)
      if (last || !isLoadFailure(res)) return res
    } catch (error) {
      // Aborted on purpose by the page (it moved on): not a failure to retry
      if (init?.signal?.aborted) throw error
      if (last) throw error
    }
    await sleep(delays[attempt])
  }
}

/** A read that got no usable answer, even after its tries. */
export class NotAnswered extends Error {}

/** A read's JSON, or NotAnswered when there was none to have (the caller then shows LoadFailed). */
export async function readJson<T = Record<string, unknown>>(input: string, options: Options = {}): Promise<T> {
  let res: Response
  try {
    res = await fetchRetry(input, undefined, options)
  } catch {
    throw new NotAnswered(input)
  }
  if (isLoadFailure(res)) throw new NotAnswered(input)
  try {
    return (await res.json()) as T
  } catch {
    throw new NotAnswered(input)
  }
}

/** What the session check found: a person, nobody signed in (only a clear 401 says so), or no answer to go on. */
export type SessionCheck = { kind: 'user'; user: unknown } | { kind: 'signed-out' } | { kind: 'unknown' }

export async function checkSession(options: Options = {}): Promise<SessionCheck> {
  try {
    const res = await fetchRetry('/api/auth/session', undefined, options)
    if (res.status === 401) return { kind: 'signed-out' }
    if (!res.ok) return { kind: 'unknown' }
    const data = await res.json()
    return data && typeof data === 'object' && data.user ? { kind: 'user', user: data.user } : { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}

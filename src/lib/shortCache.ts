// Public reads that every page makes and that change rarely (the exchange
// rate shown to guests, the number of homes per region) are kept for a short
// time in each server process, so a busy minute does not ask the database
// the same question hundreds of times (second go, Stage C: the connection
// pool ran out first). Requests arriving together while the answer is being
// fetched share that one fetch. A failure is never kept.
//
// Never for anything that decides money: a charge, a refund and a payout
// read the exchange rate from the database themselves.

export const SHORT_CACHE_MS = 30_000

const kept = new Map<string, { value: unknown; at: number }>()
const pending = new Map<string, Promise<unknown>>()

export async function cached<T>(key: string, load: () => Promise<T>, { ttlMs = SHORT_CACHE_MS, now = Date.now }: { ttlMs?: number; now?: () => number } = {}): Promise<T> {
  const hit = kept.get(key)
  if (hit && now() - hit.at < ttlMs) return hit.value as T
  const waiting = pending.get(key)
  if (waiting) return waiting as Promise<T>
  const fetching = load()
    .then((value) => { kept.set(key, { value, at: now() }); return value })
    .finally(() => pending.delete(key))
  pending.set(key, fetching)
  return fetching
}

/** Drops what is kept (in this process), for one key or all. */
export function forgetCached(key?: string): void {
  if (key) kept.delete(key)
  else kept.clear()
}

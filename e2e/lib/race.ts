// Helpers for "two things at the same instant".
import { test } from '@playwright/test'
import type { Actor, Reply } from './world'

/** How many times each race is run. 5 for a quick run; E2E_ROUNDS=50 for the full proof. */
export const ROUNDS = Number(process.env.E2E_ROUNDS ?? 5)

/** Starts everything in the same tick, so the requests are in flight together. */
export const together = <T>(...jobs: (() => Promise<T>)[]): Promise<T[]> => Promise.all(jobs.map((job) => job()))

export const statuses = (replies: Reply[]) => replies.map((r) => r.status).sort((a, b) => a - b)
/** No answer may be a server error: a lost race is a 4xx with a reason, never a 500. */
export const serverErrors = (replies: Reply[]) => replies.filter((r) => r.status >= 500).map((r) => `${r.status} ${r.text.slice(0, 160)}`)

/** Cancels as the guest would: reads what they would be shown, then confirms that amount. */
export async function cancel(person: Actor, bookingId: string, o: { server?: 0 | 1; action?: 'cancel' | 'host-cancel'; reason?: string } = {}): Promise<Reply> {
  const preview = await person.call('GET', `/api/bookings/${bookingId}/cancellation`, undefined, { server: o.server })
  const total = preview.json?.preview?.quote?.total
  return person.call('PATCH', `/api/bookings/${bookingId}`, { action: o.action ?? 'cancel', ...(total !== undefined ? { expectedRefund: total } : {}), ...(o.reason ? { reason: o.reason } : {}) }, { server: o.server })
}

/** Writes down a number a test measured: in the report, and in the run's output. */
export function measured(description: string) {
  test.info().annotations.push({ type: 'measured', description })
  console.log(`  measured: ${description}`)
}

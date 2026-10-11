// The daily clean-up: rows that are of no further use to anyone.
//  - Sessions that have run out.
//  - The counts behind the rate limits (lib/rateLimit.ts, lib/authTokens.ts)
//    once they are a week old: the longest window any limit looks at is an hour.
// Nothing here touches a booking, a payment or a message.

import { db } from '@/lib/db'
import { purgeExpiredSessions } from '@/lib/session'

export const COUNTS_KEPT_MS = 7 * 24 * 60 * 60 * 1000

export type CleanupRun = { mode: 'live' | 'dry-run'; expiredSessions: number; oldCounts: number }

export async function runCleanup({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<CleanupRun> {
  const before = new Date(now.getTime() - COUNTS_KEPT_MS)
  const expiredSessions = await purgeExpiredSessions(now, { dryRun })
  const oldCounts = dryRun
    ? await db.authRequest.count({ where: { createdAt: { lt: before } } })
    : (await db.authRequest.deleteMany({ where: { createdAt: { lt: before } } })).count
  return { mode: dryRun ? 'dry-run' : 'live', expiredSessions, oldCounts }
}

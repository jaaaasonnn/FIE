// The daily reminder that a listing's check is about to run out. Thirty days
// before the expiry date the host is emailed, once.
//
// It only ever writes a message, through notify (lib/messaging), which is
// itself log-only until messaging is switched on. Each reminder is keyed on
// its check, so however often the job runs, and whether or not two runs
// overlap, one check produces one reminder. A dry run writes nothing.
//
// It has no switch of its own: it moves no money and changes no listing.
// The badge itself never depends on this job. It disappears on its expiry
// date whether or not the reminder ran.

import { db } from '@/lib/db'
import { notify } from '@/lib/messaging/notify'
import { CHECK_REMINDER_DAYS, liveCheckWhere } from '@/lib/listingCheckRules'

const DAY_MS = 86_400_000

export type CheckReminderItem = { checkId: string; listingId: string; expiresAt: string; action: 'reminded' | 'would-remind' }
export type CheckReminderRun = ({ mode: 'live' } | { mode: 'dry-run'; reason: string }) & { checked: number; results: CheckReminderItem[] }

export async function runListingCheckReminders({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<CheckReminderRun> {
  // Standing checks that run out within the reminder window, on listings guests can see
  const due = await db.listingCheck.findMany({
    where: {
      ...liveCheckWhere(now),
      expiresAt: { gt: now, lte: new Date(now.getTime() + CHECK_REMINDER_DAYS * DAY_MS) },
      listing: { isActive: true, moderationHold: false },
    },
    select: { id: true, listingId: true, expiresAt: true },
    orderBy: { expiresAt: 'asc' },
  })
  const results: CheckReminderItem[] = due.map((check) => ({
    checkId: check.id, listingId: check.listingId, expiresAt: check.expiresAt.toISOString(), action: dryRun ? 'would-remind' : 'reminded',
  }))
  if (dryRun) return { mode: 'dry-run', reason: 'dryRun was requested', checked: due.length, results }
  // Writes at most once per check: notify keys the message on the check
  for (const check of due) notify('listing.check_expiring', { checkId: check.id })
  return { mode: 'live', checked: due.length, results }
}

// The daily rent reminder job. Rules in lib/rentRules.ts (reminderKind):
//   - three days before a rent payment falls due, and on the day;
//   - then, once the grace day has passed, every day up to 14 days after the
//     due date;
//   - after that the reminders stop and the admins are told, once.
// The host and the admins hear once when a payment first becomes late.
//
// It only ever writes messages, through notify (lib/messaging), which is
// itself log-only until messaging is switched on. It charges nothing: a tenant
// pays each instalment themselves from the link.
//
// Before telling someone their rent is late, every payment still open on the
// instalment is checked with Paystack (read-only) and settled through
// lib/paymentSettle.ts, so a tenant who paid and closed the tab is not chased.
//
// Off until RENT_REMINDERS_ENABLED is exactly "true" (lib/payoutSwitches.ts):
// while off, and on a dry run, it reports what it would do, writes nothing
// and calls nothing.

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { rentRemindersEnabled } from '@/lib/payoutSwitches'
import { fetchCharge, settlePayment } from '@/lib/paymentSettle'
import { notify } from '@/lib/messaging/notify'
import { DAY_MS, ghanaToday } from '@/lib/stayDates'
import { OPEN_INSTALMENT_STATUSES, REMINDER_DAYS_BEFORE, reminderKind, type ReminderKind } from '@/lib/rentRules'

/** How far back the job looks: long enough that the one "reminders have stopped" alert is never missed. */
export const REMINDER_LOOKBACK_DAYS = 45

/**
 * Rent still owed, after the first payment, on tenancies that stand, within
 * the days a reminder can be about. The first instalment is the booking's own
 * first payment and has its own deadline (lib/payDeadline.ts).
 */
export function remindableWhere(now: Date): Prisma.InstalmentWhereInput {
  return {
    sequence: { gt: 1 },
    status: { in: OPEN_INSTALMENT_STATUSES },
    dueDate: {
      gte: new Date(now.getTime() - REMINDER_LOOKBACK_DAYS * DAY_MS),
      lte: new Date(now.getTime() + (REMINDER_DAYS_BEFORE + 1) * DAY_MS),
    },
    booking: { status: { in: ['CONFIRMED', 'COMPLETED'] }, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
  }
}

export type ReminderAction =
  | 'reminded'       // the messages were written
  | 'would-remind'   // dry run
  | 'paid'           // a payment turned out to have gone through: settled instead
  | 'waiting'        // Paystack unreachable or a payment still in progress: next run

export type ReminderItem = {
  instalmentId: string
  bookingId: string
  sequence: number
  kind: ReminderKind
  action: ReminderAction
  detail?: string
}

export type ReminderRun = ({ mode: 'live' } | { mode: 'dry-run'; reason: string }) & {
  checked: number
  results: ReminderItem[]
}

export async function runRentReminders({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<ReminderRun> {
  const mode: { mode: 'live' } | { mode: 'dry-run'; reason: string } = !rentRemindersEnabled()
    ? { mode: 'dry-run', reason: 'RENT_REMINDERS_ENABLED is not set to true' }
    : dryRun
      ? { mode: 'dry-run', reason: 'dryRun was requested' }
      : { mode: 'live' }
  const live = mode.mode === 'live'

  const owed = await db.instalment.findMany({
    where: remindableWhere(now),
    select: {
      id: true, bookingId: true, sequence: true, dueDate: true,
      payments: { where: { status: 'PENDING' }, select: { id: true, gatewayReference: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { bookingId: 'asc' }],
  })

  const results: ReminderItem[] = []
  const day = ghanaToday(now)

  for (const instalment of owed) {
    const kind = reminderKind(instalment.dueDate, now)
    if (!kind) continue
    const base = { instalmentId: instalment.id, bookingId: instalment.bookingId, sequence: instalment.sequence, kind }
    if (!live) {
      results.push({ ...base, action: 'would-remind' })
      continue
    }

    // Settle before chasing: ask Paystack about every payment still open
    let waiting: string | null = null
    let paid = false
    for (const payment of instalment.payments) {
      if (!payment.gatewayReference) continue
      try {
        const lookup = await fetchCharge(payment.gatewayReference)
        if (!lookup.ok) { waiting = lookup.error; break }
        const settled = await settlePayment(lookup.charge)
        if (settled.outcome === 'pending') { waiting = 'a payment is still in progress'; break }
        if (settled.outcome !== 'failed') paid = true
      } catch (error) {
        console.error('[Rent reminders] could not settle payment', payment.id, error)
        waiting = error instanceof Error ? error.message : 'Unknown error'
        break
      }
    }
    if (waiting) {
      results.push({ ...base, action: 'waiting', detail: waiting })
      continue
    }
    if (paid) {
      results.push({ ...base, action: 'paid' })
      continue
    }

    // Each of these writes at most once: notify keys a message on the
    // instalment (and, for the daily one, the day), so a second run today
    // writes nothing
    if (kind === 'DUE_SOON') notify('rent.due_soon', { instalmentId: instalment.id })
    else if (kind === 'DUE_TODAY') notify('rent.due_today', { instalmentId: instalment.id })
    else if (kind === 'OVERDUE') {
      notify('rent.overdue', { instalmentId: instalment.id, day })
      notify('rent.overdue_notice', { instalmentId: instalment.id })
    } else notify('rent.reminders_stopped', { instalmentId: instalment.id })
    results.push({ ...base, action: 'reminded' })
  }

  return { ...mode, checked: owed.length, results }
}

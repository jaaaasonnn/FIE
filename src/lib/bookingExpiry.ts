// Ending bookings that are holding dates nobody has paid for.
//
// Two kinds, on the windows in lib/payDeadline.ts:
//   - UNPAID: a confirmed booking (an instant booking, or a request the host
//     accepted) still unpaid PAY_GRACE_MS after its payBy.
//   - UNANSWERED: a request the host has not accepted or declined 48 hours
//     after it was made, or by the end of the check-in day if that is sooner.
//
// Before a booking is ended, every payment still open on it is checked with
// Paystack (read-only) and settled through lib/paymentSettle.ts, so a guest
// who paid and closed the tab is confirmed, not released. If Paystack cannot
// be reached, or a payment is still in progress, the booking is left for the
// next run.
//
// An ended booking is CANCELLED with cancelledBy SYSTEM, which every date and
// payment check already understands. Money that arrives afterwards is
// refunded in full by settlePayment; the booking is never revived.
//
// Off until switched on (lib/payoutSwitches.ts): while off, and on a dry run,
// it reports what it would do, writes nothing and calls nothing.

import * as Sentry from '@sentry/nextjs'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { expiryGate } from '@/lib/payoutSwitches'
import { fetchCharge, settlePayment } from '@/lib/paymentSettle'
import { notify } from '@/lib/messaging/notify'
import {
  CANCELLED_BY_SYSTEM, NO_HOST_RESPONSE, PAY_GRACE_MS, REQUEST_ANSWER_WINDOW_MS, UNPAID_EXPIRED,
} from '@/lib/payDeadline'
import { OPEN_INSTALMENT_STATUSES } from '@/lib/rentRules'

const HOUR_MS = 60 * 60 * 1000
/** A booking still waiting on Paystack this long after it fell due raises an alert. */
export const STUCK_EXPIRY_ALERT_MS = 24 * HOUR_MS
/** Stuck alerts go out on one run a day (the first after 09:00 UTC), not on all 96. */
export const STUCK_ALERT_HOUR_UTC = 9

export type ExpiryKind = 'UNPAID' | 'UNANSWERED'

/** Confirmed, unpaid, and past the time to pay plus the grace. No deadline means never. */
export function unpaidDueWhere(now: Date, notBefore: Date | null): Prisma.BookingWhereInput {
  return {
    status: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    payBy: { not: null, lte: new Date(now.getTime() - PAY_GRACE_MS) },
    ...(notBefore ? { createdAt: { gte: notBefore } } : {}),
  }
}

/** Requests with no answer after 48 hours, or once the check-in day (stored at 12:00 UTC) has ended. */
export function unansweredDueWhere(now: Date, notBefore: Date | null): Prisma.BookingWhereInput {
  const made = { lte: new Date(now.getTime() - REQUEST_ANSWER_WINDOW_MS), ...(notBefore ? { gte: notBefore } : {}) }
  return {
    status: 'PENDING',
    paymentStatus: 'UNPAID',
    OR: [
      { createdAt: made },
      { checkIn: { lte: new Date(now.getTime() - 12 * HOUR_MS) }, ...(notBefore ? { createdAt: { gte: notBefore } } : {}) },
    ],
  }
}

export type ExpiryAction =
  | 'expired'        // ended, dates released
  | 'would-expire'   // dry run
  | 'paid'           // a payment turned out to have gone through: settled instead
  | 'waiting'        // Paystack unreachable or a payment still in progress: next run
  | 'changed'        // accepted, paid or cancelled by someone while this run was looking

export type ExpiryItem = {
  bookingId: string
  kind: ExpiryKind
  action: ExpiryAction
  /** Payments still open on the booking when the run looked */
  openPayments: number
  detail?: string
}

export type ExpiryRun = ({ mode: 'live' } | { mode: 'dry-run'; reason: string }) & {
  checked: number
  results: ExpiryItem[]
  stuckAlerts: number
}

const select = {
  id: true, listingId: true, status: true, checkIn: true, checkOut: true, payBy: true, createdAt: true,
  payments: { where: { status: 'PENDING' }, select: { id: true, gatewayReference: true } },
} as const

export async function runExpiry({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<ExpiryRun> {
  const gate = expiryGate()
  const mode: { mode: 'live' } | { mode: 'dry-run'; reason: string } = !gate.live
    ? { mode: 'dry-run', reason: gate.reason }
    : dryRun
      ? { mode: 'dry-run', reason: 'dryRun was requested' }
      : { mode: 'live' }
  const live = mode.mode === 'live'

  const [unpaid, unanswered] = await Promise.all([
    db.booking.findMany({ where: unpaidDueWhere(now, gate.notBefore), select }),
    db.booking.findMany({ where: unansweredDueWhere(now, gate.notBefore), select }),
  ])
  const due = [
    ...unpaid.map((booking) => ({ booking, kind: 'UNPAID' as const })),
    ...unanswered.map((booking) => ({ booking, kind: 'UNANSWERED' as const })),
  ]

  const results: ExpiryItem[] = []
  const stuck: ExpiryItem[] = []

  for (const { booking, kind } of due) {
    const base = { bookingId: booking.id, kind, openPayments: booking.payments.length }
    if (!live) {
      results.push({ ...base, action: 'would-expire' })
      continue
    }

    // Settle before expiring: ask Paystack about every payment still open
    let waiting: string | null = null
    let paid = false
    for (const payment of booking.payments) {
      if (!payment.gatewayReference) continue
      try {
        const lookup = await fetchCharge(payment.gatewayReference)
        if (!lookup.ok) { waiting = lookup.error; break }
        const settled = await settlePayment(lookup.charge)
        if (settled.outcome === 'pending') { waiting = 'a payment is still in progress'; break }
        if (settled.outcome !== 'failed') paid = true
      } catch (error) {
        console.error('[Expiry cron] could not settle payment', payment.id, error)
        waiting = error instanceof Error ? error.message : 'Unknown error'
        break
      }
    }
    if (waiting) {
      const item: ExpiryItem = { ...base, action: 'waiting', detail: waiting }
      results.push(item)
      const dueAt = kind === 'UNPAID' ? booking.payBy!.getTime() + PAY_GRACE_MS : booking.createdAt.getTime() + REQUEST_ANSWER_WINDOW_MS
      if (now.getTime() - dueAt >= STUCK_EXPIRY_ALERT_MS) stuck.push(item)
      continue
    }
    if (paid) {
      // Money arrived: settlePayment has confirmed it, or recorded it for a
      // refund or a person. Either way the booking is no longer unpaid.
      results.push({ ...base, action: 'paid' })
      continue
    }

    // The status and payment status are part of the where, so a booking paid,
    // accepted or cancelled since the query ran is left alone
    const ended = await db.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status, paymentStatus: 'UNPAID' },
        data: {
          status: 'CANCELLED', cancelledBy: CANCELLED_BY_SYSTEM, cancelledAt: now,
          cancelReason: kind === 'UNPAID' ? UNPAID_EXPIRED : NO_HOST_RESPONSE,
        },
      })
      if (updated.count === 0) return false
      // Rent instalments of a booking that never started are no longer owed
      await tx.instalment.updateMany({ where: { bookingId: booking.id, status: { in: OPEN_INSTALMENT_STATUSES } }, data: { status: 'CANCELLED' } })
      await tx.blockedDate.deleteMany({
        where: {
          listingId: booking.listingId,
          // Only the rows the booking itself created, never a host's own blocks
          reason: 'BOOKED',
          date: { gte: booking.checkIn, lt: booking.checkOut },
        },
      })
      return true
    })
    if (ended) notify('booking.expired', { bookingId: booking.id })
    results.push({ ...base, action: ended ? 'expired' : 'changed' })
  }

  // One alert a day per booking that has been waiting on Paystack for a day
  let stuckAlerts = 0
  if (live && now.getUTCHours() === STUCK_ALERT_HOUR_UTC && now.getUTCMinutes() < 15) {
    for (const item of stuck) {
      Sentry.captureMessage('An unpaid booking cannot be released: its payment is still unresolved a day later', {
        level: 'warning',
        tags: { area: 'payments', payment_issue: 'EXPIRY_STUCK' },
        fingerprint: ['expiry-stuck', item.bookingId],
        contexts: { booking: { bookingId: item.bookingId, kind: item.kind, openPayments: item.openPayments, why: item.detail } },
      })
      stuckAlerts++
    }
  }

  return { ...mode, checked: due.length, results, stuckAlerts }
}

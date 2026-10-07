// What the two hourly cron jobs do. Kept out of the route files so the rules
// can be tested with a mocked database and no network.
//
// Both jobs are off until switched on (lib/payoutSwitches.ts) and both accept
// a dry run, which reports what would happen and changes nothing.

import * as Sentry from '@sentry/nextjs'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { STALE_CLAIM_MS, initiateHostPayout, retryFailedPayouts, type RetryResult } from '@/lib/payouts'
import { completionEnabled, payoutGate } from '@/lib/payoutSwitches'
import { OPEN_DISPUTE_STATUSES, PAYABLE_REFUND_REASONS, hostShare } from '@/lib/disputes'

const HOUR_MS = 60 * 60 * 1000
/**
 * A short stay's payout falls due 48 hours after check-in (noon two days
 * after), as the site says. A guest can report a problem until the end of
 * the day after check-in, so the payout never goes out while that window is
 * still open.
 */
export const PAYOUT_DELAY_MS = 48 * HOUR_MS
/** A payout still not sent this long after it fell due raises an alert. */
export const OVERDUE_ALERT_MS = 7 * 24 * HOUR_MS
/** Overdue alerts go out on one run a day (09:00 UTC), not on all 24. */
export const OVERDUE_ALERT_HOUR_UTC = 9

export type Mode = { mode: 'live' } | { mode: 'dry-run'; reason: string }

// ── Payouts ────────────────────────────────────────────────────────────────

/**
 * Short stays that are owed a payout and do not have one yet.
 *
 * COMPLETED counts as well as CONFIRMED. The completion job flips a stay to
 * COMPLETED at check-out, which for a one-night stay is the very moment its
 * payout falls due; if only CONFIRMED stays were picked, whichever job ran
 * second would decide whether the host was ever paid. Picking both means the
 * order never matters, and a host who adds a payout method after check-out
 * is still paid on the next run.
 *
 * Monthly and long-term stays are not paid by this job yet.
 */
export function duePayoutWhere(now: Date, notBefore: Date | null): Prisma.BookingWhereInput {
  return {
    rentalMode: 'SHORT_STAY',
    status: { in: ['CONFIRMED', 'COMPLETED'] },
    // PARTIALLY_REFUNDED is a stay whose dispute ended in a part refund: the
    // host is still owed their share of what is left
    paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
    checkIn: { lte: new Date(now.getTime() - PAYOUT_DELAY_MS) },
    payouts: { none: {} },
    // An open dispute from the guest holds the payout until an admin decides
    disputes: { none: { raisedByRole: 'GUEST', status: { in: OPEN_DISPUTE_STATUSES } } },
    // A refund means no payout, unless it is one that leaves the host owed
    // something (a dispute's part refund, or a deposit going back)
    OR: [{ refund: { is: null } }, { refund: { is: { reason: { in: PAYABLE_REFUND_REASONS } } } }],
    // Bookings from before payouts were switched on are never paid by this job
    ...(notBefore ? { createdAt: { gte: notBefore } } : {}),
  }
}

/**
 * The host's share of a booking: the stay price, less any part of it
 * refunded after a dispute, less the platform commission.
 */
export function hostPayoutAmount(subtotal: number, stayRefunded = 0): number {
  return hostShare(subtotal, stayRefunded)
}

export type PayoutAction =
  | 'paid'                        // transfer started (or already under way)
  | 'failed'                      // attempted, recorded as failed
  | 'waiting-for-payout-method'   // host has no verified payout method yet
  | 'would-pay'                   // dry run
  | 'error'                       // could not be attempted this run

export type PayoutRunResult = {
  bookingId: string
  hostId: string
  amount: number
  action: PayoutAction
  payoutId?: string
  status?: string
  error?: string
}

export type PayoutRun = Mode & {
  checked: number
  results: PayoutRunResult[]
  /** PENDING payouts left behind by a run that died, sent again this run */
  resumed: PayoutRunResult[]
  retried: RetryResult[]
  overdueAlerts: number
}

export async function runPayouts({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<PayoutRun> {
  const gate = payoutGate()
  const mode: Mode = !gate.live
    ? { mode: 'dry-run', reason: gate.reason }
    : dryRun
      ? { mode: 'dry-run', reason: 'dryRun was requested' }
      : { mode: 'live' }
  const live = mode.mode === 'live'

  const due = await db.booking.findMany({
    where: duePayoutWhere(now, gate.notBefore),
    select: {
      id: true, hostId: true, subtotal: true, checkIn: true,
      refund: { select: { stayRefund: true } },
      host: { select: { paystackRecipientCode: true, payoutMethodVerifiedAt: true } },
    },
  })

  const results: PayoutRunResult[] = []
  const overdue: { bookingId: string; hostId: string; amount: number; dueAt: Date; why: string }[] = []
  const noteIfOverdue = (bookingId: string, hostId: string, amount: number, dueAt: Date, why: string) => {
    if (now.getTime() - dueAt.getTime() >= OVERDUE_ALERT_MS) overdue.push({ bookingId, hostId, amount, dueAt, why })
  }

  for (const booking of due) {
    const amount = hostPayoutAmount(booking.subtotal, booking.refund?.stayRefund ?? 0)
    const base = { bookingId: booking.id, hostId: booking.hostId, amount }
    const dueAt = new Date(booking.checkIn.getTime() + PAYOUT_DELAY_MS)

    // No payout method yet: nothing is written, so the stay stays in this
    // list and is paid on the first run after the host adds one.
    if (!booking.host.paystackRecipientCode || !booking.host.payoutMethodVerifiedAt) {
      results.push({ ...base, action: 'waiting-for-payout-method' })
      noteIfOverdue(booking.id, booking.hostId, amount, dueAt, 'the host has no verified payout method')
      continue
    }
    if (!live) {
      results.push({ ...base, action: 'would-pay' })
      continue
    }
    try {
      const result = await initiateHostPayout({ hostId: booking.hostId, bookingId: booking.id, amount })
      results.push({
        ...base,
        action: result.ok ? 'paid' : 'failed',
        payoutId: result.payout.id,
        status: result.payout.status,
        error: result.error,
      })
    } catch (error) {
      console.error('[Payout cron] initiateHostPayout threw for booking', booking.id, error)
      results.push({ ...base, action: 'error', error: error instanceof Error ? error.message : 'Unknown error' })
      noteIfOverdue(booking.id, booking.hostId, amount, dueAt, 'the transfer could not be started')
    }
  }

  // Payouts a dead run left in PENDING: claimed (or never claimed) more than
  // STALE_CLAIM_MS ago with no answer from Paystack recorded. Sending again
  // reuses the same reference, so Paystack cannot pay it twice.
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS)
  const stuck = await db.payout.findMany({
    where: {
      status: 'PENDING',
      paystackTransferCode: null,
      bookingId: { not: null },
      createdAt: { lte: staleBefore },
      OR: [{ initiatedAt: null }, { initiatedAt: { lte: staleBefore } }],
    },
  })
  const resumed: PayoutRunResult[] = []
  for (const payout of stuck) {
    const base = { bookingId: payout.bookingId!, hostId: payout.hostId, amount: payout.amount, payoutId: payout.id }
    if (!live) {
      resumed.push({ ...base, action: 'would-pay', status: payout.status })
      continue
    }
    try {
      const result = await initiateHostPayout({ hostId: payout.hostId, bookingId: payout.bookingId!, amount: payout.amount })
      resumed.push({ ...base, action: result.ok ? 'paid' : 'failed', status: result.payout.status, error: result.error })
    } catch (error) {
      console.error('[Payout cron] could not resume payout', payout.id, error)
      resumed.push({ ...base, action: 'error', status: payout.status, error: error instanceof Error ? error.message : 'Unknown error' })
      noteIfOverdue(payout.bookingId!, payout.hostId, payout.amount, payout.createdAt, 'the payout is stuck before sending')
    }
  }

  // FAILED payouts due another attempt under the retry policy in lib/payouts.ts
  const retried = live ? await retryFailedPayouts() : []

  // One alert a day per overdue payout, and only while payouts are live:
  // before then nothing is expected to have been paid.
  let overdueAlerts = 0
  if (live && now.getUTCHours() === OVERDUE_ALERT_HOUR_UTC) {
    for (const item of overdue) {
      Sentry.captureMessage('Host payout still unpaid 7 days after it fell due', {
        level: 'warning',
        tags: { area: 'payouts', payout_failure: 'OVERDUE' },
        fingerprint: ['payout-overdue', item.bookingId],
        // IDs only: no account or mobile money numbers
        contexts: {
          payout: { bookingId: item.bookingId, hostId: item.hostId, amount: item.amount, dueAt: item.dueAt.toISOString(), why: item.why },
        },
      })
      overdueAlerts++
    }
  }

  return { ...mode, checked: due.length, results, resumed, retried, overdueAlerts }
}

// ── Completion ─────────────────────────────────────────────────────────────

export type CompletionRun = Mode & { transitioned: number; bookingIds: string[] }

/**
 * Marks paid, confirmed stays COMPLETED once check-out has passed.
 *
 * paymentStatus: 'PAID' matters here, not just status: 'CONFIRMED': an
 * instant-book listing creates its booking as CONFIRMED before payment, so
 * an unpaid booking can sit at CONFIRMED while its check-out date passes.
 * Without the filter it would "complete" and open the review flow.
 *
 * Idempotent: a COMPLETED booking no longer matches and is never re-selected.
 * Completion does not affect payouts: runPayouts picks COMPLETED stays too.
 */
export async function runCompletion({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<CompletionRun> {
  const mode: Mode = !completionEnabled()
    ? { mode: 'dry-run', reason: 'COMPLETION_ENABLED is not set to true' }
    : dryRun
      ? { mode: 'dry-run', reason: 'dryRun was requested' }
      : { mode: 'live' }

  const due = await db.booking.findMany({
    where: { status: 'CONFIRMED', paymentStatus: 'PAID', checkOut: { lte: now } },
    select: { id: true },
  })
  const bookingIds = due.map((b) => b.id)

  if (mode.mode === 'dry-run' || bookingIds.length === 0) {
    return { ...mode, transitioned: 0, bookingIds }
  }

  // status is checked again here so a booking cancelled since the query ran
  // is not completed over the top of it
  const updated = await db.booking.updateMany({
    where: { id: { in: bookingIds }, status: 'CONFIRMED', paymentStatus: 'PAID' },
    data: { status: 'COMPLETED' },
  })
  return { ...mode, transitioned: updated.count, bookingIds }
}

/** True when a cron request asks for a dry run: ?dryRun=1 or ?dryRun=true. */
export function wantsDryRun(req: Request): boolean {
  const value = new URL(req.url).searchParams.get('dryRun')
  return value === '1' || value === 'true'
}

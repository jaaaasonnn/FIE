// Applying an admin's decision on a dispute, and the daily check for ones
// left open too long. The rules themselves are in lib/disputes.ts; this file
// is where they meet the database.
//
// A decision moves money only through the existing code: a refund is a
// Refund row sent by lib/refunds.ts (behind REFUNDS_ENABLED), and a payout is
// made by the payout job (behind PAYOUTS_ENABLED) once the dispute no longer
// holds it. Nothing here calls Paystack.

import * as Sentry from '@sentry/nextjs'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { disputeDecisionsEnabled } from '@/lib/payoutSwitches'
import { sendRefund } from '@/lib/refunds'
import {
  OPEN_DISPUTE_STATUSES, OVERDUE_DISPUTE_DAYS, decisionEffect, outcomeLabel,
  type DecisionEffect,
} from '@/lib/disputes'

export const MAX_RESOLUTION = 1000
const DAY_MS = 86_400_000

export type DecisionResult =
  | { ok: false; status: number; error: string }
  | { ok: true; mode: 'dry-run'; reason: string; effect: Extract<DecisionEffect, { ok: true }> }
  | { ok: true; mode: 'applied'; effect: Extract<DecisionEffect, { ok: true }>; refundId: string | null }

/** Everything a decision is worked out from, read fresh from the database. */
async function loadForDecision(disputeId: string) {
  return db.dispute.findUnique({
    where: { id: disputeId },
    include: {
      booking: {
        include: {
          listing: { select: { title: true } },
          payments: { where: { status: 'SUCCESS' }, orderBy: { createdAt: 'desc' }, take: 1 },
          refund: { select: { reason: true, amount: true } },
          payouts: { select: { status: true, amount: true }, take: 1 },
        },
      },
    },
  })
}

/**
 * Decides a dispute. With `dryRun`, or while DISPUTE_DECISIONS_ENABLED is
 * off, it only reports what the decision would do and writes nothing.
 *
 * Decisions are final: a dispute that is already resolved is refused. A
 * mistake is put right by hand and written to the dispute's history as a
 * correction.
 */
export async function decideDispute({
  disputeId, adminId, outcome, amount, resolution, dryRun = false,
}: {
  disputeId: string
  adminId: string
  outcome: unknown
  amount?: unknown
  resolution: unknown
  dryRun?: boolean
}): Promise<DecisionResult> {
  const dispute = await loadForDecision(disputeId)
  if (!dispute) return { ok: false, status: 404, error: 'Dispute not found' }
  if (!OPEN_DISPUTE_STATUSES.includes(dispute.status)) {
    return { ok: false, status: 409, error: 'This dispute has already been decided. Decisions are final: write a correction on it instead.' }
  }

  const booking = dispute.booking
  const payment = booking.payments[0] ?? null
  const effect = decisionEffect({
    role: dispute.raisedByRole,
    outcome,
    amount,
    booking,
    payment: payment ? { id: payment.id, amount: payment.amount, amountPesewas: payment.amountPesewas } : null,
    existingRefund: booking.refund,
    payout: booking.payouts[0] ?? null,
  })
  if (!effect.ok) return { ok: false, status: 400, error: effect.error }

  const why = typeof resolution === 'string' ? resolution.trim() : ''
  if (!dryRun && !why) return { ok: false, status: 400, error: 'Write the reason for this decision. Both the guest and the host will see it.' }
  if (why.length > MAX_RESOLUTION) return { ok: false, status: 400, error: `The reason can be at most ${MAX_RESOLUTION} characters` }

  if (dryRun) return { ok: true, mode: 'dry-run', reason: 'dryRun was requested', effect }
  if (!disputeDecisionsEnabled()) {
    return { ok: true, mode: 'dry-run', reason: 'DISPUTE_DECISIONS_ENABLED is not set to true', effect }
  }

  let refundId: string | null = null
  try {
    await db.$transaction(async (tx) => {
      // The status is part of the where, so two admins cannot both decide it
      const updated = await tx.dispute.updateMany({
        where: { id: dispute.id, status: { in: OPEN_DISPUTE_STATUSES } },
        data: {
          status: 'RESOLVED', outcome: effect.outcome, refundAmount: effect.amount,
          resolution: why, resolvedById: adminId, resolvedAt: new Date(),
        },
      })
      if (updated.count === 0) throw new Error('ALREADY_DECIDED')

      if (effect.refund && payment) {
        const refund = await tx.refund.create({
          data: {
            bookingId: booking.id, paymentId: payment.id, reason: effect.refund.reason,
            stayRefund: effect.refund.stayRefund, serviceFeeRefund: effect.refund.serviceFeeRefund,
            depositRefund: effect.refund.depositRefund, amount: effect.refund.amount,
            amountPesewas: effect.refund.amountPesewas,
          },
        })
        refundId = refund.id
      }

      await tx.disputeEvent.create({
        data: { disputeId: dispute.id, actorId: adminId, type: 'RESOLVED', note: [outcomeLabel(dispute.raisedByRole, effect.outcome), ...effect.summary].join(' ') },
      })
      await tx.notification.createMany({
        data: [booking.guestId, booking.hostId].map((userId) => ({
          userId,
          type: 'DISPUTE_RESOLVED',
          title: 'A decision has been made on a reported problem',
          body: `${booking.listing.title}: ${outcomeLabel(dispute.raisedByRole, effect.outcome)}. ${why}`,
        })),
      })
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_DECIDED') {
      return { ok: false, status: 409, error: 'This dispute has already been decided.' }
    }
    // One refund per booking: another refund was recorded a moment ago
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, status: 409, error: 'This booking already has a refund on record. Nothing was changed.' }
    }
    throw error
  }

  // The decision is on record. Sending the refund does nothing while refunds
  // are off, and a failure is picked up by the hourly refund job.
  if (refundId) {
    try {
      await sendRefund(refundId)
    } catch (error) {
      console.error('[Disputes] sendRefund threw for refund', refundId, error)
    }
  }
  return { ok: true, mode: 'applied', effect, refundId }
}

// ── Daily check ────────────────────────────────────────────────────────────

export type DisputeCheck = {
  mode: 'live' | 'dry-run'
  reason?: string
  open: number
  overdue: { disputeId: string; bookingId: string; raisedByRole: string; status: string; daysOpen: number }[]
  alerts: number
}

/**
 * Finds disputes still open OVERDUE_DISPUTE_DAYS after they were raised and
 * raises one Sentry alert for each. Run once a day, so that is one alert a
 * day per dispute until it is decided. Moves no money and changes no rows.
 */
export async function runDisputeCheck({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<DisputeCheck> {
  const open = await db.dispute.findMany({
    where: { status: { in: OPEN_DISPUTE_STATUSES } },
    select: { id: true, bookingId: true, raisedByRole: true, status: true, createdAt: true },
  })
  const overdue = open
    .filter((d) => now.getTime() - d.createdAt.getTime() >= OVERDUE_DISPUTE_DAYS * DAY_MS)
    .map((d) => ({
      disputeId: d.id, bookingId: d.bookingId, raisedByRole: d.raisedByRole, status: d.status,
      daysOpen: Math.floor((now.getTime() - d.createdAt.getTime()) / DAY_MS),
    }))

  if (dryRun) return { mode: 'dry-run', reason: 'dryRun was requested', open: open.length, overdue, alerts: 0 }

  for (const item of overdue) {
    Sentry.captureMessage(`A dispute is still undecided after ${OVERDUE_DISPUTE_DAYS} days`, {
      level: 'warning',
      tags: { area: 'disputes' },
      fingerprint: ['dispute-overdue', item.disputeId],
      contexts: { dispute: item },
    })
  }
  return { mode: 'live', open: open.length, overdue, alerts: overdue.length }
}

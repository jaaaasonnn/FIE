// Covering a missed rent payment from the damage deposit. The rules are in
// lib/rentRules.ts (coverQuote); this file is where they meet the database.
//
// An admin's action, one instalment at a time. It moves no money through
// Paystack: the deposit was collected with the first payment and is already
// held, so covering only changes what it is held for. The host's share of the
// covered rent is then paid by the payout job like any other settled rent
// (behind PAYOUTS_ENABLED).
//
// Off until RENT_DEPOSIT_COVER_ENABLED is exactly "true" (lib/payoutSwitches.ts).
// While off, or with `dryRun`, it reports what it would do and writes nothing.
//
// The record of each cover is on the instalment itself: how much, which admin,
// and when. A cover is never undone here; a mistake is put right by hand.

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { rentDepositCoverEnabled } from '@/lib/payoutSwitches'
import { notify } from '@/lib/messaging/notify'
import { coverQuote, type CoverQuote } from '@/lib/rentRules'

type Quote = Extract<CoverQuote, { ok: true }>

export type CoverResult =
  | { ok: false; status: number; error: string }
  | { ok: true; mode: 'dry-run'; reason: string; quote: Quote }
  | { ok: true; mode: 'applied'; quote: Quote }

/** Everything a cover is worked out from, read fresh from the database. */
export async function loadForCover(instalmentId: string) {
  return db.instalment.findUnique({
    where: { id: instalmentId },
    include: {
      payments: { where: { status: 'PENDING' }, select: { id: true } },
      booking: {
        select: {
          id: true, status: true, paymentStatus: true, damageDeposit: true,
          refund: { select: { depositRefund: true } },
          instalments: true,
        },
      },
    },
  })
}

class Changed extends Error {}

export async function coverFromDeposit({
  instalmentId, adminId, dryRun = false, now = new Date(),
}: {
  instalmentId: string
  adminId: string
  dryRun?: boolean
  now?: Date
}): Promise<CoverResult> {
  const instalment = await loadForCover(instalmentId)
  if (!instalment) return { ok: false, status: 404, error: 'Rent payment not found' }

  const booking = instalment.booking
  const depositRefunded = booking.refund?.depositRefund ?? 0
  const quote = coverQuote({
    instalment, instalments: booking.instalments, booking, depositRefunded,
    paymentInProgress: instalment.payments.length > 0, now,
  })
  if (!quote.ok) return { ok: false, status: 400, error: quote.error }

  if (dryRun) return { ok: true, mode: 'dry-run', reason: 'dryRun was requested', quote }
  if (!rentDepositCoverEnabled()) {
    return { ok: true, mode: 'dry-run', reason: 'RENT_DEPOSIT_COVER_ENABLED is not set to true', quote }
  }

  try {
    // Serializable, so two covers on the same booking cannot both spend the
    // same deposit: one of them is aborted
    await db.$transaction(async (tx) => {
      // Part of the where: a second click, or a payment that settled it in
      // the meantime, changes nothing
      const updated = await tx.instalment.updateMany({
        where: { id: instalment.id, status: instalment.status, coveredFromDeposit: instalment.coveredFromDeposit },
        data: {
          status: quote.status,
          coveredFromDeposit: { increment: quote.cover },
          coveredById: adminId,
          coveredAt: now,
          ...(quote.status === 'COVERED' ? { paidAt: now } : {}),
        },
      })
      if (updated.count === 0) throw new Changed()

      // Never more out of the deposit than was paid into it
      const used = await tx.instalment.aggregate({ where: { bookingId: booking.id }, _sum: { coveredFromDeposit: true } })
      if ((used._sum.coveredFromDeposit ?? 0) > booking.damageDeposit - depositRefunded + 0.005) throw new Changed()
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof Changed || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) {
      return { ok: false, status: 409, error: 'This rent payment or its deposit changed a moment ago. Nothing was covered. Please look again.' }
    }
    throw error
  }

  // IDs and amounts only
  console.info('[Rent] covered from deposit', { instalmentId: instalment.id, bookingId: booking.id, adminId, cover: quote.cover, shortfall: quote.shortfall })
  notify('rent.covered_from_deposit', { instalmentId: instalment.id })
  return { ok: true, mode: 'applied', quote }
}

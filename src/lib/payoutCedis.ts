// Reads the payments a host payout is worked out from. The sums, and why a
// payout is a share of the cedis the guest paid, are in lib/cediShare.ts.

import { db } from '@/lib/db'
import { payoutPesewas } from '@/lib/cediShare'

/** What a payout is for: a whole booking, or one rent instalment of it. */
export type PayoutTarget = { bookingId: string; instalmentId?: string | null; coveredFromDeposit?: number | null; amount: number }

/**
 * Reads the successful payments of the bookings named and works each payout
 * out in pesewas. One query for all of them. The answers are in the order asked.
 */
export async function payoutCedis(targets: PayoutTarget[]): Promise<(number | null)[]> {
  if (targets.length === 0) return []
  const payments = await db.payment.findMany({
    where: { bookingId: { in: [...new Set(targets.map((t) => t.bookingId))] }, status: 'SUCCESS' },
    select: { bookingId: true, instalmentId: true, amount: true, amountPesewas: true },
    orderBy: { createdAt: 'asc' },
  })
  return targets.map((target) => {
    const ofBooking = payments.filter((p) => p.bookingId === target.bookingId)
    return payoutPesewas({
      amount: target.amount,
      coveredFromDeposit: target.coveredFromDeposit ?? 0,
      own: ofBooking.find((p) => (p.instalmentId ?? null) === (target.instalmentId ?? null)),
      // The deposit was paid in the booking's first payment
      first: ofBooking[0],
    })
  })
}

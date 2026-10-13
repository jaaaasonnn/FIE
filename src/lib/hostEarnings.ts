// The "This Month" figure on the host dashboard: the host's share of what
// guests have paid for stays and rent that fall in the current calendar month
// in Ghana. Pure, so the sum can be tested without a page.
//
// Only money that has been paid on a booking that stands counts. A short stay
// counts in the month of its check-in. A stay paid in instalments counts each
// instalment that is settled, in the month it falls due, so a year's rent is
// never counted at once. The damage deposit is never earnings.

import { dayKey } from '@/lib/hostCalendar'
import { ghanaToday } from '@/lib/stayDates'
import { PAYABLE_REFUND_REASONS, hostShare } from '@/lib/disputes'
import { isSettled } from '@/lib/rentRules'
import { payoutPesewas, type CediSource } from '@/lib/cediShare'

export type EarningsBooking = {
  status: string
  paymentStatus: string
  checkIn: string | Date
  subtotal: number
  refund?: { reason?: string | null; stayRefund?: number | null } | null
  instalments?: { id?: string; sequence: number; status: string; dueDate: string | Date; amount: number; coveredFromDeposit?: number | null }[] | null
  /** What the guest paid, for the figure in cedis */
  payments?: ({ status: string; instalmentId?: string | null; createdAt?: string | Date } & CediSource)[] | null
}

const monthOf = (value: string | Date) => dayKey(new Date(value)).slice(0, 7)

/** One amount that counts this month: the host's share in dollars, and what it was paid from. */
type Earned = { usd: number; booking: EarningsBooking; instalmentId: string | null; coveredFromDeposit: number }

function earnedThisMonth(bookings: EarningsBooking[], now: Date): Earned[] {
  const month = ghanaToday(now).slice(0, 7)
  const earned: Earned[] = []
  for (const b of bookings) {
    // Paid for, and not cancelled or declined
    if (b.status !== 'CONFIRMED' && b.status !== 'COMPLETED') continue
    if (b.paymentStatus !== 'PAID' && b.paymentStatus !== 'PARTIALLY_REFUNDED') continue
    // A refund means nothing is earned, unless it is one that leaves the host
    // owed something (a dispute's part refund, or a deposit going back)
    if (b.refund && !PAYABLE_REFUND_REASONS.includes(b.refund.reason ?? '')) continue
    const refunded = b.refund?.stayRefund ?? 0

    const instalments = b.instalments ?? []
    if (instalments.length === 0) {
      if (monthOf(b.checkIn) === month) earned.push({ usd: hostShare(b.subtotal, refunded), booking: b, instalmentId: null, coveredFromDeposit: 0 })
      continue
    }
    for (const i of instalments) {
      if (!isSettled(i) || monthOf(i.dueDate) !== month) continue
      // A dispute's part refund comes out of the first payment only
      earned.push({ usd: hostShare(i.amount, i.sequence === 1 ? refunded : 0), booking: b, instalmentId: i.id ?? null, coveredFromDeposit: i.coveredFromDeposit ?? 0 })
    }
  }
  return earned
}

/** The host's share for the month `now` falls in, in USD. */
export function monthEarnings(bookings: EarningsBooking[], now: Date = new Date()): number {
  return earnedThisMonth(bookings, now).reduce((total, e) => total + e.usd, 0)
}

/**
 * The same figure in pesewas: the host's share of the cedis guests actually
 * paid, which is what the payouts will be (lib/cediShare.ts). Null when any
 * part of it cannot be worked out, so the page shows dollars alone.
 */
export function monthEarningsPesewas(bookings: EarningsBooking[], now: Date = new Date()): number | null {
  let total = 0
  for (const e of earnedThisMonth(bookings, now)) {
    const paid = (e.booking.payments ?? [])
      .filter((p) => p.status === 'SUCCESS')
      .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
    const pesewas = payoutPesewas({
      amount: e.usd, coveredFromDeposit: e.coveredFromDeposit,
      own: paid.find((p) => (p.instalmentId ?? null) === e.instalmentId),
      first: paid[0],
    })
    if (pesewas === null) return null
    total += pesewas
  }
  return total
}

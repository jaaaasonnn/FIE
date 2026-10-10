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

export type EarningsBooking = {
  status: string
  paymentStatus: string
  checkIn: string | Date
  subtotal: number
  refund?: { reason?: string | null; stayRefund?: number | null } | null
  instalments?: { sequence: number; status: string; dueDate: string | Date; amount: number }[] | null
}

const monthOf = (value: string | Date) => dayKey(new Date(value)).slice(0, 7)

/** The host's share for the month `now` falls in, in USD. */
export function monthEarnings(bookings: EarningsBooking[], now: Date = new Date()): number {
  const month = ghanaToday(now).slice(0, 7)
  let total = 0
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
      if (monthOf(b.checkIn) === month) total += hostShare(b.subtotal, refunded)
      continue
    }
    for (const i of instalments) {
      if (!isSettled(i) || monthOf(i.dueDate) !== month) continue
      // A dispute's part refund comes out of the first payment only
      total += hostShare(i.amount, i.sequence === 1 ? refunded : 0)
    }
  }
  return total
}

// Works out what cancelling a booking would do, from the stored booking and
// its payment only. The preview a guest sees and the cancel itself both call
// this, so they cannot disagree; nothing here reads the request.

import { dayKey, parseDay } from '@/lib/hostCalendar'
import { addDays, daysBetween, ghanaToday } from '@/lib/stayDates'
import { CANCEL_CONTACT_SUPPORT, cancelNeedsSupport } from '@/lib/cancelRules'
import {
  POLICY_LABELS, asPolicy, commonRuleLines, policyRuleLines, quoteRefund, refundPesewas, tierDeadline,
  type Policy, type RefundQuote,
} from '@/lib/cancellationPolicy'
import { SUPPORT_EMAIL } from '@/lib/contact'

export type CancelBooking = {
  status: string
  paymentStatus: string
  rentalMode: string
  checkIn: Date
  subtotal: number
  serviceFee: number
  damageDeposit: number
  pricePerUnit: number
  /** The policy copied onto the booking when it was made (null on older bookings) */
  cancellationPolicy: string | null
  listing: { cancellationPolicy: string }
}

export type CancelPayment = { id: string; amount: number; amountPesewas: number | null }

export type CancelPreview =
  | { canCancel: false; message: string }
  | {
      canCancel: true
      by: 'GUEST' | 'HOST'
      /** A request the host has not answered yet: withdrawing it, not cancelling a stay */
      withdrawal: boolean
      paid: boolean
      policy: Policy
      policyLabel: string
      daysBefore: number
      /** Null when nothing was paid, so there is nothing to refund */
      quote: RefundQuote | null
      /** What was paid, in USD */
      paidAmount: number
      /** The service fee this booking was charged, in USD. Zero on a booking made with no guest fee */
      serviceFee: number
      /** The refund in pesewas, when the payment has a stored cedi amount */
      refundPesewas: number | null
      /** Last day ("2027-03-09") on which this refund still applies, or null */
      appliesUntil: string | null
      rules: string[]
    }

/**
 * `payment` is the booking's successful payment, if there is one.
 * `hasPayout` is whether any payout row exists for the booking.
 */
export function previewCancellation({
  booking, payment, hasPayout, by, now = new Date(),
}: {
  booking: CancelBooking
  payment: CancelPayment | null
  hasPayout: boolean
  by: 'GUEST' | 'HOST'
  now?: Date
}): CancelPreview {
  const withdrawal = booking.status === 'PENDING'
  if (booking.status !== 'CONFIRMED' && !(withdrawal && by === 'GUEST')) {
    return { canCancel: false, message: `Cannot cancel a booking that is ${booking.status.toLowerCase()}` }
  }

  const paid = booking.paymentStatus === 'PAID'
  if (paid && !payment) {
    // Marked paid with no successful payment on record: not something to guess at
    return { canCancel: false, message: `This booking cannot be cancelled online. Please contact support at ${SUPPORT_EMAIL}.` }
  }
  // An unanswered, unpaid request can be withdrawn at any time: nothing is owed either way
  if ((paid || !withdrawal) && cancelNeedsSupport(booking.checkIn, hasPayout, now)) {
    return { canCancel: false, message: CANCEL_CONTACT_SUPPORT }
  }

  const policy = asPolicy(booking.cancellationPolicy ?? booking.listing.cancellationPolicy)
  const daysBefore = daysBetween(parseDay(ghanaToday(now))!, booking.checkIn)

  const quote = paid && payment
    ? quoteRefund({
        rentalMode: booking.rentalMode, policy, by, daysBefore,
        subtotal: booking.subtotal, serviceFee: booking.serviceFee, damageDeposit: booking.damageDeposit,
        pricePerUnit: booking.pricePerUnit, paid: payment.amount,
      })
    : null

  const tier = by === 'GUEST' ? tierDeadline(booking.rentalMode, policy, daysBefore) : null
  return {
    canCancel: true,
    by,
    withdrawal,
    paid,
    policy,
    policyLabel: POLICY_LABELS[policy],
    daysBefore,
    quote,
    paidAmount: payment?.amount ?? 0,
    serviceFee: booking.serviceFee,
    refundPesewas: quote && payment?.amountPesewas ? refundPesewas(quote.total, payment.amount, payment.amountPesewas) : null,
    appliesUntil: quote && tier ? addDays(dayKey(booking.checkIn), -tier.minDays) : null,
    rules: [...policyRuleLines(booking.rentalMode, policy), ...commonRuleLines(booking.rentalMode, booking.serviceFee > 0)],
  }
}

/** How long a refund takes, as told to the guest. */
export const REFUND_TIMING = 'Refunds go back to the card or mobile money number you paid with, and can take up to 10 working days to arrive.'

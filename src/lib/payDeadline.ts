// How long an unpaid booking may hold its dates, and what a guest is told
// about it. No database or network here, so pages can use it too.
//
// An instant booking has an hour to be paid. A request has 24 hours from the
// moment the host accepts it. A request the host never answers ends after 48
// hours. None of these runs past the end of the check-in day in Ghana. The
// expiry job (lib/bookingExpiry.ts) acts PAY_GRACE_MS after a deadline, so a
// guest already on Paystack's page can finish.

const HOUR_MS = 60 * 60 * 1000

export const INSTANT_PAY_WINDOW_MS = 1 * HOUR_MS
export const ACCEPTED_PAY_WINDOW_MS = 24 * HOUR_MS
export const REQUEST_ANSWER_WINDOW_MS = 48 * HOUR_MS
export const PAY_GRACE_MS = 15 * 60 * 1000

/** Written to Booking.cancelledBy when the expiry job ends a booking. */
export const CANCELLED_BY_SYSTEM = 'SYSTEM'
export const UNPAID_EXPIRED = 'UNPAID_EXPIRED'
export const NO_HOST_RESPONSE = 'NO_HOST_RESPONSE'

/**
 * The last moment of the check-in day. Stays are stored at 12:00 UTC of the
 * day (lib/stayDates.ts) and Ghana is on UTC all year, so that is 12 hours on.
 * The day, not the stored noon, is the limit: a stay can be booked for today
 * in the afternoon, and must still be payable.
 */
export function endOfCheckInDay(checkIn: Date): Date {
  return new Date(checkIn.getTime() + 12 * HOUR_MS)
}

/** When an unpaid booking must be paid by, counted from `now`. */
export function payDeadline(kind: 'INSTANT' | 'ACCEPTED', checkIn: Date, now: Date = new Date()): Date {
  const window = kind === 'INSTANT' ? INSTANT_PAY_WINDOW_MS : ACCEPTED_PAY_WINDOW_MS
  return new Date(Math.min(now.getTime() + window, endOfCheckInDay(checkIn).getTime()))
}

/** When a request the host has not answered ends. */
export function answerDeadline(createdAt: Date, checkIn: Date): Date {
  return new Date(Math.min(createdAt.getTime() + REQUEST_ANSWER_WINDOW_MS, endOfCheckInDay(checkIn).getTime()))
}

/** True once the time to start a payment has gone. A booking with no deadline never passes it. */
export function pastPayBy(payBy: string | Date | null | undefined, now: Date = new Date()): boolean {
  return !!payBy && now.getTime() > new Date(payBy).getTime()
}

// ── What the guest is told ───────────────────────────────────────────────

export const HOST_MUST_ACCEPT = 'The host needs to accept your request first.'
export const PAY_WINDOW_PASSED =
  'The time to pay for this booking has passed, so it can no longer be paid for. You can book again if the dates are still free.'
export const EXPIRED_UNPAID =
  'This booking was not paid in time, so the dates were released. Nothing was charged. You can book again if the dates are still free.'
export const EXPIRED_UNPAID_REFUNDED =
  'This booking was not paid in time, so the dates were released before your payment arrived. The payment is being refunded in full. Refunds can take up to 10 working days to arrive.'
export const EXPIRED_UNANSWERED =
  'The host did not answer this request in time, so it has ended. Nothing was charged. You can send a new request or choose another home.'
export const PAYMENT_STILL_PROCESSING =
  'We are still waiting for your payment to be confirmed. With mobile money this can take a few minutes. Please do not pay again.'

export type PayState =
  | 'AWAITING_HOST'       // a request the host has not answered
  | 'AWAITING_PAYMENT'    // confirmed or accepted, not paid, still in time
  | 'PAY_WINDOW_PASSED'   // not paid and the deadline has gone; the job will release it
  | 'EXPIRED_UNPAID'
  | 'EXPIRED_UNANSWERED'
  | null

export type PayStateBooking = {
  status: string
  paymentStatus: string
  payBy?: string | Date | null
  cancelledBy?: string | null
  cancelReason?: string | null
}

/** Where an unpaid booking stands, or null when payment is not the question. */
export function payState(booking: PayStateBooking, now: Date = new Date()): PayState {
  if (booking.status === 'CANCELLED' && booking.cancelledBy === CANCELLED_BY_SYSTEM) {
    return booking.cancelReason === NO_HOST_RESPONSE ? 'EXPIRED_UNANSWERED' : 'EXPIRED_UNPAID'
  }
  if (booking.paymentStatus !== 'UNPAID') return null
  if (booking.status === 'PENDING') return 'AWAITING_HOST'
  if (booking.status === 'CONFIRMED') return pastPayBy(booking.payBy, now) ? 'PAY_WINDOW_PASSED' : 'AWAITING_PAYMENT'
  return null
}

/**
 * A pay-by moment as the guest reads it, in their own time zone:
 * "3:45 pm today" or "Fri 9 Oct, 3:45 pm".
 */
export function formatPayBy(payBy: string | Date, now: Date = new Date(), timeZone?: string): string {
  // Put together from the parts, so every browser writes it the same way
  const parts = (date: Date) => {
    const found = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, ...(timeZone ? { timeZone } : {}),
    }).formatToParts(date)
    const part = (type: string) => found.find((p) => p.type === type)?.value ?? ''
    return {
      day: `${part('weekday')} ${part('day')} ${part('month')}`,
      year: part('year'),
      time: `${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`,
    }
  }
  const at = parts(new Date(payBy))
  const today = parts(now)
  return at.day === today.day && at.year === today.year ? `${at.time} today` : `${at.day}, ${at.time}`
}

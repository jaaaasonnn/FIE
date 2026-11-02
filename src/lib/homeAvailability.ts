// SU7: an unpaid booking on a home that is no longer available cannot be paid for.
//
// "No longer available" is exactly two things:
//   - the host switched the home off (isActive false, and no hold on it);
//   - the host's account is suspended.
// A home on hold (moderationHold, whether an admin put it there or a host's description tripped the
// contact-details check) is deliberately outside the rule: the two kinds of hold cannot be told apart in
// the data, and an automatic hold must never end a guest's booking. Held homes stay payable and are
// handled by hand; a column saying who placed a hold would let admin holds join the rule later.
//
// Where it applies (each checks it itself, from data read in the same step):
//   - POST /api/payments refuses a booking's first payment (later rent on a paid tenancy is untouched);
//   - accepting a request is refused;
//   - lib/paymentSettle.ts refunds in full money that lands on such a booking while it is unpaid, and
//     ends it (HOME_UNAVAILABLE), reading the home inside the transaction that claims the payment;
//   - lib/bookingExpiry.ts ends unpaid bookings and unanswered requests on such a home at its next run.
// A booking paid before the home became unavailable is never touched by any of this.
// No database or network here, so pages can use it too.

/** Booking.cancelReason when the system ends a booking because its home is no longer available */
export const HOME_UNAVAILABLE = 'HOME_UNAVAILABLE'

/** What the guest is told instead of a Pay button, and when a payment is refused */
export const HOME_NO_LONGER_AVAILABLE = 'This home is no longer available. You have not been charged.'

/** What the guest is told when their money arrived after the home went, and is being refunded */
export const HOME_GONE_REFUNDED = 'The home became unavailable before your payment arrived, so it is being refunded in full. Refunds can take several working days to arrive.'

/** What the host is told when they try to accept a request on such a home */
export const SWITCH_ON_BEFORE_ACCEPTING = 'Switch this home back on before accepting requests for it.'

export type HomeState = {
  listing?: { isActive?: boolean | null; moderationHold?: boolean | null } | null
  host?: { suspendedAt?: Date | string | null } | null
}

/** True when the home is switched off by its host (not on hold) or its host is suspended. Only a stored false is "off". */
export function homeUnavailable({ listing, host }: HomeState): boolean {
  return (listing?.isActive === false && !listing.moderationHold) || !!host?.suspendedAt
}

/** The same rule as a Prisma filter on Booking, for the expiry job's query */
export const homeUnavailableWhere = {
  OR: [
    { listing: { isActive: false, moderationHold: false } },
    { host: { suspendedAt: { not: null } } },
  ],
}

/**
 * A booking as the people on it may see it: with `homeAvailable` worked out here, and without the home's raw
 * switches or the host's suspension (a guest is never told a host's account state).
 */
export function withHomeAvailable<B extends { listing: Record<string, unknown> & HomeState['listing']; host: Record<string, unknown> & NonNullable<HomeState['host']> }>(booking: B) {
  const listing = { ...booking.listing }
  delete listing.isActive
  delete listing.moderationHold
  const host = { ...booking.host }
  delete host.suspendedAt
  return { ...booking, listing: listing as Omit<B['listing'], 'isActive' | 'moderationHold'>, host: host as Omit<B['host'], 'suspendedAt'>, homeAvailable: !homeUnavailable(booking) }
}


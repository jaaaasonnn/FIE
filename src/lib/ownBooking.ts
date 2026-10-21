// G7: the answer to "Book" can be lost on the way back although the booking
// was made. Pressing Book again then finds the dates taken by the guest's own
// booking, and must say so, with the way to it, not "pick new dates".

export const OWN_BOOKING = 'OWN_BOOKING'

export type OwnBooking = { bookingId: string; message: string; href: string; action: string }

type Clash = { id: string; guestId: string; status: string; paymentStatus: string }

/** What the guest is told when the dates they asked for are held by a booking of their own. Null when the clash is with anyone else's. */
export function ownBooking(clash: Clash, guestId: string): OwnBooking | null {
  if (clash.guestId !== guestId) return null
  if (clash.status === 'CONFIRMED' && clash.paymentStatus === 'UNPAID') {
    return { bookingId: clash.id, href: `/checkout/${clash.id}`, action: 'Pay for it now', message: 'You already hold these dates in a booking that is waiting for payment.' }
  }
  if (clash.status === 'PENDING') {
    return { bookingId: clash.id, href: `/bookings/${clash.id}`, action: 'See your request', message: 'You have already asked the host for these dates. Your request is waiting for their answer.' }
  }
  return { bookingId: clash.id, href: `/bookings/${clash.id}`, action: 'See your booking', message: 'You already have a booking for these dates.' }
}

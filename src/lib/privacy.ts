// What one person may see of another. Kept in one place so the routes that
// return a booking, a listing or a profile all apply the same rule.

import { tenancyStands } from '@/lib/rentRules'

type Viewer = { id: string; role: string }
type Person = { id?: string; email?: string | null; phone?: string | null } & Record<string, unknown>
type BookingView = {
  guestId: string; hostId: string; status: string; paymentStatus: string
  guest?: Person | null; host?: Person | null
  payments?: Record<string, unknown>[]; refund?: Record<string, unknown> | null
} & Record<string, unknown>

const omit = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))

/**
 * True once a guest and a host may have each other's phone number and email:
 * the booking is confirmed and paid for. Before then they talk through FieGH's
 * messages, so nobody can collect contact details by making bookings they
 * never pay for, or by sending requests.
 */
export function contactShared(booking: { status: string; paymentStatus: string }): boolean {
  return tenancyStands(booking)
}

/**
 * A booking as one viewer may see it.
 *  - The other person's phone and email are left out until the booking is
 *    confirmed and paid. Your own are always yours to see; an admin sees all.
 *  - A host never gets the guest's payment references or the provider's
 *    refund ids: they are the guest's, and a host has no use for them. The
 *    booking's own `paymentReference` is the same value as its first
 *    payment's reference, so it is left out too. So is the address of the
 *    guest's Paystack page (`authorizationUrl`), which carries the reference.
 */
export function bookingFor<T extends BookingView>(booking: T, viewer: Viewer): T {
  if (viewer.role === 'ADMIN') return booking
  const shared = contactShared(booking)
  const isGuest = viewer.id === booking.guestId
  const isHost = viewer.id === booking.hostId
  const without = (person: Person | null | undefined) => (person ? { ...person, ...('email' in person ? { email: null } : {}), ...('phone' in person ? { phone: null } : {}) } : person)
  return {
    ...booking,
    ...(booking.guest !== undefined && !isGuest && !shared ? { guest: without(booking.guest) } : {}),
    ...(booking.host !== undefined && !isHost && !shared ? { host: without(booking.host) } : {}),
    ...(isHost && !isGuest && 'paymentReference' in booking ? { paymentReference: null } : {}),
    ...(isHost && !isGuest && booking.payments
      ? { payments: booking.payments.map((payment) => omit(payment, ['gatewayReference', 'authorizationUrl', 'momoNumber'])) }
      : {}),
    ...(isHost && !isGuest && booking.refund
      ? { refund: omit(booking.refund, ['paystackRefundId', 'failureReason']) }
      : {}),
  }
}

/**
 * Whether a listing may be shown to this viewer. A live listing is public. One
 * that is switched off or on hold, or whose host is suspended, is for its host and admins, and for a guest
 * who has a booking there (they still need to see the home they booked).
 */
export function listingVisible(
  listing: { hostId: string; isActive: boolean; moderationHold: boolean; hostSuspended?: boolean },
  viewer: Viewer | null,
  hasBooking: boolean,
): boolean {
  if (listing.isActive && !listing.moderationHold && !listing.hostSuspended) return true
  if (!viewer) return false
  return viewer.id === listing.hostId || viewer.role === 'ADMIN' || hasBooking
}

/**
 * Whether a profile may be shown to this viewer. Hosts are public: guests
 * need to see who they would stay with. A guest's profile is for themselves,
 * admins, and anyone they share a booking with. An admin's is for admins
 * only, so nobody can find out which accounts are admins.
 */
export function profileVisible(
  profile: { id: string; role: string; suspended?: boolean },
  viewer: Viewer | null,
  shareBooking: boolean,
): boolean {
  // A suspended account's profile is for admins only
  if (profile.suspended) return viewer?.role === 'ADMIN'
  if (profile.role === 'HOST') return true
  if (!viewer) return false
  if (viewer.id === profile.id || viewer.role === 'ADMIN') return true
  return profile.role === 'GUEST' && shareBooking
}

// Turns an event and the IDs it was raised with into the facts a template
// needs, read fresh from the database. Call sites pass IDs only, so nothing a
// caller holds (a stale booking, an amount from a request) can end up in a
// message. A loader returns null when there is nothing to say.

import { db } from '@/lib/db'
import { HOST_CANCEL_REASONS } from '@/lib/cancellationPolicy'
import { hostShare, outcomeLabel, reasonLabel } from '@/lib/disputes'
import type { Audience, EventName, Facts } from '@/lib/messaging/templates'

/** The IDs each event is raised with. */
export type EventIds = {
  'booking.requested': { bookingId: string }
  'booking.accepted': { bookingId: string }
  'booking.declined': { bookingId: string }
  'booking.confirmed': { bookingId: string }
  'booking.expired': { bookingId: string }
  'payment.failed': { bookingId: string; paymentId: string }
  'payment.late_refund': { bookingId: string }
  'booking.cancelled_by_guest': { bookingId: string }
  'booking.request_withdrawn': { bookingId: string }
  'booking.cancelled_by_host': { bookingId: string }
  'refund.sent': { refundId: string }
  'refund.arrived': { refundId: string }
  'refund.needs_attention': { refundId: string }
  /** `pesewas` is the amount Paystack says it transferred, when the webhook carries it */
  'payout.sent': { payoutId: string; pesewas?: unknown }
  'payout.failed': { payoutId: string }
  'payout.waiting': { bookingId: string }
  'payout_method.changed': { userId: string }
  'dispute.raised': { disputeId: string }
  'dispute.replied': { disputeId: string }
  'dispute.decided': { disputeId: string }
  'dispute.correction': { disputeId: string; eventId: string }
  'verification.submitted': { verificationId: string }
  'verification.decided': { verificationId: string }
  'listing.held': { listingId: string }
  'listing.auto_held': { listingId: string }
  'listing.reactivated': { listingId: string }
  'message.received': { messageId: string }
  'booking.completed': { bookingId: string }
  'review.received': { reviewId: string }
  'account.welcome': { userId: string }
  'account.became_host': { userId: string }
}

export type Loaded = {
  facts: Omit<Facts, 'appUrl' | 'supportEmail'>
  /** Who each audience in the template is. `admin` needs no entry. */
  recipients: Partial<Record<Exclude<Audience, 'admin'>, string>>
  /** What makes this occurrence of the event the same one if it is raised again */
  key: string
  bookingId?: string
}

/** New-message emails: at most one per conversation in this long. */
export const MESSAGE_ALERT_WINDOW_MS = 30 * 60 * 1000

async function booking(bookingId: string): Promise<Loaded | null> {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      listing: { select: { id: true, title: true } },
      guest: { select: { id: true, name: true } },
      host: { select: { id: true, name: true, paystackRecipientCode: true, payoutMethodVerifiedAt: true } },
      payments: { where: { status: 'SUCCESS' }, orderBy: { createdAt: 'desc' }, take: 1 },
      refund: true,
    },
  })
  if (!b) return null
  const rate = await db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' } })
  const reasonCode = (b.cancelReason ?? '').split(':')[0]
  return {
    key: b.id,
    bookingId: b.id,
    recipients: { guest: b.guestId, host: b.hostId },
    facts: {
      bookingId: b.id,
      listingId: b.listing.id,
      title: b.listing.title,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      guestName: b.guest.name,
      hostName: b.host.name,
      totalUsd: b.totalPrice,
      usdToGhs: rate?.usdToGhs,
      paidPesewas: b.payments[0]?.amountPesewas ?? null,
      payBy: b.payBy,
      hostHasPayoutMethod: !!b.host.paystackRecipientCode && !!b.host.payoutMethodVerifiedAt,
      // The reason from the list only: a host's own note is never passed on
      cancelReason: HOST_CANCEL_REASONS[reasonCode as keyof typeof HOST_CANCEL_REASONS] ?? null,
      refundUsd: b.refund?.amount ?? null,
      refundPesewas: b.refund?.amountPesewas ?? null,
      refundId: b.refund?.id,
      expiredFor: b.cancelReason === 'NO_HOST_RESPONSE' ? 'NO_HOST_RESPONSE' : 'UNPAID_EXPIRED',
      payoutUsd: hostShare(b.subtotal, b.refund?.stayRefund ?? 0),
    },
  }
}

/** A booking event that only makes sense while the booking is in a given state. */
const bookingIf = (ok: (b: { status: string; paymentStatus: string }) => boolean) => async ({ bookingId }: { bookingId: string }) => {
  const state = await db.booking.findUnique({ where: { id: bookingId }, select: { status: true, paymentStatus: true } })
  return state && ok(state) ? booking(bookingId) : null
}

async function refund({ refundId }: { refundId: string }): Promise<Loaded | null> {
  const r = await db.refund.findUnique({ where: { id: refundId }, select: { id: true, bookingId: true, failureReason: true } })
  if (!r) return null
  const loaded = await booking(r.bookingId)
  return loaded && { ...loaded, key: r.id, facts: { ...loaded.facts, failureReason: r.failureReason } }
}

async function payout({ payoutId, pesewas }: { payoutId: string; pesewas?: unknown }): Promise<Loaded | null> {
  const p = await db.payout.findUnique({ where: { id: payoutId }, select: { id: true, bookingId: true, amount: true, failureReason: true } })
  if (!p?.bookingId) return null
  const loaded = await booking(p.bookingId)
  const sent = Number(pesewas)
  return loaded && {
    ...loaded,
    key: p.id,
    recipients: { host: loaded.recipients.host },
    facts: {
      ...loaded.facts, payoutId: p.id, payoutUsd: p.amount, failureReason: p.failureReason,
      payoutPesewas: Number.isInteger(sent) && sent > 0 ? sent : null,
    },
  }
}

async function dispute({ disputeId }: { disputeId: string }): Promise<Loaded | null> {
  const d = await db.dispute.findUnique({ where: { id: disputeId } })
  if (!d) return null
  const loaded = await booking(d.bookingId)
  return loaded && {
    ...loaded,
    key: d.id,
    facts: {
      ...loaded.facts,
      raisedByRole: d.raisedByRole === 'HOST' ? 'HOST' : 'GUEST',
      disputeReason: reasonLabel(d.raisedByRole, d.reason),
      outcomeLabel: d.outcome ? outcomeLabel(d.raisedByRole, d.outcome) : undefined,
      resolution: d.resolution,
    },
  }
}

async function listing({ listingId }: { listingId: string }): Promise<Loaded | null> {
  const l = await db.listing.findUnique({ where: { id: listingId }, select: { id: true, title: true, hostId: true, updatedAt: true, host: { select: { name: true } } } })
  if (!l) return null
  return {
    // A listing can be held and switched back on more than once
    key: `${l.id}:${l.updatedAt.getTime()}`,
    recipients: { host: l.hostId },
    facts: { listingId: l.id, title: l.title, hostName: l.host.name },
  }
}

async function verification({ verificationId }: { verificationId: string }): Promise<Loaded | null> {
  const v = await db.verification.findUnique({ where: { id: verificationId }, select: { id: true, userId: true, status: true, updatedAt: true, user: { select: { name: true } } } })
  if (!v) return null
  return {
    // Sent again and decided again after a rejection: each round is its own occurrence
    key: `${v.id}:${v.updatedAt.getTime()}`,
    recipients: { user: v.userId },
    facts: { userName: v.user.name, verificationStatus: v.status },
  }
}

async function user({ userId }: { userId: string }): Promise<Loaded | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, payoutMethod: true, payoutMomoNetwork: true, payoutMomoNumber: true, payoutBankAccountNumber: true, payoutMethodVerifiedAt: true },
  })
  if (!u) return null
  const ending = (u.payoutMethod === 'MOMO' ? u.payoutMomoNumber : u.payoutBankAccountNumber)?.slice(-4)
  return {
    key: u.id,
    recipients: { user: u.id },
    facts: {
      userName: u.name,
      payoutMethodLabel: `${u.payoutMethod === 'MOMO' ? `${u.payoutMomoNetwork ?? ''} Mobile Money`.trim() : 'a bank account'}${ending ? `, ending ${ending}` : ''}`,
    },
  }
}

export const LOADERS: { [E in EventName]: (ids: EventIds[E]) => Promise<Loaded | null> } = {
  'booking.requested': ({ bookingId }) => booking(bookingId),
  'booking.accepted': ({ bookingId }) => booking(bookingId),
  'booking.declined': ({ bookingId }) => booking(bookingId),
  'booking.confirmed': bookingIf((b) => b.paymentStatus === 'PAID'),
  'booking.expired': bookingIf((b) => b.status === 'CANCELLED'),
  'payment.failed': async ({ bookingId, paymentId }) => {
    const loaded = await booking(bookingId)
    return loaded && { ...loaded, key: paymentId, recipients: { guest: loaded.recipients.guest } }
  },
  'payment.late_refund': ({ bookingId }) => booking(bookingId),
  'booking.cancelled_by_guest': ({ bookingId }) => booking(bookingId),
  'booking.request_withdrawn': ({ bookingId }) => booking(bookingId),
  'booking.cancelled_by_host': ({ bookingId }) => booking(bookingId),
  'refund.sent': refund,
  'refund.arrived': refund,
  'refund.needs_attention': refund,
  'payout.sent': payout,
  'payout.failed': payout,
  // Only while the host still has nothing to be paid into
  'payout.waiting': async ({ bookingId }) => {
    const loaded = await booking(bookingId)
    return loaded && !loaded.facts.hostHasPayoutMethod ? { ...loaded, recipients: { host: loaded.recipients.host } } : null
  },
  'payout_method.changed': async (ids) => {
    const loaded = await user(ids)
    const changed = await db.user.findUnique({ where: { id: ids.userId }, select: { payoutMethodVerifiedAt: true } })
    return loaded && { ...loaded, key: `${ids.userId}:${changed?.payoutMethodVerifiedAt?.getTime() ?? 0}` }
  },
  'dispute.raised': dispute,
  'dispute.replied': dispute,
  'dispute.decided': dispute,
  'dispute.correction': async ({ disputeId, eventId }) => {
    const loaded = await dispute({ disputeId })
    const event = await db.disputeEvent.findUnique({ where: { id: eventId }, select: { id: true, type: true, note: true } })
    // Only a correction: an admin's private note is never passed on
    if (!loaded || event?.type !== 'CORRECTION') return null
    return { ...loaded, key: event.id, facts: { ...loaded.facts, note: event.note } }
  },
  'verification.submitted': verification,
  'verification.decided': async (ids) => {
    const loaded = await verification(ids)
    return loaded && (loaded.facts.verificationStatus === 'APPROVED' || loaded.facts.verificationStatus === 'REJECTED') ? loaded : null
  },
  'listing.held': listing,
  'listing.auto_held': listing,
  'listing.reactivated': listing,
  'message.received': async ({ messageId }) => {
    const m = await db.message.findUnique({
      where: { id: messageId },
      select: {
        senderId: true, receiverId: true, bookingId: true, listingId: true, createdAt: true,
        sender: { select: { name: true } }, receiver: { select: { name: true, role: true } },
        listing: { select: { title: true } }, booking: { select: { listing: { select: { title: true } } } },
      },
    })
    if (!m) return null
    // One email per conversation per half hour, however many messages arrive in it
    const bucket = Math.floor(m.createdAt.getTime() / MESSAGE_ALERT_WINDOW_MS)
    return {
      key: `${m.senderId}>${m.receiverId}:${m.bookingId ?? m.listingId ?? '-'}:${bucket}`,
      recipients: { user: m.receiverId },
      facts: {
        userName: m.receiver.name,
        senderName: m.sender.name,
        title: m.listing?.title ?? m.booking?.listing.title,
        inboxPath: m.receiver.role === 'HOST' ? '/dashboard/host/messages' : '/dashboard/guest/messages',
      },
    }
  },
  'booking.completed': bookingIf((b) => b.status === 'COMPLETED'),
  'review.received': async ({ reviewId }) => {
    const r = await db.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true, type: true, isPublished: true, revieweeId: true,
        reviewer: { select: { name: true } }, reviewee: { select: { name: true } },
        booking: { select: { id: true, listing: { select: { title: true } } } },
      },
    })
    if (!r) return null
    return {
      key: r.id,
      bookingId: r.booking.id,
      recipients: { user: r.revieweeId },
      facts: {
        userName: r.reviewee.name,
        senderName: r.reviewer.name,
        title: r.booking.listing.title,
        reviewPublished: r.isPublished,
        inboxPath: r.type === 'GUEST_TO_HOST' ? '/dashboard/host/bookings' : '/dashboard/guest',
      },
    }
  },
  'account.welcome': user,
  'account.became_host': user,
}

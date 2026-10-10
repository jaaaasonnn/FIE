import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { REFUND_TIMING, previewCancellation } from '@/lib/cancellation'
import { HOST_CANCEL_REASONS, MAX_CANCEL_NOTE, isHostCancelReason } from '@/lib/cancellationPolicy'
import { sendRefund } from '@/lib/refunds'
import { formatUsd } from '@/lib/utils'
import { HOSTS_ONLY_MESSAGE } from '@/lib/roles'
import { payDeadline } from '@/lib/payDeadline'
import { notify } from '@/lib/messaging/notify'
import { dayKey } from '@/lib/hostCalendar'
import { OPEN_INSTALMENT_STATUSES, SETTLED_INSTALMENT_STATUSES, endTenancyQuote, refundableRent } from '@/lib/rentRules'

const bookingInclude = {
  listing: { select: { id: true, title: true, photos: true, city: true, neighbourhood: true } },
  guest:   { select: { id: true, name: true, profilePhoto: true, trustScore: true, isVerified: true } },
  host:    { select: { id: true, name: true, profilePhoto: true } },
} as const

type Action = 'accept' | 'decline' | 'cancel' | 'host-cancel' | 'end-tenancy'
const VALID_ACTIONS: Action[] = ['accept', 'decline', 'cancel', 'host-cancel', 'end-tenancy']

/**
 * PATCH /api/bookings/[id]
 * Auth required. Transitions a booking's status:
 *   - accept:      PENDING   -> CONFIRMED  (host only). The guest then has
 *                  24 hours to pay (Booking.payBy, lib/payDeadline.ts).
 *   - decline:     PENDING   -> DECLINED   (host only)
 *   - cancel:      CONFIRMED -> CANCELLED  (guest only), or PENDING -> CANCELLED
 *                  when the guest withdraws a request the host has not answered.
 *   - host-cancel: CONFIRMED -> CANCELLED  (host only). Needs a reason from
 *                  HOST_CANCEL_REASONS; the guest gets everything back.
 *   - end-tenancy: the host, or an admin, ends a monthly or long-term tenancy
 *                  after move-in. It ends at the end of the last month paid
 *                  for or covered (lib/rentRules.ts): checkOut moves there,
 *                  the agreed date is kept in originalCheckOut, the months
 *                  not yet paid are no longer owed, and nothing is refunded.
 *                  With `preview: true` it only reports the end date. The
 *                  real thing needs `expectedEnd` ("2027-03-09"), the date
 *                  the person was shown, and is refused if it has changed.
 *
 * Cancelling releases the booking's BlockedDate rows and, if the booking was
 * paid, records the refund owed. The refund is worked out here from the
 * stored booking and its policy (lib/cancellation.ts), never from the
 * request. `expectedRefund` in the body is only compared with it: if the
 * amount the guest was shown is no longer the amount owed, nothing happens
 * and they are asked to look again.
 *
 * Cancelling is refused from the check-in day onwards or once a payout
 * exists; those go to support (lib/cancelRules.ts).
 *
 * The current status is checked again as part of the update's own `where`
 * clause so two concurrent requests can't both succeed against a stale read,
 * and the database allows one Refund per booking.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()
    const action: Action = body.action

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        listing: { select: { title: true, cancellationPolicy: true } },
        payments: { where: { status: 'SUCCESS' }, orderBy: { createdAt: 'desc' }, take: 1 },
        instalments: { select: { sequence: true, status: true, amount: true, periodEnd: true } },
      },
    })
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    // ── End a tenancy early: its host, or an admin ──────────────────────
    if (action === 'end-tenancy') {
      const isAdmin = sessionUser.role === 'ADMIN'
      if (!isAdmin && sessionUser.role !== 'HOST') {
        return NextResponse.json({ error: HOSTS_ONLY_MESSAGE }, { status: 403 })
      }
      if (!isAdmin && sessionUser.id !== booking.hostId) {
        return NextResponse.json({ error: 'Only the host can end this tenancy' }, { status: 403 })
      }
      const quote = endTenancyQuote({ booking, instalments: booking.instalments })
      if (!quote.ok) return NextResponse.json({ error: quote.error }, { status: 409 })
      const endsOn = quote.endsOn
      if (body.preview === true) return NextResponse.json({ preview: { endsOn: dayKey(endsOn) } })
      // The date the person was shown must still be the date it would end
      if (body.expectedEnd !== dayKey(endsOn)) {
        return NextResponse.json(
          { error: 'The end date has changed since you were shown it. Please review it and confirm again.', preview: { endsOn: dayKey(endsOn) } },
          { status: 409 },
        )
      }

      const settled = booking.instalments.filter((i) => SETTLED_INSTALMENT_STATUSES.includes(i.status)).length
      const ended = await db.$transaction(async (tx) => {
        // Part of the where: ended, cancelled or completed by someone else
        // in the meantime changes nothing
        const updated = await tx.booking.updateMany({
          where: { id, status: 'CONFIRMED', endedEarlyAt: null, checkOut: booking.checkOut },
          data: { originalCheckOut: booking.checkOut, checkOut: endsOn, endedEarlyBy: isAdmin ? 'ADMIN' : 'HOST', endedEarlyAt: new Date() },
        })
        if (updated.count === 0) return false
        // A month paid for since the date was worked out would be cut off: start again
        const settledNow = await tx.instalment.count({ where: { bookingId: id, status: { in: SETTLED_INSTALMENT_STATUSES } } })
        if (settledNow !== settled) throw new Error('RENT_CHANGED')
        // The months not paid for are no longer owed
        await tx.instalment.updateMany({ where: { bookingId: id, status: { in: OPEN_INSTALMENT_STATUSES } }, data: { status: 'CANCELLED' } })
        // Open the dates after the new end, never a host's own blocks
        await tx.blockedDate.deleteMany({
          where: { listingId: booking.listingId, reason: 'BOOKED', date: { gte: endsOn, lt: booking.checkOut } },
        })
        return true
      }).catch((error) => {
        if (error instanceof Error && error.message === 'RENT_CHANGED') return false
        throw error
      })
      if (!ended) {
        return NextResponse.json({ error: 'This tenancy changed a moment ago. Nothing was ended. Please look again.' }, { status: 409 })
      }
      notify('tenancy.ended_early', { bookingId: id })
      return NextResponse.json({
        endsOn: dayKey(endsOn),
        message: 'The tenancy now ends at the end of the last month paid for. Nothing is refunded, and no more rent is owed after that date.',
      })
    }

    if (action === 'cancel') {
      if (sessionUser.id !== booking.guestId) {
        return NextResponse.json({ error: 'Only the guest can cancel this booking' }, { status: 403 })
      }
    } else if (sessionUser.role !== 'HOST') {
      // Accepting, declining and a host's cancellation are for hosts only
      return NextResponse.json({ error: HOSTS_ONLY_MESSAGE }, { status: 403 })
    } else if (sessionUser.id !== booking.hostId) {
      return NextResponse.json(
        { error: action === 'host-cancel' ? 'Only the host can cancel this booking' : 'Only the host can respond to this booking request' },
        { status: 403 },
      )
    }

    // ── Accept or decline a request ─────────────────────────────────────
    if (action === 'accept' || action === 'decline') {
      if (booking.status !== 'PENDING') {
        return NextResponse.json(
          { error: `Cannot ${action} a booking that is ${booking.status.toLowerCase()}` },
          { status: 409 },
        )
      }
      // Money that reached a request before it was accepted is on its way
      // back to the guest (lib/paymentSettle.ts); accepting over the top of
      // that would leave a confirmed booking with a refund in flight
      if (action === 'accept' && booking.paymentStatus !== 'UNPAID') {
        return NextResponse.json(
          { error: 'This request cannot be accepted online because a payment on it is being refunded. Please contact support at support@fiegh.com.' },
          { status: 409 },
        )
      }
      try {
        const updated = await db.booking.update({
          where: { id, status: 'PENDING' },
          data: action === 'accept'
            ? { status: 'CONFIRMED', payBy: payDeadline('ACCEPTED', booking.checkIn) }
            : { status: 'DECLINED' },
          include: bookingInclude,
        })
        notify(action === 'accept' ? 'booking.accepted' : 'booking.declined', { bookingId: id })
        return NextResponse.json({ booking: updated })
      } catch (txErr) {
        if (txErr instanceof Prisma.PrismaClientKnownRequestError && txErr.code === 'P2025') {
          return NextResponse.json({ error: `Cannot ${action} a booking that is no longer pending` }, { status: 409 })
        }
        throw txErr
      }
    }

    // ── Cancel ──────────────────────────────────────────────────────────
    const by = action === 'host-cancel' ? 'HOST' : 'GUEST'

    let cancelReason: string | null = null
    if (by === 'HOST') {
      if (!isHostCancelReason(body.reason)) {
        return NextResponse.json({ error: 'Choose a reason for cancelling' }, { status: 400 })
      }
      const note = typeof body.note === 'string' ? body.note.trim() : ''
      if (note.length > MAX_CANCEL_NOTE) {
        return NextResponse.json({ error: `The note can be at most ${MAX_CANCEL_NOTE} characters` }, { status: 400 })
      }
      cancelReason = note ? `${body.reason}: ${note}` : body.reason
    }

    const payout = await db.payout.findFirst({ where: { bookingId: id }, select: { id: true } })
    const payment = booking.payments[0] ?? null
    // Paid in instalments: the refund is worked out from the rent paid so far
    // (the first instalment), not the rent for the whole tenancy
    const preview = previewCancellation({
      booking: { ...booking, subtotal: refundableRent(booking.subtotal, booking.instalments) },
      payment, hasPayout: !!payout, by,
    })
    if (!preview.canCancel) {
      return NextResponse.json({ error: preview.message }, { status: 409 })
    }

    const quote = preview.quote
    if (quote) {
      // The amount the person was shown must still be the amount owed
      const expected = Number(body.expectedRefund)
      if (!Number.isFinite(expected) || Math.abs(expected - quote.total) > 0.005) {
        return NextResponse.json(
          { error: 'The refund amount has changed since you were shown it. Please review it and confirm again.', preview },
          { status: 409 },
        )
      }
    }

    let refundId: string | null = null
    let updated
    try {
      updated = await db.$transaction(async (tx) => {
        const result = await tx.booking.update({
          where: { id, status: booking.status },
          data: { status: 'CANCELLED', cancelledBy: by, cancelledAt: new Date(), cancelReason },
          include: bookingInclude,
        })

        // Rent instalments of a cancelled booking are no longer owed
        await tx.instalment.updateMany({ where: { bookingId: id, status: { in: OPEN_INSTALMENT_STATUSES } }, data: { status: 'CANCELLED' } })

        await tx.blockedDate.deleteMany({
          where: {
            listingId: result.listingId,
            // Only the rows the booking itself created, never a host's own blocks
            reason: 'BOOKED',
            date: { gte: result.checkIn, lt: result.checkOut },
          },
        })

        if (quote && payment && quote.total > 0) {
          const refund = await tx.refund.create({
            data: {
              bookingId: id,
              paymentId: payment.id,
              reason: by === 'HOST' ? 'HOST_CANCELLED' : 'GUEST_CANCELLED',
              policy: by === 'HOST' ? null : quote.policy,
              stayRefund: quote.stayRefund,
              serviceFeeRefund: quote.serviceFeeRefund,
              depositRefund: quote.depositRefund,
              amount: quote.total,
              amountPesewas: preview.refundPesewas,
            },
          })
          refundId = refund.id
        }

        if (by === 'HOST') {
          // Every admin hears about a host cancelling a confirmed booking.
          // No penalty is applied; the reason is kept for a later feature.
          const admins = await tx.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })
          if (admins.length > 0) {
            await tx.notification.createMany({
              data: admins.map((admin) => ({
                userId: admin.id,
                type: 'HOST_CANCELLED_BOOKING',
                title: 'A host cancelled a confirmed booking',
                body: `${booking.listing.title}: ${HOST_CANCEL_REASONS[body.reason as keyof typeof HOST_CANCEL_REASONS]}. ${quote ? `The guest is owed ${formatUsd(quote.total)}.` : 'Nothing had been paid.'} Booking ${id}.`,
              })),
            })
          }
        }

        return result
      })
    } catch (txErr) {
      if (txErr instanceof Prisma.PrismaClientKnownRequestError && (txErr.code === 'P2025' || txErr.code === 'P2002')) {
        return NextResponse.json({ error: 'This booking has already been cancelled' }, { status: 409 })
      }
      throw txErr
    }

    // The booking is cancelled and the refund is on record. Sending it does
    // nothing while refunds are switched off, and a failure here is picked
    // up by the hourly refund job, so it never undoes the cancellation.
    if (refundId) {
      try {
        await sendRefund(refundId)
      } catch (error) {
        console.error('[Booking cancel] sendRefund threw for refund', refundId, error)
      }
    }

    notify(by === 'HOST' ? 'booking.cancelled_by_host' : preview.withdrawal ? 'booking.request_withdrawn' : 'booking.cancelled_by_guest', { bookingId: id })

    const message = !quote
      ? (preview.withdrawal ? 'Your request has been withdrawn. Nothing was charged.' : 'The booking is cancelled. Nothing was charged.')
      : quote.total > 0
        ? (by === 'HOST'
            ? `The booking is cancelled. The guest will be refunded ${formatUsd(quote.total)}.`
            : `Your booking is cancelled. ${formatUsd(quote.total)} will be refunded. ${REFUND_TIMING}`)
        : `Your booking is cancelled. Under the ${preview.policyLabel} policy nothing is refunded.`

    return NextResponse.json({
      booking: updated,
      refund: quote ? { ...quote, recorded: !!refundId } : null,
      message,
    })
  } catch (error) {
    console.error('Booking PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
}

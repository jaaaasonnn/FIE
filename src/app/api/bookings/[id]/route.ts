import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { REFUND_TIMING, previewCancellation } from '@/lib/cancellation'
import { HOST_CANCEL_REASONS, MAX_CANCEL_NOTE, isHostCancelReason } from '@/lib/cancellationPolicy'
import { sendRefund } from '@/lib/refunds'
import { formatUsd } from '@/lib/utils'
import { HOSTS_ONLY_MESSAGE } from '@/lib/roles'

const bookingInclude = {
  listing: { select: { id: true, title: true, photos: true, city: true, neighbourhood: true } },
  guest:   { select: { id: true, name: true, profilePhoto: true, trustScore: true, isVerified: true } },
  host:    { select: { id: true, name: true, profilePhoto: true } },
} as const

type Action = 'accept' | 'decline' | 'cancel' | 'host-cancel'
const VALID_ACTIONS: Action[] = ['accept', 'decline', 'cancel', 'host-cancel']

/**
 * PATCH /api/bookings/[id]
 * Auth required. Transitions a booking's status:
 *   - accept:      PENDING   -> CONFIRMED  (host only)
 *   - decline:     PENDING   -> DECLINED   (host only)
 *   - cancel:      CONFIRMED -> CANCELLED  (guest only), or PENDING -> CANCELLED
 *                  when the guest withdraws a request the host has not answered.
 *   - host-cancel: CONFIRMED -> CANCELLED  (host only). Needs a reason from
 *                  HOST_CANCEL_REASONS; the guest gets everything back.
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
      },
    })
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
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
      try {
        const updated = await db.booking.update({
          where: { id, status: 'PENDING' },
          data: { status: action === 'accept' ? 'CONFIRMED' : 'DECLINED' },
          include: bookingInclude,
        })
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
    const preview = previewCancellation({ booking, payment, hasPayout: !!payout, by })
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

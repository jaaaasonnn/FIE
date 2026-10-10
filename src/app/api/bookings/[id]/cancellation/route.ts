import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { previewCancellation } from '@/lib/cancellation'
import { refundableRent } from '@/lib/rentRules'

/**
 * GET /api/bookings/[id]/cancellation
 *
 * What cancelling this booking would do right now, for the signed-in guest
 * or host: whether it can be cancelled online, the policy, and the exact
 * amount that would be refunded and kept. Changes nothing. The cancel itself
 * (PATCH /api/bookings/[id]) works the amount out again the same way.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })

    const { id } = await params
    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        listing: { select: { cancellationPolicy: true } },
        payments: { where: { status: 'SUCCESS' }, orderBy: { createdAt: 'desc' }, take: 1 },
        instalments: { select: { sequence: true, amount: true } },
      },
    })
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (user.id !== booking.guestId && user.id !== booking.hostId) {
      return NextResponse.json({ error: 'You do not have access to this booking' }, { status: 403 })
    }

    const payout = await db.payout.findFirst({ where: { bookingId: id }, select: { id: true } })
    const preview = previewCancellation({
      // Paid in instalments: the refund is worked out from the rent paid so
      // far (the first instalment), not the rent for the whole tenancy
      booking: { ...booking, subtotal: refundableRent(booking.subtotal, booking.instalments) },
      payment: booking.payments[0] ?? null,
      hasPayout: !!payout,
      by: user.id === booking.hostId ? 'HOST' : 'GUEST',
    })
    return NextResponse.json({ preview })
  } catch (error) {
    console.error('Cancellation preview error:', error)
    return NextResponse.json({ error: 'Failed to work out the cancellation' }, { status: 500 })
  }
}

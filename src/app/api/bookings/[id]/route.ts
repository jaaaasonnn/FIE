import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

const bookingInclude = {
  listing: { select: { id: true, title: true, photos: true, city: true, neighbourhood: true } },
  guest:   { select: { id: true, name: true, profilePhoto: true, trustScore: true, isVerified: true } },
  host:    { select: { id: true, name: true, profilePhoto: true } },
} as const

type Action = 'accept' | 'decline' | 'cancel'
const VALID_ACTIONS: Action[] = ['accept', 'decline', 'cancel']

/**
 * PATCH /api/bookings/[id]
 * Auth required. Transitions a booking's status:
 *   - accept:  PENDING   -> CONFIRMED  (host only)
 *   - decline: PENDING   -> DECLINED   (host only)
 *   - cancel:  CONFIRMED -> CANCELLED  (guest only) — also releases any
 *              BlockedDate rows for that stretch of dates.
 * Any other transition is rejected. The current status is checked again as
 * part of the update's own `where` clause (not just the earlier findUnique)
 * so two concurrent requests can't both succeed against a stale read.
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
    const { action } = await req.json()

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const booking = await db.booking.findUnique({ where: { id } })
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const requiredStatus = action === 'cancel' ? 'CONFIRMED' : 'PENDING'
    const newStatus =
      action === 'accept' ? 'CONFIRMED' : action === 'decline' ? 'DECLINED' : 'CANCELLED'

    if (action === 'accept' || action === 'decline') {
      if (sessionUser.id !== booking.hostId) {
        return NextResponse.json(
          { error: 'Only the host can respond to this booking request' },
          { status: 403 },
        )
      }
    } else {
      if (sessionUser.id !== booking.guestId) {
        return NextResponse.json({ error: 'Only the guest can cancel this booking' }, { status: 403 })
      }
    }

    if (booking.status !== requiredStatus) {
      return NextResponse.json(
        { error: `Cannot ${action} a booking that is ${booking.status.toLowerCase()}` },
        { status: 409 },
      )
    }

    try {
      const updated = await db.$transaction(async (tx) => {
        const result = await tx.booking.update({
          where: { id, status: requiredStatus },
          data: { status: newStatus },
          include: bookingInclude,
        })

        if (action === 'cancel') {
          await tx.blockedDate.deleteMany({
            where: {
              listingId: result.listingId,
              date: { gte: result.checkIn, lt: result.checkOut },
            },
          })
        }

        return result
      })

      return NextResponse.json({ booking: updated })
    } catch (txErr) {
      if (txErr instanceof Prisma.PrismaClientKnownRequestError && txErr.code === 'P2025') {
        return NextResponse.json(
          { error: `Cannot ${action} a booking that is no longer ${requiredStatus.toLowerCase()}` },
          { status: 409 },
        )
      }
      throw txErr
    }
  } catch (error) {
    console.error('Booking PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
}

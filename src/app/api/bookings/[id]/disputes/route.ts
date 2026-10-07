import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import {
  DECISION_AIM, MAX_DESCRIPTION, MIN_DESCRIPTION, disputeEligibility, isReasonFor, reasonLabel, reasonsFor,
  type DisputeRole,
} from '@/lib/disputes'
import { disputeInclude, disputeView, notifications } from '@/lib/disputeViews'

async function load(id: string) {
  return db.booking.findUnique({
    where: { id },
    include: {
      listing: { select: { title: true } },
      refund: { select: { id: true } },
      disputes: { include: disputeInclude, orderBy: { createdAt: 'asc' } },
    },
  })
}

/**
 * GET /api/bookings/[id]/disputes
 * The disputes on a booking, for its guest, its host or an admin, and whether
 * the person asking can report a problem right now.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    const { id } = await params
    const booking = await load(id)
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const isAdmin = user.role === 'ADMIN'
    const role: DisputeRole | null = user.id === booking.guestId ? 'GUEST' : user.id === booking.hostId ? 'HOST' : null
    if (!role && !isAdmin) return NextResponse.json({ error: 'You do not have access to this booking' }, { status: 403 })

    const disputes = await Promise.all(booking.disputes.map((d) => disputeView(d, booking, isAdmin)))
    const eligibility = role
      ? disputeEligibility({ role, booking, existingRoles: booking.disputes.map((d) => d.raisedByRole), hasRefund: !!booking.refund })
      : null

    return NextResponse.json({
      role,
      booking: { id: booking.id, title: booking.listing.title, checkIn: booking.checkIn, checkOut: booking.checkOut, status: booking.status },
      disputes,
      eligibility,
      reasons: role ? reasonsFor(role) : null,
      aim: DECISION_AIM,
    })
  } catch (error) {
    console.error('Disputes GET error:', error)
    return NextResponse.json({ error: 'Failed to load disputes' }, { status: 500 })
  }
}

/**
 * POST /api/bookings/[id]/disputes  { reason, description }
 * The guest or the host reports a problem. Who they are comes from the
 * session; when they may do it, and on which bookings, is in lib/disputes.ts.
 * One per side per booking, which the database also enforces. An open
 * dispute from the guest holds the host's payout until an admin decides.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    const { id } = await params
    const booking = await load(id)
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const role: DisputeRole | null = user.id === booking.guestId ? 'GUEST' : user.id === booking.hostId ? 'HOST' : null
    if (!role) return NextResponse.json({ error: 'Only the guest or the host of this booking can report a problem' }, { status: 403 })

    const eligibility = disputeEligibility({
      role, booking, existingRoles: booking.disputes.map((d) => d.raisedByRole), hasRefund: !!booking.refund,
    })
    if (!eligibility.ok) return NextResponse.json({ error: eligibility.message }, { status: 409 })

    const body = await req.json()
    if (!isReasonFor(role, body.reason)) return NextResponse.json({ error: 'Choose what the problem is' }, { status: 400 })
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length < MIN_DESCRIPTION) {
      return NextResponse.json({ error: `Describe the problem in at least ${MIN_DESCRIPTION} characters` }, { status: 400 })
    }
    if (description.length > MAX_DESCRIPTION) {
      return NextResponse.json({ error: `The description can be at most ${MAX_DESCRIPTION} characters` }, { status: 400 })
    }

    let dispute
    try {
      dispute = await db.$transaction(async (tx) => {
        const created = await tx.dispute.create({
          data: { bookingId: id, raisedById: user.id, raisedByRole: role, reason: body.reason, description },
        })
        await tx.disputeEvent.create({ data: { disputeId: created.id, actorId: user.id, type: 'RAISED' } })
        const admins = await tx.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })
        const other = role === 'GUEST' ? booking.hostId : booking.guestId
        await tx.notification.createMany({
          data: notifications(
            [other, ...admins.map((a) => a.id)],
            'DISPUTE_RAISED',
            role === 'GUEST' ? 'A guest reported a problem with a stay' : 'A host reported a problem after a stay',
            `${booking.listing.title}: ${reasonLabel(role, body.reason)}. Open the booking to read it and reply.`,
          ),
        })
        return created
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ error: 'You have already reported a problem on this booking.' }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({ dispute: { id: dispute.id, status: dispute.status } }, { status: 201 })
  } catch (error) {
    console.error('Disputes POST error:', error)
    return NextResponse.json({ error: 'Failed to report the problem' }, { status: 500 })
  }
}

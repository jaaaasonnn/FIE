import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { MAX_DESCRIPTION, MIN_DESCRIPTION, OPEN_DISPUTE_STATUSES } from '@/lib/disputes'
import { notifications } from '@/lib/disputeViews'
import { notify } from '@/lib/messaging/notify'

/**
 * POST /api/disputes/[id]  { response }
 * The other party's one reply to a dispute: the host answers a guest's
 * report, the guest answers a host's. Only while the dispute is open, and
 * only once (checked again in the update itself).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    const { id } = await params
    const dispute = await db.dispute.findUnique({
      where: { id },
      include: { booking: { select: { guestId: true, hostId: true, listing: { select: { title: true } } } } },
    })
    if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 })

    const other = dispute.raisedByRole === 'GUEST' ? dispute.booking.hostId : dispute.booking.guestId
    if (user.id !== other) {
      return NextResponse.json({ error: 'Only the other party to this booking can reply' }, { status: 403 })
    }
    if (!OPEN_DISPUTE_STATUSES.includes(dispute.status)) {
      return NextResponse.json({ error: 'This dispute has already been decided' }, { status: 409 })
    }
    if (dispute.response) return NextResponse.json({ error: 'You have already replied' }, { status: 409 })

    const body = await req.json()
    const response = typeof body.response === 'string' ? body.response.trim() : ''
    if (response.length < MIN_DESCRIPTION) {
      return NextResponse.json({ error: `Write your reply in at least ${MIN_DESCRIPTION} characters` }, { status: 400 })
    }
    if (response.length > MAX_DESCRIPTION) {
      return NextResponse.json({ error: `The reply can be at most ${MAX_DESCRIPTION} characters` }, { status: 400 })
    }

    const done = await db.$transaction(async (tx) => {
      const updated = await tx.dispute.updateMany({
        where: { id, response: null, status: { in: OPEN_DISPUTE_STATUSES } },
        data: { response, respondedAt: new Date() },
      })
      if (updated.count === 0) return false
      await tx.disputeEvent.create({ data: { disputeId: id, actorId: user.id, type: 'REPLIED' } })
      const admins = await tx.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })
      await tx.notification.createMany({
        data: notifications(
          [dispute.raisedById, ...admins.map((a) => a.id)],
          'DISPUTE_REPLIED',
          'There is a reply to a reported problem',
          `${dispute.booking.listing.title}: the ${dispute.raisedByRole === 'GUEST' ? 'host' : 'guest'} has replied.`,
        ),
      })
      return true
    })
    if (!done) return NextResponse.json({ error: 'You have already replied' }, { status: 409 })
    notify('dispute.replied', { disputeId: id })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Dispute reply error:', error)
    return NextResponse.json({ error: 'Failed to send the reply' }, { status: 500 })
  }
}

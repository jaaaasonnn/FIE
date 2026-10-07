import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/roles'
import { OPEN_DISPUTE_STATUSES, outcomesFor, outcomeLabel } from '@/lib/disputes'
import { disputeInclude, disputeView } from '@/lib/disputeViews'
import { decideDispute } from '@/lib/disputeDecisions'
import { disputeDecisionsEnabled } from '@/lib/payoutSwitches'

const MAX_NOTE = 1000

/**
 * GET /api/admin/disputes
 * Every dispute with what an admin needs to decide it: both statements, the
 * photos, the booking, the amounts, any refund or payout already on record,
 * and how many disputes each person has raised before.
 */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const disputes = await db.dispute.findMany({
      include: {
        ...disputeInclude,
        booking: {
          include: {
            listing: { select: { title: true } },
            guest: { select: { id: true, name: true } },
            host: { select: { id: true, name: true } },
            refund: { select: { amount: true, status: true, reason: true } },
            payouts: { select: { amount: true, status: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const raisedCounts = await db.dispute.groupBy({ by: ['raisedById'], _count: true })
    const countFor = (userId: string) => raisedCounts.find((r) => r.raisedById === userId)?._count ?? 0

    const items = await Promise.all(disputes.map(async (d) => {
      const b = d.booking
      return {
        ...(await disputeView(d, b, true)),
        open: OPEN_DISPUTE_STATUSES.includes(d.status),
        outcomes: outcomesFor(d.raisedByRole).map((o) => ({ value: o, label: outcomeLabel(d.raisedByRole, o) })),
        booking: {
          id: b.id, title: b.listing.title, rentalMode: b.rentalMode, checkIn: b.checkIn, checkOut: b.checkOut,
          status: b.status, paymentStatus: b.paymentStatus,
          subtotal: b.subtotal, serviceFee: b.serviceFee, damageDeposit: b.damageDeposit, totalPrice: b.totalPrice,
          guest: { name: b.guest.name, disputesRaised: countFor(b.guest.id) },
          host: { name: b.host.name, disputesRaised: countFor(b.host.id) },
          refund: b.refund,
          payout: b.payouts[0] ?? null,
        },
      }
    }))

    return NextResponse.json({ disputes: items, decisionsEnabled: disputeDecisionsEnabled() })
  } catch (error) {
    console.error('Admin disputes GET error:', error)
    return NextResponse.json({ error: 'Failed to load disputes' }, { status: 500 })
  }
}

/**
 * POST /api/admin/disputes  { disputeId, action, ... }
 *   - review:     mark an open dispute as under review
 *   - note:       a private note, seen by admins only            { note }
 *   - correction: a note on the history both parties can see,
 *                 for putting a mistake right by hand             { note }
 *   - decide:     { outcome, amount?, resolution, dryRun? }
 *                 With dryRun, or while DISPUTE_DECISIONS_ENABLED is off,
 *                 this reports exactly what the decision would do and
 *                 writes nothing (lib/disputeDecisions.ts).
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const admin = auth.user

    const body = await req.json()
    const { disputeId, action } = body
    if (typeof disputeId !== 'string') return NextResponse.json({ error: 'disputeId is required' }, { status: 400 })

    if (action === 'decide') {
      const result = await decideDispute({
        disputeId, adminId: admin.id, outcome: body.outcome, amount: body.amount,
        resolution: body.resolution, dryRun: body.dryRun === true,
      })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json(result)
    }

    const dispute = await db.dispute.findUnique({ where: { id: disputeId }, select: { id: true, status: true } })
    if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 })

    if (action === 'review') {
      const updated = await db.dispute.updateMany({ where: { id: disputeId, status: 'OPEN' }, data: { status: 'UNDER_REVIEW' } })
      if (updated.count === 0) return NextResponse.json({ error: 'This dispute is not waiting for review' }, { status: 409 })
      await db.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'UNDER_REVIEW' } })
      return NextResponse.json({ success: true })
    }

    if (action === 'note' || action === 'correction') {
      const note = typeof body.note === 'string' ? body.note.trim() : ''
      if (!note) return NextResponse.json({ error: 'Write the note' }, { status: 400 })
      if (note.length > MAX_NOTE) return NextResponse.json({ error: `A note can be at most ${MAX_NOTE} characters` }, { status: 400 })
      await db.disputeEvent.create({
        data: { disputeId, actorId: admin.id, type: action === 'note' ? 'ADMIN_NOTE' : 'CORRECTION', note },
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Admin disputes POST error:', error)
    return NextResponse.json({ error: 'Failed to update the dispute' }, { status: 500 })
  }
}

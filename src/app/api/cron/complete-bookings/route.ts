import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET/POST /api/cron/complete-bookings
 *
 * Not user-facing — meant to be hit periodically by an external scheduler,
 * same pattern as /api/cron/process-payouts (no scheduler infra existed
 * before that one either; wiring an actual recurring trigger up is a
 * deployment-time step, not something to configure against a local dev
 * server).
 *
 * Deliberately a SEPARATE endpoint from process-payouts rather than a step
 * inside it: the SHORT_STAY payout trigger fires 24h after check-IN, not
 * after checkout/completion, so this and the payout cron check two
 * independent conditions on two different timestamps — they aren't
 * sequential steps of one process. Folding them together would couple a
 * checkout-based check to a check-in-based one for no reason, and risk a
 * slow/broken completion query delaying payout processing.
 *
 * Query is naturally idempotent: once a booking's status flips to
 * COMPLETED, it no longer matches status: 'CONFIRMED' and is never
 * re-selected on a later run.
 */
async function completeDueBookings() {
  const now = new Date()

  // paymentStatus: 'PAID' matters here, not just status: 'CONFIRMED' — an
  // instant-book listing creates its booking as CONFIRMED immediately,
  // before payment (see POST /api/bookings), so an unpaid booking can sit
  // at CONFIRMED with a checkOut date that quietly passes. Without this
  // filter, an instant-book confirmation nobody ever paid for would
  // "complete" and become eligible for the review flow, which checks only
  // status === 'COMPLETED'.
  const due = await db.booking.findMany({
    where: { status: 'CONFIRMED', paymentStatus: 'PAID', checkOut: { lte: now } },
    select: { id: true },
  })

  if (due.length === 0) {
    return { transitioned: 0, bookingIds: [] }
  }

  const ids = due.map((b) => b.id)
  await db.booking.updateMany({
    where: { id: { in: ids } },
    data: { status: 'COMPLETED' },
  })

  return { transitioned: ids.length, bookingIds: ids }
}

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('x-cron-secret') === secret
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await completeDueBookings())
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await completeDueBookings())
}

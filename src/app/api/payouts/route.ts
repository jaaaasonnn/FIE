import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { duePayoutWhere, hostPayoutAmount } from '@/lib/cronRuns'
import { payoutGate } from '@/lib/payoutSwitches'

/**
 * GET /api/payouts?hostId=…
 * Returns payout records for the logged-in host (session must match hostId).
 */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const hostId = new URL(req.url).searchParams.get('hostId')
    if (!hostId) {
      return NextResponse.json({ error: 'hostId required' }, { status: 400 })
    }
    if (hostId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const payouts = await db.payout.findMany({
      where: { hostId },
      orderBy: { createdAt: 'desc' },
    })

    // Stays whose payout has fallen due but cannot be sent because the host
    // has no verified payout method. Only once payouts are switched on:
    // before that nothing is owed through this route.
    let waitingForMethod: { count: number; amount: number } | null = null
    const gate = payoutGate()
    if (gate.live) {
      const host = await db.user.findUnique({
        where: { id: hostId },
        select: { paystackRecipientCode: true, payoutMethodVerifiedAt: true },
      })
      if (!host?.paystackRecipientCode || !host.payoutMethodVerifiedAt) {
        const due = await db.booking.findMany({
          where: { ...duePayoutWhere(new Date(), gate.notBefore), hostId },
          select: { subtotal: true },
        })
        if (due.length > 0) {
          waitingForMethod = {
            count: due.length,
            amount: due.reduce((sum, b) => sum + hostPayoutAmount(b.subtotal), 0),
          }
        }
      }
    }

    return NextResponse.json({ payouts, waitingForMethod })
  } catch (error) {
    console.error('Payouts GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch payouts' }, { status: 500 })
  }
}

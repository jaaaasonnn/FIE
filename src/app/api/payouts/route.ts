import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireHost } from '@/lib/roles'
import { duePayouts } from '@/lib/cronRuns'
import { payoutGate } from '@/lib/payoutSwitches'

/**
 * GET /api/payouts?hostId=…
 * Returns payout records for the logged-in host (session must match hostId).
 */
export async function GET(req: Request) {
  try {
    // Hosts only. Nothing below this line changed: it reads payout rows.
    const auth = await requireHost()
    if (auth.error) return auth.error
    const user = auth.user

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
      include: {
        booking: { select: { listing: { select: { title: true } } } },
        instalment: { select: { sequence: true, periodStart: true, periodEnd: true } },
      },
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
        // Short stays and rent instalments alike
        const due = await duePayouts(new Date(), gate.notBefore, hostId)
        if (due.length > 0) {
          waitingForMethod = { count: due.length, amount: due.reduce((sum, p) => sum + p.amount, 0) }
        }
      }
    }

    return NextResponse.json({ payouts, waitingForMethod })
  } catch (error) {
    console.error('Payouts GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch payouts' }, { status: 500 })
  }
}

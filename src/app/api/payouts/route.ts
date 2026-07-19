import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

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

    return NextResponse.json({ payouts })
  } catch (error) {
    console.error('Payouts GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch payouts' }, { status: 500 })
  }
}

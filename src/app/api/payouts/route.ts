import { hasNullByte, unreadableQuery } from '@/lib/validate'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireHost } from '@/lib/roles'
import { duePayouts } from '@/lib/cronRuns'
import { payoutGate } from '@/lib/payoutSwitches'
import { HOST_ID_SELECT, hostIdApproved, hostIdState } from '@/lib/hostId'
import { payoutCedis } from '@/lib/payoutCedis'

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

    if (hasNullByte(new URL(req.url).searchParams)) return unreadableQuery()
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
        instalment: { select: { sequence: true, periodStart: true, periodEnd: true, coveredFromDeposit: true } },
      },
    })
    // Each payout in cedis: the host's share of what the guest paid, at the
    // rate the guest paid at. Worked out from the payment, not stored.
    const cedis = await payoutCedis(payouts.map((p) => ({
      bookingId: p.bookingId ?? '', instalmentId: p.instalmentId, coveredFromDeposit: p.instalment?.coveredFromDeposit, amount: p.amount,
    })))
    const withCedis = payouts.map((p, n) => ({ ...p, amountPesewas: cedis[n] }))

    // Stays whose payout has fallen due but cannot be sent because the host
    // has no verified payout method. Only once payouts are switched on:
    // before that nothing is owed through this route.
    type Waiting = { count: number; amount: number; amountPesewas: number | null }
    let waitingForMethod: Waiting | null = null
    // The same, for a host whose ID FieGH has not approved yet (lib/hostId.ts)
    let waitingForId: Waiting | null = null
    const gate = payoutGate()
    const host = await db.user.findUnique({
      where: { id: hostId },
      select: { paystackRecipientCode: true, payoutMethodVerifiedAt: true, ...HOST_ID_SELECT },
    })
    if (gate.live) {
      const noMethod = !host?.paystackRecipientCode || !host.payoutMethodVerifiedAt
      const noId = !hostIdApproved(host)
      if (noMethod || noId) {
        // Short stays and rent instalments alike
        const due = await duePayouts(new Date(), gate.notBefore, hostId)
        if (due.length > 0) {
          const sum = {
            count: due.length, amount: due.reduce((total, p) => total + p.amount, 0),
            // Null when any of them cannot be worked out in cedis
            amountPesewas: due.every((p) => p.amountPesewas !== null) ? due.reduce((total, p) => total + (p.amountPesewas ?? 0), 0) : null,
          }
          if (noMethod) waitingForMethod = sum
          if (noId) waitingForId = sum
        }
      }
    }

    // Where the host's ID check stands, for the notice on their own pages.
    // This route is for the host alone: guests never see it.
    return NextResponse.json({ payouts: withCedis, waitingForMethod, waitingForId, idState: hostIdState(host) })
  } catch (error) {
    console.error('Payouts GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch payouts' }, { status: 500 })
  }
}

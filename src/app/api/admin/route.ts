import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/roles'
import { getAutoFetchStatus } from '@/lib/exchangeRate'
import { notify } from '@/lib/messaging/notify'
import { hostCommission } from '@/lib/disputes'
import { rentReceived } from '@/lib/rentRules'
import { clearChecks, tellCleared } from '@/lib/listingChecks'

export async function GET(req: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')

    if (type === 'stats') {
      const [
        totalUsers, totalListings, totalBookings, paidStays,
        pendingVerifications, openDisputes, hostCancellations, refundsOwed,
      ] = await Promise.all([
        db.user.count(),
        db.listing.count({ where: { isActive: true } }),
        db.booking.count(),
        // Stays that were paid for and still stand. Money is counted from the
        // stay price, never from payments: a payment also carries the damage
        // deposit, which is held for the guest and is not revenue.
        db.booking.findMany({
          where: { status: { in: ['CONFIRMED', 'COMPLETED'] }, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
          select: {
            subtotal: true, refund: { select: { stayRefund: true } },
            instalments: { select: { status: true, amount: true, coveredFromDeposit: true } },
          },
        }),
        db.verification.count({ where: { status: 'PENDING' } }),
        db.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
        // Confirmed bookings a host cancelled. No penalty is applied yet.
        db.booking.count({ where: { cancelledBy: 'HOST' } }),
        // Refunds recorded but not yet landed with the guest
        db.refund.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED', 'NEEDS_ATTENTION'] } } }),
      ])

      // What guests paid for the stays themselves, and FieGH's commission on it
      // A stay paid in instalments counts only the rent received so far, not
      // the rent for the months still to come
      const received = (b: (typeof paidStays)[number]) => (b.instalments.length > 0 ? rentReceived(b.instalments) : b.subtotal)
      const totalRevenue = paidStays.reduce((sum, b) => sum + Math.max(0, received(b) - (b.refund?.stayRefund ?? 0)), 0)
      const platformRevenue = paidStays.reduce((sum, b) => sum + hostCommission(received(b), b.refund?.stayRefund ?? 0), 0)

      return NextResponse.json({
        totalUsers, totalListings, totalBookings,
        totalRevenue,
        platformRevenue,
        pendingVerifications, openDisputes, hostCancellations, refundsOwed,
      })
    }

    if (type === 'exchange-rate') {
      const [rate, autoFetchStatus] = await Promise.all([
        db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' } }),
        getAutoFetchStatus(),
      ])
      return NextResponse.json({
        rate:            rate?.usdToGhs || 15.5,
        updatedAt:       rate?.updatedAt ?? null,
        updatedBy:       rate?.updatedBy ?? null,
        autoFetchStatus,
      })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Admin GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch admin data' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const { type, ...data } = await req.json()

    if (type === 'update-exchange-rate') {
      const { usdToGhs, updatedBy } = data
      if (!usdToGhs || usdToGhs <= 0) return NextResponse.json({ error: 'Invalid exchange rate' }, { status: 400 })

      const rate = await db.exchangeRate.create({ data: { usdToGhs, updatedBy } })
      return NextResponse.json({ rate })
    }

    // Switching a listing off as an admin also holds it, so its host cannot
    // switch it back on. 'flag-listing' is the older name for the same action.
    if (type === 'hold-listing' || type === 'flag-listing') {
      const { listingId } = data
      if (typeof listingId !== 'string') return NextResponse.json({ error: 'listingId required' }, { status: 400 })
      // A hold also removes "Address and photos checked", in the same transaction
      const [listing, cleared] = await db.$transaction(async (tx) => [
        await tx.listing.update({
          where: { id: listingId },
          data: { isActive: false, moderationHold: true },
          select: { id: true, isActive: true, moderationHold: true },
        }),
        await clearChecks(tx, listingId, 'LISTING_HELD'),
      ] as const)
      notify('listing.held', { listingId })
      tellCleared(cleared)
      return NextResponse.json({ success: true, listing })
    }

    // The only way a hold is ever cleared
    if (type === 'clear-hold') {
      const { listingId } = data
      if (typeof listingId !== 'string') return NextResponse.json({ error: 'listingId required' }, { status: 400 })
      const listing = await db.listing.update({
        where: { id: listingId },
        data: { isActive: true, moderationHold: false },
        select: { id: true, isActive: true, moderationHold: true },
      })
      notify('listing.reactivated', { listingId })
      return NextResponse.json({ success: true, listing })
    }

    // Disputes are decided only through POST /api/admin/disputes
    // (lib/disputeDecisions.ts), behind DISPUTE_DECISIONS_ENABLED. There is
    // no action for them here.

    return NextResponse.json({ error: 'Invalid action type' }, { status: 400 })
  } catch (error) {
    console.error('Admin POST error:', error)
    return NextResponse.json({ error: 'Admin action failed' }, { status: 500 })
  }
}

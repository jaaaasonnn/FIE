import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { getAutoFetchStatus } from '@/lib/exchangeRate'

export async function GET(req: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')

    if (type === 'stats') {
      const [
        totalUsers, totalListings, totalBookings, totalRevenue,
        pendingVerifications, openDisputes, hostCancellations, refundsOwed,
      ] = await Promise.all([
        db.user.count(),
        db.listing.count({ where: { isActive: true } }),
        db.booking.count(),
        db.payment.aggregate({ _sum: { amount: true }, where: { status: 'SUCCESS' } }),
        db.verification.count({ where: { status: 'PENDING' } }),
        db.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
        // Confirmed bookings a host cancelled. No penalty is applied yet.
        db.booking.count({ where: { cancelledBy: 'HOST' } }),
        // Refunds recorded but not yet landed with the guest
        db.refund.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED', 'NEEDS_ATTENTION'] } } }),
      ])

      const platformRevenue = (totalRevenue._sum.amount || 0) * 0.08

      return NextResponse.json({
        totalUsers, totalListings, totalBookings,
        totalRevenue: totalRevenue._sum.amount || 0,
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

    if (type === 'suspend-user') {
      // In a real app, add a `status` field to User model and set to SUSPENDED
      return NextResponse.json({ success: true, message: 'User suspended' })
    }

    // Switching a listing off as an admin also holds it, so its host cannot
    // switch it back on. 'flag-listing' is the older name for the same action.
    if (type === 'hold-listing' || type === 'flag-listing') {
      const { listingId } = data
      if (typeof listingId !== 'string') return NextResponse.json({ error: 'listingId required' }, { status: 400 })
      const listing = await db.listing.update({
        where: { id: listingId },
        data: { isActive: false, moderationHold: true },
        select: { id: true, isActive: true, moderationHold: true },
      })
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
      return NextResponse.json({ success: true, listing })
    }

    if (type === 'resolve-dispute') {
      const { disputeId, resolution } = data
      await db.dispute.update({
        where: { id: disputeId },
        data: { status: 'RESOLVED', resolution }
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action type' }, { status: 400 })
  } catch (error) {
    console.error('Admin POST error:', error)
    return NextResponse.json({ error: 'Admin action failed' }, { status: 500 })
  }
}

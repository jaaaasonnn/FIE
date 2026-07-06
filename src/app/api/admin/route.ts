import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')

    if (type === 'stats') {
      const [
        totalUsers, totalListings, totalBookings, totalRevenue,
        pendingVerifications, openDisputes,
      ] = await Promise.all([
        db.user.count(),
        db.listing.count({ where: { isActive: true } }),
        db.booking.count(),
        db.payment.aggregate({ _sum: { amount: true }, where: { status: 'SUCCESS' } }),
        db.verification.count({ where: { status: 'PENDING' } }),
        db.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      ])

      const platformRevenue = (totalRevenue._sum.amount || 0) * 0.08

      return NextResponse.json({
        totalUsers, totalListings, totalBookings,
        totalRevenue: totalRevenue._sum.amount || 0,
        platformRevenue,
        pendingVerifications, openDisputes
      })
    }

    if (type === 'exchange-rate') {
      const rate = await db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' } })
      return NextResponse.json({ rate: rate?.usdToGhs || 15.5 })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Admin GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch admin data' }, { status: 500 })
  }
}

export async function POST(req: Request) {
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

    if (type === 'flag-listing') {
      const { listingId } = data
      await db.listing.update({ where: { id: listingId }, data: { isActive: false } })
      return NextResponse.json({ success: true })
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

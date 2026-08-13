import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

/**
 * GET /api/admin/listings — ADMIN only
 */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const listings = await db.listing.findMany({
      include: {
        host: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const mapped = listings.map((l) => ({
      id:       l.id,
      title:    l.title,
      host:     l.host.name ?? 'Unknown',
      hostId:   l.hostId,
      status:   l.isActive ? 'ACTIVE' : 'INACTIVE',
      flagged:  !l.isActive,
      region:   l.region,
      price:    l.priceNightly != null
        ? `$${l.priceNightly}/night`
        : l.priceMonthly != null
          ? `$${l.priceMonthly}/month`
          : '—',
    }))

    return NextResponse.json({ listings: mapped })
  } catch (error) {
    console.error('Admin listings GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 })
  }
}

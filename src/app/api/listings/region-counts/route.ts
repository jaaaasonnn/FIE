import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/listings/region-counts — public, unauthenticated. Real active
 * listing counts grouped by region, so the landing page's region cards
 * (and anything else needing this) never have to hardcode a number that
 * goes stale the moment inventory changes. Regions with zero listings
 * simply don't appear in the response — the caller decides how to render
 * that (e.g. "Coming soon"), not this endpoint.
 */
export async function GET() {
  const rows = await db.listing.groupBy({
    by: ['region'],
    where: { isActive: true },
    _count: true,
  })
  const counts = Object.fromEntries(rows.map((r) => [r.region, r._count]))
  return NextResponse.json({ counts })
}

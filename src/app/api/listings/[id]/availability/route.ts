import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/listings/[id]/availability
 *
 * Returns all date ranges currently blocked for a listing:
 *   - bookedRanges: from non-cancelled Bookings (PENDING or CONFIRMED)
 *   - blockedDates: from manual BlockedDate records (host-blocked days)
 *
 * Used by the calendar UI on the listing page to grey out unavailable dates.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: listingId } = await params

    const [bookings, blockedDateRows] = await Promise.all([
      db.booking.findMany({
        where: {
          listingId,
          status: { notIn: ['CANCELLED'] },
        },
        select: { checkIn: true, checkOut: true, status: true },
      }),
      db.blockedDate.findMany({
        where: { listingId },
        select: { date: true, reason: true },
      }),
    ])

    const bookedRanges = bookings.map((b) => ({
      start: b.checkIn.toISOString(),
      end: b.checkOut.toISOString(),
      status: b.status,
    }))

    const blockedDates = blockedDateRows.map((d) => d.date.toISOString())

    return NextResponse.json({ bookedRanges, blockedDates })
  } catch (error) {
    console.error('Availability GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 })
  }
}

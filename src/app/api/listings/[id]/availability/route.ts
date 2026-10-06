import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dayKey } from '@/lib/hostCalendar'

/**
 * GET /api/listings/[id]/availability
 *
 * Returns all date ranges currently blocked for a listing, as calendar days:
 *   - bookedRanges: from non-cancelled Bookings. `start` is the check-in day
 *     and `end` the check-out day, which is itself free for a new arrival.
 *   - blockedDates: BlockedDate rows (host-blocked days and booked nights)
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
          status: { notIn: ['CANCELLED', 'DECLINED'] },
        },
        select: { checkIn: true, checkOut: true, status: true },
      }),
      db.blockedDate.findMany({
        where: { listingId },
        select: { date: true, reason: true },
      }),
    ])

    // Calendar days ("2027-03-09"), never moments: see lib/stayDates.ts
    const bookedRanges = bookings.map((b) => ({
      start: dayKey(b.checkIn),
      end: dayKey(b.checkOut),
      status: b.status,
    }))

    const blockedDates = blockedDateRows.map((d) => dayKey(d.date))

    return NextResponse.json({ bookedRanges, blockedDates })
  } catch (error) {
    console.error('Availability GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 })
  }
}

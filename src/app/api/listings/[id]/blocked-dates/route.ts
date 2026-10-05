import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { HOST_BLOCK, dayKey, parseDayRange, parseNote } from '@/lib/hostCalendar'

// The host's calendar for one listing: read it, block days, unblock days.
// Every handler takes the user from the session and checks they own the
// listing (or are an admin). Nothing here trusts a host id from the request.

const TAKEN_STATUSES = ['PENDING', 'CONFIRMED']

async function requireCalendarAccess(listingId: string) {
  const user = await getSessionUser()
  if (!user) return { error: NextResponse.json({ error: 'You must be signed in' }, { status: 401 }) }

  const listing = await db.listing.findUnique({ where: { id: listingId }, select: { id: true, hostId: true } })
  if (!listing) return { error: NextResponse.json({ error: 'Listing not found' }, { status: 404 }) }

  if (listing.hostId !== user.id && user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'You can only manage the calendar of your own listings' }, { status: 403 }) }
  }
  return { listing }
}

const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** GET: the host's own blocks (with their private notes) and the guest bookings that take dates. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error } = await requireCalendarAccess(id)
    if (error) return error

    const [blocks, bookings] = await Promise.all([
      db.blockedDate.findMany({
        where: { listingId: id, reason: HOST_BLOCK },
        select: { date: true, note: true },
        orderBy: { date: 'asc' },
      }),
      db.booking.findMany({
        where: { listingId: id, status: { in: TAKEN_STATUSES } },
        select: { id: true, checkIn: true, checkOut: true, status: true, guest: { select: { name: true } } },
        orderBy: { checkIn: 'asc' },
      }),
    ])

    return NextResponse.json({
      blocks: blocks.map((b) => ({ date: dayKey(b.date), note: b.note })),
      bookings: bookings.map((b) => ({
        id: b.id,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        status: b.status,
        guestName: b.guest.name?.split(' ')[0] ?? 'Guest',
      })),
    })
  } catch (error) {
    console.error('Calendar GET error:', error)
    return NextResponse.json({ error: 'Failed to load the calendar' }, { status: 500 })
  }
}

/** POST { start, end?, note? }: block an inclusive range of days. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error } = await requireCalendarAccess(id)
    if (error) return error

    const body = await req.json().catch(() => ({}))
    const range = parseDayRange(body.start, body.end, { forBlocking: true })
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })
    const note = parseNote(body.note)
    if (!note.ok) return NextResponse.json({ error: note.error }, { status: 400 })

    // Serializable, like booking creation, so a guest's booking and a host's
    // block for the same days cannot both succeed.
    try {
      const created = await db.$transaction(async (tx) => {
        // A booking takes a day when that day's midday falls inside the stay
        const clash = await tx.booking.findFirst({
          where: {
            listingId: id,
            status: { in: TAKEN_STATUSES },
            checkIn: { lte: range.end },
            checkOut: { gt: range.start },
          },
          select: { checkIn: true, checkOut: true, status: true },
          orderBy: { checkIn: 'asc' },
        })
        if (clash) {
          const err = new Error(
            `These dates overlap a ${clash.status.toLowerCase()} booking from ${shortDate(clash.checkIn)} to ${shortDate(clash.checkOut)}`,
          )
          ;(err as NodeJS.ErrnoException).code = 'BOOKING_CLASH'
          throw err
        }

        const existing = await tx.blockedDate.findMany({
          where: { listingId: id, reason: HOST_BLOCK, date: { gte: range.start, lte: range.end } },
          select: { date: true },
        })
        const already = new Set(existing.map((e) => dayKey(e.date)))
        const fresh = range.days.filter((d) => !already.has(dayKey(d)))
        if (fresh.length > 0) {
          await tx.blockedDate.createMany({
            data: fresh.map((date) => ({ listingId: id, date, reason: HOST_BLOCK, note: note.note })),
          })
        }
        return fresh.length
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      return NextResponse.json({ blocked: created, alreadyBlocked: range.days.length - created }, { status: 201 })
    } catch (txErr) {
      const code = (txErr as NodeJS.ErrnoException).code
      if (code === 'BOOKING_CLASH') {
        return NextResponse.json({ error: (txErr as Error).message }, { status: 409 })
      }
      if (code === 'P2034') {
        return NextResponse.json({ error: 'Those dates were just booked. Reload the calendar and try again.' }, { status: 409 })
      }
      throw txErr
    }
  } catch (error) {
    console.error('Calendar POST error:', error)
    return NextResponse.json({ error: 'Failed to block those dates' }, { status: 500 })
  }
}

/** DELETE { start, end? }: remove the host's own blocks in an inclusive range. Guest bookings are never touched. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error } = await requireCalendarAccess(id)
    if (error) return error

    const body = await req.json().catch(() => ({}))
    const range = parseDayRange(body.start, body.end, { forBlocking: false })
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })

    const result = await db.blockedDate.deleteMany({
      where: { listingId: id, reason: HOST_BLOCK, date: { gte: range.start, lte: range.end } },
    })
    return NextResponse.json({ unblocked: result.count })
  } catch (error) {
    console.error('Calendar DELETE error:', error)
    return NextResponse.json({ error: 'Failed to unblock those dates' }, { status: 500 })
  }
}

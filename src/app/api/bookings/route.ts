import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { calculateFees } from '@/lib/utils'
import { getSessionUser } from '@/lib/session'
import { quoteStay } from '@/lib/bookingQuote'
import { DAY_MS } from '@/lib/stayDates'
import { asPolicy } from '@/lib/cancellationPolicy'
import { HOSTS_ONLY_MESSAGE } from '@/lib/roles'
import { payDeadline } from '@/lib/payDeadline'
import { notify } from '@/lib/messaging/notify'
import { buildSchedule } from '@/lib/rentRules'

/** What a guest or host is shown of a rent instalment: no admin's id. */
const instalmentSelect = {
  id: true, sequence: true, periodStart: true, periodEnd: true, dueDate: true,
  amount: true, depositAmount: true, status: true, paidAt: true, coveredFromDeposit: true,
} as const

// ── POST /api/bookings — create a new PENDING booking ─────────────────────
export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in to book' }, { status: 401 })
    }

    const body = await req.json()
    const {
      listingId, rentalMode,
      checkIn, checkOut, specialRequests,
    } = body
    // checkIn and checkOut are calendar days ("2027-03-09"), stored at 12:00
    // UTC so every time zone reads the same date.
    // body.nightsOrMonths is deliberately not read: the length of the stay,
    // and so the price, is worked out below from the dates and the listing.
    // Always the authenticated session user — never a client-supplied
    // guestId, which would let a caller create bookings (and occupy real
    // calendar availability on instant-book listings) as anyone else.
    const guestId = user.id

    if (!listingId || !rentalMode || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: 'Missing required booking fields' },
        { status: 400 },
      )
    }

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      include: { host: true },
    })

    if (!listing)         return NextResponse.json({ error: 'Listing not found' },       { status: 404 })
    if (!listing.isActive) return NextResponse.json({ error: 'Listing is not available' }, { status: 400 })
    // A host booking their own home would occupy the calendar and create a
    // payment owed to themselves.
    if (listing.hostId === user.id) {
      return NextResponse.json({ error: 'You cannot book your own listing' }, { status: 403 })
    }

    const quote = quoteStay(listing, rentalMode, checkIn, checkOut)
    if (!quote.ok) {
      return NextResponse.json({ error: quote.error }, { status: 400 })
    }
    const { checkIn: checkInDate, checkOut: checkOutDate, units, pricePerUnit } = quote

    // ── Atomic conflict check + create ──────────────────────────────────
    // Serializable isolation is required on Postgres — unlike SQLite (single
    // writer, transactions are serialised for free), Postgres's default
    // READ COMMITTED would let two concurrent requests for overlapping dates
    // both pass the conflict check before either commits, double-booking
    // the listing. This forces Postgres to abort one of them instead.
    let booking
    try {
      booking = await db.$transaction(async (tx) => {
        const conflict = await tx.booking.findFirst({
          where: {
            listingId,
            status: { notIn: ['CANCELLED', 'DECLINED'] },
            OR: [
              { checkIn: { lt: checkOutDate }, checkOut: { gt: checkInDate } },
            ],
          },
        })

        if (conflict) {
          const err = new Error('DATE_CONFLICT')
          ;(err as NodeJS.ErrnoException).code = 'DATE_CONFLICT'
          throw err
        }

        // Dates the host or an earlier booking has blocked out
        const blocked = await tx.blockedDate.findFirst({
          where: { listingId, date: { gte: checkInDate, lt: checkOutDate } },
        })
        if (blocked) {
          const err = new Error('DATE_CONFLICT')
          ;(err as NodeJS.ErrnoException).code = 'DATE_CONFLICT'
          throw err
        }

        const subtotal = pricePerUnit * units
        const { serviceFee, total } = calculateFees(subtotal)
        const damageDeposit = listing.damageDeposit ?? 0

        const newBooking = await tx.booking.create({
          data: {
            listingId,
            guestId,
            hostId: listing.hostId,
            rentalMode,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            nightsOrMonths: units,
            pricePerUnit,
            subtotal,
            serviceFee,
            damageDeposit,
            totalPrice: total + damageDeposit,
            // instantBook listings go straight to CONFIRMED; others start PENDING
            status: listing.instantBook ? 'CONFIRMED' : 'PENDING',
            paymentStatus: 'UNPAID',
            // An instant booking holds its dates for an hour while it is paid
            // for. A request gets its deadline when the host accepts it.
            payBy: listing.instantBook ? payDeadline('INSTANT', checkInDate) : null,
            specialRequests: specialRequests ?? null,
            // The listing's policy as it stands now: a later change by the
            // host does not alter this guest's terms
            cancellationPolicy: asPolicy(listing.cancellationPolicy),
          },
        })

        // A monthly or long-term booking is paid in instalments: the advance
        // (worked out here from the listing, within the limits in
        // lib/rentRules.ts, never from the request) and then month by month.
        // Short stays get no rows and are paid in one payment.
        const schedule = buildSchedule({
          rentalMode, checkIn: checkInDate, units, subtotal, damageDeposit,
          advanceMonthsRequired: listing.advanceMonthsRequired,
        })
        if (schedule.length > 0) {
          await tx.instalment.createMany({ data: schedule.map((row) => ({ ...row, bookingId: newBooking.id })) })
        }

        // For instant-book, also stamp blocked dates immediately
        if (listing.instantBook) {
          const dates: { listingId: string; date: Date; reason: string }[] = []
          // One row per night, at 12:00 UTC like the stay itself
          for (let t = checkInDate.getTime(); t < checkOutDate.getTime(); t += DAY_MS) {
            dates.push({ listingId, date: new Date(t), reason: 'BOOKED' })
          }
          if (dates.length > 0) {
            await tx.blockedDate.createMany({ data: dates })
          }
        }

        return newBooking
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (txErr) {
      const code = (txErr as NodeJS.ErrnoException).code ?? (txErr as Error).message
      // Postgres also raises P2034 when Serializable isolation detects a
      // write conflict and aborts the transaction — treat it the same as an
      // explicit date conflict rather than a generic 500.
      if (code === 'DATE_CONFLICT' || code === 'P2034') {
        return NextResponse.json(
          { error: 'These dates are no longer available. Please choose different dates.' },
          { status: 409 },
        )
      }
      throw txErr
    }

    // A request needs the host's answer. An instant booking says nothing
    // until it is paid for, which is when it is really a booking.
    if (booking.status === 'PENDING') notify('booking.requested', { bookingId: booking.id })

    return NextResponse.json({ booking }, { status: 201 })
  } catch (error) {
    console.error('Booking POST error:', error)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}

// ── GET /api/bookings — list bookings by guestId, hostId, or direct id ────
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const id        = searchParams.get('id')
    const guestId   = searchParams.get('guestId')
    const hostId    = searchParams.get('hostId')
    const listingId = searchParams.get('listingId')

    // Single booking lookup (used by checkout page) — includes guest/host
    // PII (email, phone), so this needs to be scoped to the two parties
    // on the booking (or an admin), not just anyone who knows the id.
    if (id) {
      const user = await getSessionUser()
      if (!user) {
        return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
      }

      const booking = await db.booking.findUnique({
        where: { id },
        include: {
          listing: {
            select: {
              id: true, title: true, photos: true, city: true,
              neighbourhood: true, hostId: true,
              cancellationPolicy: true, instantBook: true,
              welcomeMessage: true,
            },
          },
          guest:    { select: { id: true, name: true, email: true, phone: true, profilePhoto: true } },
          host:     { select: { id: true, name: true, profilePhoto: true, phone: true } },
          payments: true,
          refund:   true,
          disputes: { select: { id: true, raisedByRole: true, status: true, outcome: true } },
          instalments: { orderBy: { sequence: 'asc' }, select: instalmentSelect },
        },
      })
      if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

      if (user.id !== booking.guestId && user.id !== booking.hostId && user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'You do not have access to this booking' }, { status: 403 })
      }

      return NextResponse.json({ booking })
    }

    // guestId/hostId are the security boundary here — this list is the
    // exact kind of thing (names, photos, trust scores, payment rows)
    // that shouldn't be fetchable for anyone just by knowing their id.
    if (!guestId && !hostId) {
      return NextResponse.json({ error: 'guestId or hostId is required' }, { status: 400 })
    }
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }
    if (guestId && user.id !== guestId && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'You do not have access to these bookings' }, { status: 403 })
    }
    // A host's bookings are for that host (or an admin): being signed in as
    // the same person is not enough if they are not a host
    if (hostId && user.role !== 'HOST' && user.role !== 'ADMIN') {
      return NextResponse.json({ error: HOSTS_ONLY_MESSAGE }, { status: 403 })
    }
    if (hostId && user.id !== hostId && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'You do not have access to these bookings' }, { status: 403 })
    }

    const where: Record<string, string> = {}
    if (guestId)   where.guestId   = guestId
    if (hostId)    where.hostId    = hostId
    if (listingId) where.listingId = listingId

    const bookings = await db.booking.findMany({
      where,
      include: {
        listing: {
          select: { id: true, title: true, photos: true, city: true, neighbourhood: true },
        },
        guest:    { select: { id: true, name: true, profilePhoto: true, trustScore: true, isVerified: true } },
        host:     { select: { id: true, name: true, profilePhoto: true } },
        payments: true,
        refund:   true,
        disputes: { select: { id: true, raisedByRole: true, status: true, outcome: true } },
        instalments: { orderBy: { sequence: 'asc' }, select: instalmentSelect },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ bookings })
  } catch (error) {
    console.error('Bookings GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }
}

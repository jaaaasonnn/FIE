import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateFees } from '@/lib/utils'

// ── POST /api/bookings — create a new PENDING booking ─────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      listingId, guestId, rentalMode,
      checkIn, checkOut, nightsOrMonths, specialRequests,
    } = body

    if (!listingId || !guestId || !rentalMode || !checkIn || !checkOut) {
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

    const checkInDate  = new Date(checkIn)
    const checkOutDate = new Date(checkOut)

    // ── Atomic conflict check + create ──────────────────────────────────
    // Wrapped in a Prisma interactive transaction so both the read and the
    // write happen in a single serialised operation. On SQLite this prevents
    // the TOCTOU race condition; on PostgreSQL you'd also add
    // { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }.
    let booking
    try {
      booking = await db.$transaction(async (tx) => {
        const conflict = await tx.booking.findFirst({
          where: {
            listingId,
            status: { notIn: ['CANCELLED'] },
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

        let pricePerUnit = 0
        if (rentalMode === 'SHORT_STAY') pricePerUnit = listing.priceNightly  ?? 0
        else if (rentalMode === 'TEMP_STAY')  pricePerUnit = listing.priceMonthly ?? 0
        else if (rentalMode === 'PERMANENT')  pricePerUnit = listing.priceAnnual  ?? 0

        const subtotal = pricePerUnit * (nightsOrMonths || 1)
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
            nightsOrMonths: nightsOrMonths || 1,
            pricePerUnit,
            subtotal,
            serviceFee,
            damageDeposit,
            totalPrice: total + damageDeposit,
            // instantBook listings go straight to CONFIRMED; others start PENDING
            status: listing.instantBook ? 'CONFIRMED' : 'PENDING',
            paymentStatus: 'UNPAID',
            specialRequests: specialRequests ?? null,
          },
        })

        // For instant-book, also stamp blocked dates immediately
        if (listing.instantBook) {
          const dates: { listingId: string; date: Date; reason: string }[] = []
          const d = new Date(checkInDate)
          while (d < checkOutDate) {
            dates.push({ listingId, date: new Date(d), reason: 'BOOKED' })
            d.setDate(d.getDate() + 1)
          }
          if (dates.length > 0) {
            await tx.blockedDate.createMany({ data: dates })
          }
        }

        return newBooking
      })
    } catch (txErr) {
      const code = (txErr as NodeJS.ErrnoException).code ?? (txErr as Error).message
      if (code === 'DATE_CONFLICT') {
        return NextResponse.json(
          { error: 'These dates are no longer available. Please choose different dates.' },
          { status: 409 },
        )
      }
      throw txErr
    }

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
    const id      = searchParams.get('id')
    const guestId = searchParams.get('guestId')
    const hostId  = searchParams.get('hostId')

    // Single booking lookup (used by checkout page)
    if (id) {
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
        },
      })
      if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
      return NextResponse.json({ booking })
    }

    const where: Record<string, string> = {}
    if (guestId) where.guestId = guestId
    if (hostId)  where.hostId  = hostId

    const bookings = await db.booking.findMany({
      where,
      include: {
        listing: {
          select: { id: true, title: true, photos: true, city: true, neighbourhood: true },
        },
        guest:    { select: { id: true, name: true, profilePhoto: true, trustScore: true, isVerified: true } },
        host:     { select: { id: true, name: true, profilePhoto: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ bookings })
  } catch (error) {
    console.error('Bookings GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }
}

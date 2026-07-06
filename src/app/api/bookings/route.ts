import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateFees } from '@/lib/utils'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      listingId, guestId, rentalMode,
      checkIn, checkOut, nightsOrMonths, specialRequests
    } = body

    if (!listingId || !guestId || !rentalMode || !checkIn || !checkOut) {
      return NextResponse.json({ error: 'Missing required booking fields' }, { status: 400 })
    }

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      include: { host: true }
    })

    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
    if (!listing.isActive) return NextResponse.json({ error: 'Listing is not available' }, { status: 400 })

    // Double-booking check
    const checkInDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)

    const conflict = await db.booking.findFirst({
      where: {
        listingId,
        status: { notIn: ['CANCELLED'] },
        OR: [
          { checkIn: { lt: checkOutDate }, checkOut: { gt: checkInDate } },
        ]
      }
    })

    if (conflict) {
      return NextResponse.json({ error: 'These dates are not available. Please choose different dates.' }, { status: 409 })
    }

    // Calculate price
    let pricePerUnit = 0
    if (rentalMode === 'SHORT_STAY') pricePerUnit = listing.priceNightly || 0
    else if (rentalMode === 'TEMP_STAY') pricePerUnit = listing.priceMonthly || 0
    else if (rentalMode === 'PERMANENT') pricePerUnit = listing.priceAnnual || 0

    const subtotal = pricePerUnit * (nightsOrMonths || 1)
    const { serviceFee, total } = calculateFees(subtotal)
    const damageDeposit = listing.damageDeposit || 0

    const booking = await db.booking.create({
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
        status: listing.instantBook ? 'CONFIRMED' : 'PENDING',
        paymentStatus: 'UNPAID',
        specialRequests: specialRequests || null
      }
    })

    // Block dates for confirmed instant bookings
    if (listing.instantBook) {
      const dates: { listingId: string; date: Date; reason: string }[] = []
      const d = new Date(checkInDate)
      while (d < checkOutDate) {
        dates.push({ listingId, date: new Date(d), reason: 'BOOKED' })
        d.setDate(d.getDate() + 1)
      }
      if (dates.length > 0) {
        await db.blockedDate.createMany({ data: dates })
      }
    }

    return NextResponse.json({ booking }, { status: 201 })
  } catch (error) {
    console.error('Booking POST error:', error)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const guestId = searchParams.get('guestId')
    const hostId = searchParams.get('hostId')

    const where: Record<string, string> = {}
    if (guestId) where.guestId = guestId
    if (hostId) where.hostId = hostId

    const bookings = await db.booking.findMany({
      where,
      include: {
        listing: {
          select: { id: true, title: true, photos: true, city: true, neighbourhood: true }
        },
        guest: { select: { id: true, name: true, profilePhoto: true, trustScore: true, isVerified: true } },
        host: { select: { id: true, name: true, profilePhoto: true } },
        payments: true
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ bookings })
  } catch (error) {
    console.error('Bookings GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }
}

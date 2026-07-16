import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ── POST /api/payments — initiate a Paystack payment ──────────────────────
export async function POST(req: Request) {
  try {
    const { bookingId, method, momoNetwork, momoNumber, email, amount } = await req.json()

    if (!bookingId || !method || !amount) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { guest: true, listing: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.paymentStatus === 'PAID') return NextResponse.json({ error: 'Booking already paid' }, { status: 400 })

    // Check the booking is still in a payable state (not cancelled by a race condition)
    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'This booking has been cancelled. Please start a new booking with available dates.' },
        { status: 409 },
      )
    }

    const reference = `FIE-${bookingId}-${Date.now()}`

    const paystackPayload: Record<string, unknown> = {
      amount:       Math.round(amount * 100), // Paystack uses kobo/pesewas
      email:        email || booking.guest.email || 'guest@fiegh.com',
      reference,
      callback_url: `${process.env.NEXTAUTH_URL}/api/payments/verify`,
      metadata:     { bookingId, method, momoNetwork, momoNumber },
    }

    if (method === 'MOMO') {
      paystackPayload.channel      = 'mobile_money'
      paystackPayload.mobile_money = { phone: momoNumber, provider: momoNetwork?.toLowerCase() }
    }

    // Record payment attempt + stamp paymentReference on the booking in one transaction
    const [payment] = await db.$transaction([
      db.payment.create({
        data: {
          bookingId,
          amount,
          currency: 'USD',
          method,
          momoNetwork:      momoNetwork ?? null,
          momoNumber:       momoNumber  ?? null,
          status:           'PENDING',
          gatewayReference: reference,
        },
      }),
      db.booking.update({
        where: { id: bookingId },
        data:  { paymentReference: reference },
      }),
    ])

    // In production: call actual Paystack API here
    // const res  = await fetch('https://api.paystack.co/transaction/initialize', {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify(paystackPayload),
    // })
    // const { data } = await res.json()
    // const authorizationUrl = data.authorization_url

    const authorizationUrl = `https://checkout.paystack.com/demo?ref=${reference}`

    return NextResponse.json({
      payment,
      authorizationUrl,
      reference,
      message: 'Payment initiated. Complete payment on Paystack.',
    })
  } catch (error) {
    console.error('Payment POST error:', error)
    return NextResponse.json({ error: 'Failed to initiate payment' }, { status: 500 })
  }
}

// ── PUT /api/payments — Paystack webhook: confirm or cancel booking ────────
export async function PUT(req: Request) {
  try {
    const { reference, status } = await req.json()

    const payment = await db.payment.findFirst({
      where: { gatewayReference: reference },
      include: { booking: true },
    })

    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const succeeded = status === 'success'

    // On failure → CANCELLED so those dates free back up immediately
    const newBookingStatus      = succeeded ? 'CONFIRMED' : 'CANCELLED'
    const newPaymentStatus      = succeeded ? 'SUCCESS'   : 'FAILED'
    const newPaymentStatusOnBooking = succeeded ? 'PAID'  : 'UNPAID'

    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data:  { status: newPaymentStatus },
      }),
      db.booking.update({
        where: { id: payment.bookingId },
        data:  {
          status:        newBookingStatus,
          paymentStatus: newPaymentStatusOnBooking,
        },
      }),
    ])

    // If confirmed, stamp blocked dates so the availability endpoint reflects it
    if (succeeded) {
      const b = payment.booking
      const dates: { listingId: string; date: Date; reason: string }[] = []
      const d = new Date(b.checkIn)
      while (d < b.checkOut) {
        dates.push({ listingId: b.listingId, date: new Date(d), reason: 'BOOKED' })
        d.setDate(d.getDate() + 1)
      }
      if (dates.length > 0) {
        await db.blockedDate.createMany({ data: dates })
      }
    }

    return NextResponse.json({ success: true, bookingStatus: newBookingStatus })
  } catch (error) {
    console.error('Payment webhook error:', error)
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Paystack payment initiation
export async function POST(req: Request) {
  try {
    const { bookingId, method, momoNetwork, momoNumber, email, amount } = await req.json()

    if (!bookingId || !method || !amount) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { guest: true }
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.paymentStatus === 'PAID') return NextResponse.json({ error: 'Booking already paid' }, { status: 400 })

    // In production: call Paystack API here
    // For now, simulate payment initiation
    const paystackPayload: Record<string, unknown> = {
      amount: Math.round(amount * 100), // Paystack uses kobo/pesewas
      email: email || booking.guest.email || 'guest@fiegh.com',
      reference: `FIE-${bookingId}-${Date.now()}`,
      callback_url: `${process.env.NEXTAUTH_URL}/api/payments/verify`,
      metadata: { bookingId, method, momoNetwork, momoNumber }
    }

    if (method === 'MOMO') {
      paystackPayload.channel = 'mobile_money'
      paystackPayload.mobile_money = {
        phone: momoNumber,
        provider: momoNetwork?.toLowerCase()
      }
    }

    // Record payment attempt
    const payment = await db.payment.create({
      data: {
        bookingId,
        amount,
        currency: 'USD',
        method,
        momoNetwork: momoNetwork || null,
        momoNumber: momoNumber || null,
        status: 'PENDING',
        gatewayReference: paystackPayload.reference as string
      }
    })

    // In production: make actual Paystack API call
    // const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    //   method: 'POST',
    //   headers: {
    //     Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify(paystackPayload),
    // })
    // const paystackData = await paystackRes.json()

    // Simulated response for development
    const authorizationUrl = `https://checkout.paystack.com/demo?ref=${paystackPayload.reference}`

    return NextResponse.json({
      payment,
      authorizationUrl,
      reference: paystackPayload.reference,
      message: 'Payment initiated. Complete payment on Paystack.'
    })
  } catch (error) {
    console.error('Payment POST error:', error)
    return NextResponse.json({ error: 'Failed to initiate payment' }, { status: 500 })
  }
}

// Paystack webhook verification
export async function PUT(req: Request) {
  try {
    const { reference, status } = await req.json()

    const payment = await db.payment.findFirst({
      where: { gatewayReference: reference },
      include: { booking: true }
    })

    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const newPaymentStatus = status === 'success' ? 'SUCCESS' : 'FAILED'
    const newBookingStatus = status === 'success' ? 'CONFIRMED' : 'PENDING'
    const newPaymentStatusOnBooking = status === 'success' ? 'PAID' : 'UNPAID'

    await db.payment.update({
      where: { id: payment.id },
      data: { status: newPaymentStatus }
    })

    await db.booking.update({
      where: { id: payment.bookingId },
      data: {
        status: newBookingStatus,
        paymentStatus: newPaymentStatusOnBooking
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Payment verification error:', error)
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

/**
 * POST /api/payments — Initialize a real Paystack transaction.
 *
 * Body: { bookingId: string, method: "MOMO" | "CARD" }
 *
 * Flow:
 *  1. Require a valid session
 *  2. Load booking; must belong to the logged-in guest, unpaid, not cancelled
 *  3. Convert USD total → GHS pesewas
 *  4. Create Payment (PENDING) + stamp booking.paymentReference
 *  5. Call Paystack Initialize Transaction
 *  6. Return { authorizationUrl, reference }
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be logged in to pay.' }, { status: 401 })
    }

    const body = await req.json()
    const { bookingId, method } = body as { bookingId?: string; method?: string }

    if (!bookingId || !method) {
      return NextResponse.json({ error: 'Missing bookingId or method' }, { status: 400 })
    }
    if (method !== 'MOMO' && method !== 'CARD') {
      return NextResponse.json({ error: 'method must be MOMO or CARD' }, { status: 400 })
    }

    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
      return NextResponse.json(
        { error: 'Paystack is not configured. Set PAYSTACK_SECRET_KEY in .env.' },
        { status: 503 },
      )
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { guest: true, listing: true },
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }
    if (booking.guestId !== user.id) {
      return NextResponse.json({ error: 'You can only pay for your own bookings.' }, { status: 403 })
    }
    if (booking.paymentStatus === 'PAID') {
      return NextResponse.json({ error: 'Booking already paid' }, { status: 400 })
    }
    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'This booking has been cancelled. Please start a new booking with available dates.' },
        { status: 409 },
      )
    }

    // Prefer session email, then guest record email. Paystack requires a valid email.
    const email = user.email || booking.guest.email
    if (!email) {
      return NextResponse.json(
        { error: 'Your account needs an email address to complete payment. Please update your profile.' },
        { status: 400 },
      )
    }

    // Convert USD → GHS (Paystack Ghana settles in GHS / pesewas)
    const rateRow = await db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' } })
    const usdToGhs = rateRow?.usdToGhs ?? Number(process.env.INITIAL_USD_TO_GHS ?? 15.5)
    const amountGhs = booking.totalPrice * usdToGhs
    const amountPesewas = Math.round(amountGhs * 100)

    if (amountPesewas < 100) {
      return NextResponse.json({ error: 'Amount too small to charge via Paystack.' }, { status: 400 })
    }

    const reference = `FIE-${bookingId}-${Date.now()}`
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

    // Persist payment attempt + reference BEFORE calling Paystack so the webhook/verify
    // callback can find this booking even if the user closes the tab mid-checkout.
    const [payment] = await db.$transaction([
      db.payment.create({
        data: {
          bookingId,
          amount:           booking.totalPrice,
          currency:         'USD',
          method,
          status:           'PENDING',
          gatewayReference: reference,
        },
      }),
      db.booking.update({
        where: { id: bookingId },
        data:  { paymentReference: reference },
      }),
    ])

    const paystackPayload = {
      email,
      amount:       amountPesewas,
      currency:     'GHS',
      reference,
      callback_url: `${baseUrl}/api/payments/verify`,
      channels:     method === 'MOMO' ? ['mobile_money'] : ['card'],
      metadata: {
        bookingId,
        listingId:  booking.listingId,
        guestId:    user.id,
        method,
        amountUsd:  booking.totalPrice,
        usdToGhs,
      },
    }

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paystackPayload),
    })

    const paystackJson = await paystackRes.json() as {
      status: boolean
      message: string
      data?: { authorization_url: string; access_code: string; reference: string }
    }

    if (!paystackRes.ok || !paystackJson.status || !paystackJson.data?.authorization_url) {
      // Roll back the pending payment so the guest can retry cleanly
      await db.$transaction([
        db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } }),
        db.booking.update({ where: { id: bookingId }, data: { paymentReference: null } }),
      ])
      console.error('Paystack initialize failed:', paystackJson)
      return NextResponse.json(
        { error: paystackJson.message || 'Failed to initialize Paystack payment.' },
        { status: 502 },
      )
    }

    return NextResponse.json({
      payment:          { id: payment.id, status: payment.status },
      authorizationUrl: paystackJson.data.authorization_url,
      reference:        paystackJson.data.reference,
      amountGhs:        Number(amountGhs.toFixed(2)),
      message:          'Payment initialized. Redirect to Paystack to complete.',
    })
  } catch (error) {
    console.error('Payment POST error:', error)
    return NextResponse.json({ error: 'Failed to initiate payment' }, { status: 500 })
  }
}

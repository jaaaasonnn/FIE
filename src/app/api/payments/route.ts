import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

/**
 * GET /api/payments?guestId=…
 * Returns payment records for the logged-in guest (session must match guestId).
 */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const guestId = new URL(req.url).searchParams.get('guestId')
    if (!guestId) {
      return NextResponse.json({ error: 'guestId required' }, { status: 400 })
    }
    if (guestId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const payments = await db.payment.findMany({
      where: { booking: { guestId } },
      include: {
        booking: {
          select: {
            id: true,
            listing: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ payments })
  } catch (error) {
    console.error('Payments GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

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

    // Server-only diagnostics — never include the full key (or this log) in the response body.
    const secretEnvName = 'PAYSTACK_SECRET_KEY'
    const secret = process.env[secretEnvName]
    const keyPrefix = secret
      ? secret.slice(0, secret.indexOf('_', 3) + 1) || secret.slice(0, 8) // e.g. "sk_test_" / "pk_test_"
      : '(undefined)'
    console.log(
      `[Paystack] Initialize Transaction using env=${secretEnvName} keyPrefix=${keyPrefix}`,
    )
    if (secret?.startsWith('pk_')) {
      console.error(
        `[Paystack] WRONG KEY TYPE: ${secretEnvName} starts with pk_ (public key). ` +
          'Initialize Transaction requires the secret key (sk_test_ / sk_live_).',
      )
    }

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

    // Read as text first so we can log Paystack's exact raw body on failure
    const paystackRaw = await paystackRes.text()
    let paystackJson: {
      status: boolean
      message: string
      data?: { authorization_url: string; access_code: string; reference: string }
    }
    try {
      paystackJson = JSON.parse(paystackRaw)
    } catch {
      console.error('[Paystack] Initialize Transaction non-JSON response:', {
        httpStatus: paystackRes.status,
        rawBody:    paystackRaw,
      })
      await db.$transaction([
        db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } }),
        db.booking.update({ where: { id: bookingId }, data: { paymentReference: null } }),
      ])
      return NextResponse.json(
        { error: 'Unexpected response from Paystack.' },
        { status: 502 },
      )
    }

    if (!paystackRes.ok || !paystackJson.status || !paystackJson.data?.authorization_url) {
      // Server-only: full Paystack error object — never forwarded to the browser as-is
      console.error('[Paystack] Initialize Transaction failed — raw response body:', paystackRaw)
      console.error('[Paystack] Initialize Transaction failed — parsed object:', paystackJson)

      // Roll back the pending payment so the guest can retry cleanly
      await db.$transaction([
        db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } }),
        db.booking.update({ where: { id: bookingId }, data: { paymentReference: null } }),
      ])
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

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/payments/verify?reference=… — Paystack redirects the guest's
 * browser here after they complete (or cancel) checkout on Paystack's site.
 *
 * Flow:
 *  1. Look up the reference against Paystack (source of truth — never trust
 *     the query string alone, since it's just a redirect the user's browser made).
 *  2. Mark the Payment SUCCESS/FAILED and, on success, the Booking PAID.
 *  3. Send the guest back to the checkout page with a status flag so the
 *     UI can show the right screen.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const reference = url.searchParams.get('reference')
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

  if (!reference) {
    return NextResponse.redirect(`${baseUrl}/dashboard/guest`)
  }

  const payment = await db.payment.findFirst({
    where: { gatewayReference: reference },
    include: { booking: true },
  })

  if (!payment) {
    return NextResponse.redirect(`${baseUrl}/dashboard/guest`)
  }

  const redirectTo = `${baseUrl}/checkout/${payment.bookingId}`

  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
    return NextResponse.redirect(`${redirectTo}?payment=error`)
  }

  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    )
    const paystackJson: {
      status: boolean
      data?: { status: string }
    } = await paystackRes.json()

    const verified = paystackRes.ok && paystackJson.status && paystackJson.data?.status === 'success'

    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data: { status: verified ? 'SUCCESS' : 'FAILED' },
      }),
      ...(verified
        ? [
            db.booking.update({
              where: { id: payment.bookingId },
              data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
            }),
          ]
        : []),
    ])

    return NextResponse.redirect(`${redirectTo}?payment=${verified ? 'success' : 'failed'}`)
  } catch (error) {
    console.error('[Paystack] Verify Transaction error:', error)
    return NextResponse.redirect(`${redirectTo}?payment=error`)
  }
}

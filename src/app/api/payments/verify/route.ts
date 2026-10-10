import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchCharge, settlePayment, type SettleOutcome } from '@/lib/paymentSettle'

/** Where each outcome sends the guest: /checkout/[id]?payment=… */
const RETURN_FLAG: Record<SettleOutcome, string> = {
  confirmed: 'success',
  refunded: 'refunded',
  failed: 'failed',
  pending: 'pending',
  mismatch: 'error',
  duplicate: 'error',
  'unknown-reference': 'error',
}

/**
 * GET /api/payments/verify?reference=… — Paystack redirects the guest's
 * browser here after they complete (or cancel) checkout on Paystack's site.
 *
 * Flow:
 *  1. Look up the reference against Paystack (source of truth — never trust
 *     the query string alone, since it's just a redirect the user's browser made).
 *  2. Hand what Paystack says to settlePayment (lib/paymentSettle.ts), the
 *     one place a booking is marked paid. The charge.success webhook goes
 *     through the same function, so the two can arrive in either order.
 *  3. Send the guest back to the checkout page with a status flag so the
 *     UI can show the right screen.
 *
 * A payment still in progress (a mobile money prompt not yet approved) is
 * left as it is and the guest lands on ?payment=pending. If the booking was
 * cancelled, declined or expired while the guest was paying, it is not
 * revived: the whole amount is recorded as a refund owed, and the guest
 * lands on ?payment=refunded.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const reference = url.searchParams.get('reference')
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

  if (!reference) {
    return NextResponse.redirect(`${baseUrl}/dashboard/guest`)
  }

  const payment = await db.payment.findUnique({
    where: { gatewayReference: reference },
    select: { bookingId: true, instalment: { select: { id: true, sequence: true } } },
  })

  if (!payment) {
    return NextResponse.redirect(`${baseUrl}/dashboard/guest`)
  }

  // A rent payment after the first comes back to that instalment's own page
  const later = payment.instalment && payment.instalment.sequence > 1 ? payment.instalment.id : null
  const page = `${baseUrl}/checkout/${payment.bookingId}`
  const back = (flag: string) => `${page}?${later ? `instalment=${later}&` : ''}payment=${flag}`

  try {
    const lookup = await fetchCharge(reference)
    if (!lookup.ok) {
      console.error('[Paystack] Verify Transaction failed:', lookup.error)
      return NextResponse.redirect(back('error'))
    }
    const result = await settlePayment(lookup.charge)
    return NextResponse.redirect(back(RETURN_FLAG[result.outcome]))
  } catch (error) {
    console.error('[Paystack] Verify Transaction error:', error)
    return NextResponse.redirect(back('error'))
  }
}

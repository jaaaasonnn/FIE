import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { sendRefund } from '@/lib/refunds'

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
 *
 * If the booking was cancelled or declined while the guest was paying, the
 * payment is recorded but the booking is not revived: the whole amount is
 * recorded as a refund owed, and the guest lands on ?payment=refunded.
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

    // The booking as it stands now, not as it was when checkout opened: the
    // guest may have cancelled, or the host declined, while Paystack's page
    // was open.
    const current = await db.booking.findUnique({ where: { id: payment.bookingId }, select: { status: true } })
    const dead = current?.status === 'CANCELLED' || current?.status === 'DECLINED'

    if (verified && dead) {
      // Money arrived for a booking that no longer stands. It is not revived:
      // the payment is recorded and the whole amount is owed straight back.
      let refundId: string | null = null
      try {
        await db.$transaction(async (tx) => {
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESS' } })
          await tx.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus: 'PAID' } })
          const refund = await tx.refund.create({
            data: {
              bookingId: payment.bookingId,
              paymentId: payment.id,
              reason: 'LATE_PAYMENT',
              stayRefund: payment.booking.subtotal,
              serviceFeeRefund: payment.booking.serviceFee,
              depositRefund: payment.booking.damageDeposit,
              amount: payment.amount,
              amountPesewas: payment.amountPesewas,
            },
          })
          refundId = refund.id
        })
      } catch (error) {
        // A refund already on record for this booking (the unique index)
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
        await db.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESS' } })
        console.error('[Paystack] Payment succeeded for a cancelled booking that already has a refund:', payment.bookingId)
      }
      if (refundId) {
        try { await sendRefund(refundId) } catch (error) { console.error('[Paystack] sendRefund threw for refund', refundId, error) }
      }
      return NextResponse.redirect(`${redirectTo}?payment=refunded`)
    }

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

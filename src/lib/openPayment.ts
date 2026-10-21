// One open payment per booking, or per rent instalment. Pressing Pay again (a
// double click, a second tab, coming back after closing Paystack's page) must
// lead to the SAME Paystack payment, not start another one that could also be
// paid. This file is the one place a payment row is started.
//
// How two requests at the same instant are kept apart: the first thing the
// transaction does is write to the booking's row. Postgres gives that row to
// one transaction at a time, so the second request waits there and then finds
// the payment the first one made.

import type { Payment } from '@prisma/client'
import { db } from '@/lib/db'

/** How long an open payment is handed back before it is closed and a new one started. */
export const OPEN_PAYMENT_REUSE_MS = 6 * 60 * 60 * 1000
/** How long a second request waits for the first to finish asking Paystack for the page. */
export const OPEN_PAYMENT_WAIT_MS = 6000
const WAIT_STEP_MS = 150

export type NewPayment = {
  bookingId: string; instalmentId: string | null; amount: number; method: string
  gatewayReference: string; amountPesewas: number; usdToGhs: number
}
export type PaymentSlot = { kind: 'new'; payment: Payment } | { kind: 'open'; payment: Payment } | { kind: 'paid' }

/**
 * Gives back the payment already open for this booking or instalment, or
 * makes the new one. Or says it is paid: the booking was read as unpaid before
 * this, and a payment settled in the meantime must not lead to a second one
 * (G15). That is looked at here, after the booking's row is held, so a
 * settlement either finished before it (and is seen) or waits until after. `stampBooking` puts the reference on the booking (the
 * booking's own payment, not a later month's rent).
 */
export async function claimPaymentSlot(fresh: NewPayment, { stampBooking }: { stampBooking: boolean }): Promise<PaymentSlot> {
  return db.$transaction(async (tx): Promise<PaymentSlot> => {
    // The write that makes a second request for the same booking wait its turn
    const held = await tx.booking.update({ where: { id: fresh.bookingId }, data: { updatedAt: new Date() }, select: { paymentStatus: true } })
    if (stampBooking && held.paymentStatus !== 'UNPAID') return { kind: 'paid' }
    const paid = await tx.payment.findFirst({
      where: { bookingId: fresh.bookingId, instalmentId: fresh.instalmentId, status: 'SUCCESS' }, select: { id: true },
    })
    if (paid) return { kind: 'paid' }
    const open = await tx.payment.findFirst({
      where: { bookingId: fresh.bookingId, instalmentId: fresh.instalmentId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })
    if (open) return { kind: 'open', payment: open }
    const payment = await tx.payment.create({
      data: {
        bookingId: fresh.bookingId, instalmentId: fresh.instalmentId, amount: fresh.amount, currency: 'USD', method: fresh.method, status: 'PENDING',
        gatewayReference: fresh.gatewayReference,
        // Exactly what Paystack is asked to charge, and the rate used, so a
        // refund and the host's payout are worked out from the same cedis
        amountPesewas: fresh.amountPesewas, usdToGhs: fresh.usdToGhs,
      },
    })
    if (stampBooking) await tx.booking.update({ where: { id: fresh.bookingId }, data: { paymentReference: fresh.gatewayReference } })
    return { kind: 'new', payment }
  })
}

/** True when an open payment can simply be handed back: same way of paying, a page to send them to, and not too old. */
export function reusable(payment: Pick<Payment, 'authorizationUrl' | 'method' | 'createdAt'>, method: string, now: Date = new Date()): boolean {
  return !!payment.authorizationUrl && payment.method === method && now.getTime() - payment.createdAt.getTime() < OPEN_PAYMENT_REUSE_MS
}

/** Waits for the request that made this payment to store Paystack's page on it. Returns the row as it then stands. */
export async function awaitPage(payment: Payment): Promise<Payment | null> {
  let current: Payment | null = payment
  // A fixed number of looks, not a clock: it must end even where time stands still
  for (let look = 0; look < OPEN_PAYMENT_WAIT_MS / WAIT_STEP_MS && current && current.status === 'PENDING' && !current.authorizationUrl; look++) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS))
    current = await db.payment.findUnique({ where: { id: payment.id } })
  }
  return current
}

/** Closes an open payment that will not be handed back. Only if it is still open. */
export async function closeOpenPayment(id: string): Promise<void> {
  await db.payment.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'FAILED' } })
}

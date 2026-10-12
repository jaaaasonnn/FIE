// A safety net for money on a booking that is off. A cancelled or declined
// booking with a successful payment and no refund on record should never
// exist: cancelling records the refund it owes in the same transaction, and a
// payment that lands on a booking already cancelled records its own
// (LATE_PAYMENT, lib/paymentSettle.ts). If one is ever found anyway, whatever
// the cause, the guest is owed their money back and somebody must be told.
//
// The hourly refund job runs this first. It writes only when refunds are
// switched on and the run is not a dry run, like the rest of that job; the
// refund it records is then sent by the same run.
//
// One case is left alone on purpose: a guest who cancelled a paid stay so late
// that the policy returns nothing, with no deposit to return. That booking
// rightly has no refund on record.

import * as Sentry from '@sentry/nextjs'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { asPolicy, quoteRefund } from '@/lib/cancellationPolicy'
import { daysBetween, ghanaToday } from '@/lib/stayDates'
import { parseDay } from '@/lib/hostCalendar'

export type UnrefundedItem = { bookingId: string; paymentId: string; amount: number; action: 'recorded' | 'would-record' }

/** What the policy returned on the day the guest cancelled. Null when that cannot be worked out. */
function owedByPolicy(booking: {
  rentalMode: string; cancellationPolicy: string | null; cancelledAt: Date | null; checkIn: Date
  subtotal: number; serviceFee: number; damageDeposit: number; pricePerUnit: number
}, paid: number): number | null {
  if (!booking.cancelledAt) return null
  const day = parseDay(ghanaToday(booking.cancelledAt))
  if (!day) return null
  return quoteRefund({
    rentalMode: booking.rentalMode, policy: asPolicy(booking.cancellationPolicy), by: 'GUEST', daysBefore: daysBetween(day, booking.checkIn),
    subtotal: booking.subtotal, serviceFee: booking.serviceFee, damageDeposit: booking.damageDeposit, pricePerUnit: booking.pricePerUnit, paid,
  }).total
}

/**
 * Finds cancelled or declined bookings that hold a successful payment and
 * have no refund on record, and (in a live run) records the full refund for
 * each and raises an alert. One refund per booking is the database's own rule
 * (unique index on Refund.bookingId), so this can never record a second one.
 */
export async function recordUnrefundedPayments({ live }: { live: boolean }): Promise<UnrefundedItem[]> {
  const found = await db.booking.findMany({
    where: { status: { in: ['CANCELLED', 'DECLINED'] }, refund: { is: null }, payments: { some: { status: 'SUCCESS' } } },
    select: {
      id: true, status: true, cancelledBy: true, cancelledAt: true, rentalMode: true, cancellationPolicy: true, checkIn: true,
      subtotal: true, serviceFee: true, damageDeposit: true, pricePerUnit: true,
      payments: { where: { status: 'SUCCESS' }, orderBy: { createdAt: 'asc' }, select: { id: true, amount: true, amountPesewas: true, instalmentId: true } },
    },
  })

  const items: UnrefundedItem[] = []
  for (const booking of found) {
    const payment = booking.payments[0]
    // A guest's own late cancellation under a policy that returns nothing: no refund is owed
    if (booking.status === 'CANCELLED' && booking.cancelledBy === 'GUEST' && owedByPolicy(booking, payment.amount) === 0) continue

    if (!live) {
      items.push({ bookingId: booking.id, paymentId: payment.id, amount: payment.amount, action: 'would-record' })
      continue
    }
    try {
      // Only if it is still cancelled, still paid for and still has no refund
      await db.$transaction(async (tx) => {
        const still = await tx.booking.count({ where: { id: booking.id, status: { in: ['CANCELLED', 'DECLINED'] }, refund: { is: null } } })
        if (still === 0) throw new Prisma.PrismaClientKnownRequestError('already handled', { code: 'P2002', clientVersion: 'unrefunded' })
        await tx.refund.create({
          data: {
            bookingId: booking.id, paymentId: payment.id, reason: 'LATE_PAYMENT',
            stayRefund: payment.instalmentId ? Math.max(0, payment.amount - booking.damageDeposit) : booking.subtotal,
            serviceFeeRefund: payment.instalmentId ? 0 : booking.serviceFee,
            depositRefund: booking.damageDeposit,
            amount: payment.amount, amountPesewas: payment.amountPesewas,
          },
        })
      })
    } catch (error) {
      // Another run, or the payment's own settlement, recorded it first
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
      throw error
    }
    items.push({ bookingId: booking.id, paymentId: payment.id, amount: payment.amount, action: 'recorded' })
    console.error('[Refunds] a cancelled booking held a payment with no refund on record: the full refund has been recorded', { bookingId: booking.id, paymentId: payment.id })
    Sentry.captureMessage('A cancelled booking held a payment with no refund on record: the full refund has been recorded', {
      level: 'error',
      tags: { area: 'refunds', refund_issue: 'UNREFUNDED_PAYMENT' },
      fingerprint: ['refund', 'UNREFUNDED_PAYMENT', booking.id],
      // IDs and amounts only
      contexts: { refund: { bookingId: booking.id, paymentId: payment.id, bookingStatus: booking.status, cancelledBy: booking.cancelledBy, amount: payment.amount, extraPayments: booking.payments.length - 1 } },
    })
  }
  return items
}

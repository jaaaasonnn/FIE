// The one place a payment is settled: a booking is marked paid here and
// nowhere else. Three callers hand it what Paystack says about a charge:
//   - the verify route, when the guest's browser comes back from Paystack;
//   - the charge.success webhook, which arrives whether or not it does;
//   - the expiry job, which asks Paystack before it releases unpaid dates.
// They can arrive in any order, or twice, and the result is the same.
//
// A rent instalment (lib/rentRules.ts) is settled here too, and nowhere else.
// The first instalment of a booking is the payment that confirms it, so it
// follows the booking's rules and marks the instalment paid in the same step.
// A later one marks only its instalment paid: the booking is already confirmed.

import * as Sentry from '@sentry/nextjs'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { paymentWebhookEnabled } from '@/lib/payoutSwitches'
import { sendRefund } from '@/lib/refunds'
import { notify } from '@/lib/messaging/notify'
import { OPEN_INSTALMENT_STATUSES, isSettled, tenancyStands } from '@/lib/rentRules'

const PAYSTACK_BASE = 'https://api.paystack.co'

/** What Paystack says about one charge, from a verify call or a signed webhook. */
export type PaystackCharge = { reference: string; status: unknown; amount: unknown; currency: unknown }

export type SettleOutcome =
  | 'confirmed'          // the booking, or the rent instalment, is paid
  | 'refunded'           // paid, but the booking no longer stands: the whole amount is owed back
  | 'failed'             // Paystack says the payment did not go through
  | 'pending'            // Paystack has not finished with it yet
  | 'mismatch'           // paid, but not the amount or currency we asked for
  | 'duplicate'          // paid, on a booking or an instalment another payment had already paid
  | 'unknown-reference'  // no payment of ours carries this reference

export type SettleResult = {
  outcome: SettleOutcome
  /** True when this call changed something; false for a repeat, a dry run or nothing to do */
  changed: boolean
  dryRun: boolean
  paymentId?: string
  bookingId?: string
  refundId?: string
}

type Action = 'none' | 'fail' | 'mismatch' | 'duplicate' | 'confirm' | 'instalment' | 'refund'

/** Statuses a payment can still move on from. Success always wins over failed. */
const OPEN = ['PENDING', 'FAILED']

async function load(reference: string) {
  return db.payment.findUnique({
    where: { gatewayReference: reference },
    include: {
      booking: { include: { refund: { select: { paymentId: true, reason: true } } } },
      instalment: { select: { id: true, sequence: true, status: true } },
    },
  })
}
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>

/** Where a payment that is already settled ended up. */
function settledOutcome(payment: Loaded): SettleOutcome {
  if (payment.status === 'SUCCESS') {
    const refund = payment.booking.refund
    return refund?.paymentId === payment.id && refund.reason === 'LATE_PAYMENT' ? 'refunded' : 'confirmed'
  }
  if (payment.status === 'REFUNDED') return 'refunded'
  if (payment.status === 'MISMATCH') return 'mismatch'
  if (payment.status === 'DUPLICATE') return 'duplicate'
  if (payment.status === 'FAILED') return 'failed'
  return 'pending'
}

/**
 * What to do with a charge, from the stored payment and booking alone.
 * Nothing in here writes, so a dry run and a real run decide identically.
 */
export function decideSettlement(payment: Loaded, charge: PaystackCharge): { action: Action; outcome: SettleOutcome } {
  if (!OPEN.includes(payment.status)) return { action: 'none', outcome: settledOutcome(payment) }

  if (charge.status !== 'success') {
    // Only a clear "no" is recorded. Anything still in progress (a mobile
    // money prompt waiting to be approved) leaves the payment as it is.
    if (charge.status !== 'failed' && charge.status !== 'abandoned') return { action: 'none', outcome: settledOutcome(payment) }
    return payment.status === 'PENDING' ? { action: 'fail', outcome: 'failed' } : { action: 'none', outcome: 'failed' }
  }

  // The money must be exactly what we asked Paystack to charge
  const expected = payment.amountPesewas
  if (charge.currency !== 'GHS' || !Number.isInteger(expected) || Number(charge.amount) !== expected) {
    return { action: 'mismatch', outcome: 'mismatch' }
  }
  // Rent after the first payment: the booking is already paid and confirmed,
  // so this settles the instalment alone
  const instalment = payment.instalment
  if (instalment && instalment.sequence > 1) {
    // Another payment, or the deposit, has already settled it
    if (isSettled(instalment)) return { action: 'duplicate', outcome: 'duplicate' }
    if (OPEN_INSTALMENT_STATUSES.includes(instalment.status) && tenancyStands(payment.booking)) {
      return { action: 'instalment', outcome: 'confirmed' }
    }
    // The tenancy was cancelled or ended, so this month is no longer owed:
    // the whole amount goes back
    return { action: 'refund', outcome: 'refunded' }
  }
  // Another payment has already paid for this booking
  if (payment.booking.paymentStatus !== 'UNPAID') return { action: 'duplicate', outcome: 'duplicate' }
  if (payment.booking.status === 'CONFIRMED') return { action: 'confirm', outcome: 'confirmed' }
  // Cancelled, declined, expired, or a request the host has not accepted:
  // the booking is not revived and the whole amount goes back
  return { action: 'refund', outcome: 'refunded' }
}

class Raced extends Error {}

function alert(issue: 'MISMATCH' | 'DUPLICATE' | 'PAID_PENDING_REQUEST', message: string, payment: Loaded, charge: PaystackCharge) {
  console.error(`[Payments] ${message}`, { paymentId: payment.id, bookingId: payment.bookingId })
  Sentry.captureMessage(message, {
    level: 'error',
    tags: { area: 'payments', payment_issue: issue },
    fingerprint: ['payment', issue, payment.id],
    // IDs and amounts only: nothing that identifies a card or a phone
    contexts: {
      payment: {
        paymentId: payment.id, bookingId: payment.bookingId, bookingStatus: payment.booking.status,
        expectedPesewas: payment.amountPesewas, paidPesewas: Number(charge.amount) || null,
        currency: typeof charge.currency === 'string' ? charge.currency : null,
      },
    },
  })
}

/**
 * Settles one charge. Safe to call again, and from two places at once: every
 * write is conditional on the row still being as it was read, and whoever
 * loses that race reads the result from the database instead.
 *
 * With `dryRun` it reports what it would do and writes nothing.
 */
export async function settlePayment(charge: PaystackCharge, { dryRun = false }: { dryRun?: boolean } = {}): Promise<SettleResult> {
  // A lost race is read again; three rounds is more than two callers can need
  for (let round = 0; round < 3; round++) {
    const payment = await load(charge.reference)
    if (!payment) return { outcome: 'unknown-reference', changed: false, dryRun }

    const ids = { paymentId: payment.id, bookingId: payment.bookingId }
    const { action, outcome } = decideSettlement(payment, charge)
    if (action === 'none' || dryRun) return { outcome, changed: false, dryRun, ...ids }

    if (action === 'fail') {
      const done = await db.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
      if (done.count === 0) continue
      notify('payment.failed', ids)
      return { outcome, changed: true, dryRun, ...ids }
    }

    if (action === 'mismatch' || action === 'duplicate') {
      const status = action === 'mismatch' ? 'MISMATCH' : 'DUPLICATE'
      const done = await db.payment.updateMany({ where: { id: payment.id, status: { in: OPEN } }, data: { status } })
      if (done.count === 0) continue
      if (action === 'mismatch') alert('MISMATCH', 'A payment arrived that does not match the amount or currency we asked for', payment, charge)
      else alert('DUPLICATE', 'A second payment arrived for a booking that is already paid: refund it by hand', payment, charge)
      return { outcome, changed: true, dryRun, ...ids }
    }

    const instalment = payment.instalment
    const later = !!instalment && instalment.sequence > 1
    const paidAt = new Date()
    let refundId: string | undefined
    try {
      await db.$transaction(async (tx) => {
        // Only the caller that claims the payment goes on to touch the booking
        const claim = await tx.payment.updateMany({ where: { id: payment.id, status: { in: OPEN } }, data: { status: 'SUCCESS' } })
        if (claim.count === 0) throw new Raced()

        if (later) {
          // The booking stays as it is. The tenancy must still stand as it
          // was read, and the instalment must still be owed.
          const standing = await tx.booking.count({
            where: { id: payment.bookingId, status: payment.booking.status, paymentStatus: payment.booking.paymentStatus },
          })
          if (standing === 0) throw new Raced()
          if (action === 'instalment') {
            const settled = await tx.instalment.updateMany({
              where: { id: instalment.id, status: { in: OPEN_INSTALMENT_STATUSES } },
              data: { status: 'PAID', paidAt },
            })
            if (settled.count === 0) throw new Raced()
          }
        } else {
          // The booking must still be exactly as it was read: not cancelled,
          // accepted, expired or paid by another payment in the meantime
          const booking = await tx.booking.updateMany({
            where: { id: payment.bookingId, status: payment.booking.status, paymentStatus: 'UNPAID' },
            data: { paymentStatus: 'PAID' },
          })
          if (booking.count === 0) throw new Raced()

          // The first instalment is paid by the payment that confirms the booking
          if (action === 'confirm' && instalment) {
            const settled = await tx.instalment.updateMany({
              where: { id: instalment.id, status: 'PENDING' },
              data: { status: 'PAID', paidAt },
            })
            if (settled.count === 0) throw new Raced()
          }
        }

        if (action === 'refund') {
          const refund = await tx.refund.create({
            data: {
              bookingId: payment.bookingId,
              paymentId: payment.id,
              reason: 'LATE_PAYMENT',
              // An instalment's payment carries only its own rent, and its
              // deposit if it is the first: never the whole tenancy's rent
              stayRefund: instalment ? Math.max(0, payment.amount - (later ? 0 : payment.booking.damageDeposit)) : payment.booking.subtotal,
              serviceFeeRefund: instalment ? 0 : payment.booking.serviceFee,
              depositRefund: later ? 0 : payment.booking.damageDeposit,
              amount: payment.amount,
              amountPesewas: payment.amountPesewas,
            },
          })
          refundId = refund.id
        }
      })
    } catch (error) {
      if (error instanceof Raced) continue
      // A refund already on record for this booking (one per booking): this
      // payment cannot have its own, so a person has to send it back
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const done = await db.payment.updateMany({ where: { id: payment.id, status: { in: OPEN } }, data: { status: 'DUPLICATE' } })
        if (done.count === 0) continue
        alert('DUPLICATE', 'A second payment arrived for a booking that already has a refund: refund it by hand', payment, charge)
        return { outcome: 'duplicate', changed: true, dryRun, ...ids }
      }
      throw error
    }

    if (action === 'refund' && payment.booking.status === 'PENDING') {
      alert('PAID_PENDING_REQUEST', 'A payment arrived for a request the host has not accepted: it is being refunded in full', payment, charge)
    }
    // The refund is on record. Sending it does nothing while refunds are
    // switched off, and a failure is picked up by the hourly refund job.
    if (refundId) {
      try {
        await sendRefund(refundId)
      } catch (error) {
        console.error('[Payments] sendRefund threw for refund', refundId, error)
      }
    }
    if (action === 'instalment') notify('rent.paid', { instalmentId: instalment!.id })
    else notify(action === 'confirm' ? 'booking.confirmed' : 'payment.late_refund', { bookingId: payment.bookingId })
    return { outcome, changed: true, dryRun, ...ids, ...(refundId ? { refundId } : {}) }
  }
  throw new Error(`Payment ${charge.reference} could not be settled: it kept changing underneath`)
}

// ── Asking Paystack ────────────────────────────────────────────────────────

export type ChargeLookup = { ok: true; charge: PaystackCharge } | { ok: false; error: string }

/**
 * Asks Paystack what became of a transaction. Read-only. A reference Paystack
 * has never heard of (the guest never reached its page) counts as abandoned.
 */
export async function fetchCharge(reference: string): Promise<ChargeLookup> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) return { ok: false, error: 'Paystack is not configured' }
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    let json: { status?: boolean; message?: string; data?: { status?: unknown; amount?: unknown; currency?: unknown } } | null = null
    try { json = await res.json() } catch { /* handled below */ }

    if ((res.status === 404 || res.status === 400) && /not found/i.test(json?.message ?? '')) {
      return { ok: true, charge: { reference, status: 'abandoned', amount: null, currency: null } }
    }
    if (!res.ok || !json?.status || !json.data) return { ok: false, error: `Paystack returned HTTP ${res.status}` }
    return { ok: true, charge: { reference, status: json.data.status, amount: json.data.amount, currency: json.data.currency } }
  } catch (error) {
    return { ok: false, error: `Network error calling Paystack: ${error instanceof Error ? error.message : 'unknown'}` }
  }
}

// ── Webhook ────────────────────────────────────────────────────────────────

/**
 * Handles Paystack's charge.success webhook. The signature is checked by the
 * route before this runs, so the payload is Paystack's own word.
 *
 * Until PAYMENT_WEBHOOK_ENABLED is set it is a dry run: the event is read and
 * what it would do is logged, but nothing is written.
 */
export async function handleChargeSuccess(data: Record<string, unknown>): Promise<SettleResult | null> {
  const reference = typeof data.reference === 'string' ? data.reference : undefined
  if (!reference) {
    console.warn('[Paystack webhook] charge.success with no reference, ignoring')
    return null
  }
  const dryRun = !paymentWebhookEnabled()
  const result = await settlePayment({ reference, status: data.status, amount: data.amount, currency: data.currency }, { dryRun })
  if (dryRun) {
    console.info('[Paystack webhook] charge.success dry run (PAYMENT_WEBHOOK_ENABLED is not set to true): would end as', result.outcome, {
      paymentId: result.paymentId, bookingId: result.bookingId,
    })
  } else if (result.outcome === 'unknown-reference') {
    console.warn('[Paystack webhook] no matching Payment row for charge.success')
  }
  return result
}

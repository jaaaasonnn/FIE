// Sending refunds to Paystack and keeping our record of them straight.
//
// A Refund row is written the moment a booking is cancelled (see the cancel
// route), whether or not refunds are switched on. This file is the only place
// that asks Paystack to move the money, and it does nothing unless
// REFUNDS_ENABLED is exactly "true" (lib/payoutSwitches.ts).

import * as Sentry from '@sentry/nextjs'
import type { Refund } from '@prisma/client'
import { db } from '@/lib/db'
import { refundsEnabled } from '@/lib/payoutSwitches'
import { notify } from '@/lib/messaging/notify'

const PAYSTACK_BASE = 'https://api.paystack.co'

/** Automatic retries after the first attempt. */
export const MAX_REFUND_RETRIES = 3
/** Minimum gap between a failure and its retry. */
export const REFUND_RETRY_DELAY_MS = 30 * 60 * 1000
/** A refund claimed for sending this long ago with no answer recorded is a run that died. */
export const STALE_REFUND_CLAIM_MS = 15 * 60 * 1000

function getSecret(): string {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
    throw new Error('Paystack is not configured')
  }
  return secret
}

/** The note we attach to every refund, and look for before sending one again. */
const merchantNote = (refundId: string) => `FieGH refund ${refundId}`

type PaystackRefund = {
  id?: number | string
  status?: string
  amount?: number
  merchant_note?: string
  transaction_reference?: string
  transaction?: { reference?: string } | number | string
}

/** Paystack's refund status as ours. Anything unfamiliar counts as still in progress. */
export function mapRefundStatus(status: string | undefined): 'PROCESSING' | 'PROCESSED' | 'FAILED' {
  if (status === 'processed') return 'PROCESSED'
  if (status === 'failed') return 'FAILED'
  return 'PROCESSING'
}

export type RefundFailureKind = 'TRANSIENT' | 'PERMANENT'

/** Worth another automatic try, or does it need a person? Unknown means a person. */
export function classifyRefundFailure(reason: string | null | undefined): RefundFailureKind {
  if (!reason) return 'PERMANENT'
  if (/^Network error calling Paystack/.test(reason)) return 'TRANSIENT'
  if (/^Paystack returned HTTP (5\d\d|429)\b/.test(reason)) return 'TRANSIENT'
  if (/^Could not check Paystack for an existing refund/.test(reason)) return 'TRANSIENT'
  if (/balance/i.test(reason)) return 'TRANSIENT' // our Paystack balance: fixed by topping up
  return 'PERMANENT'
}

/** The single place a refund is marked FAILED. Alerts when it will not be retried. */
export async function recordRefundFailure(refundId: string, reason: string): Promise<Refund> {
  const now = new Date()
  const failed = await db.refund.update({
    where: { id: refundId },
    data: { status: 'FAILED', failureReason: reason, lastFailedAt: now },
  })
  const kind = classifyRefundFailure(reason)
  if (kind === 'TRANSIENT' && failed.retryCount < MAX_REFUND_RETRIES) return failed

  alertRefund(failed, kind === 'PERMANENT' ? 'permanent failure, not retried' : `still failing after ${failed.retryCount} automatic retries`)
  notify('refund.needs_attention', { refundId })
  return db.refund.update({ where: { id: refundId }, data: { alertedAt: now } })
}

function alertRefund(refund: Refund, summary: string) {
  console.error(`[Refunds] Refund ${refund.id} needs attention (${summary}):`, refund.failureReason)
  Sentry.captureException(new Error(`Guest refund needs attention: ${summary}: ${refund.failureReason}`), {
    level: 'error',
    tags: { area: 'refunds' },
    // IDs and amounts only: nothing that identifies a card or a phone
    contexts: {
      refund: {
        refundId: refund.id, bookingId: refund.bookingId, paymentId: refund.paymentId,
        amount: refund.amount, currency: refund.currency, reason: refund.reason,
        failureReason: refund.failureReason, retryCount: refund.retryCount,
      },
    },
  })
}

export type SendRefundResult = {
  refund: Refund
  /** True only when this call asked Paystack to create a refund */
  sent: boolean
  /** Why nothing was sent, when nothing was */
  skipped?: string
  error?: string
}

/**
 * Asks Paystack to refund one recorded Refund. Safe to call again and from
 * two places at once:
 *  - it does nothing while refunds are off, or once the refund has left PENDING;
 *  - only the caller that claims the row goes on to call Paystack;
 *  - when an earlier attempt may have got through (a retry, or a run that
 *    died after claiming), it first asks Paystack which refunds already exist
 *    for the payment and adopts a match instead of sending a second one.
 */
export async function sendRefund(refundId: string): Promise<SendRefundResult> {
  const refund = await db.refund.findUnique({ where: { id: refundId }, include: { payment: true } })
  if (!refund) throw new Error(`Refund ${refundId} not found`)

  if (!refundsEnabled()) return { refund, sent: false, skipped: 'REFUNDS_ENABLED is not set to true' }
  if (refund.status !== 'PENDING') return { refund, sent: false, skipped: `already ${refund.status}` }

  const full = refund.amount >= refund.payment.amount
  // A part refund needs the cedi amount, which only payments made since the
  // amount was stored have. Without it a person has to work it out.
  if (!full && !refund.amountPesewas) {
    const stuck = await db.refund.update({
      where: { id: refund.id },
      data: { status: 'NEEDS_ATTENTION', failureReason: 'The payment has no stored cedi amount, so a part refund cannot be worked out', alertedAt: new Date() },
    })
    alertRefund(stuck, 'cannot be sent automatically')
    notify('refund.needs_attention', { refundId: refund.id })
    return { refund: stuck, sent: false, skipped: 'needs attention' }
  }
  if (!refund.payment.gatewayReference) {
    const failed = await recordRefundFailure(refund.id, 'The payment has no Paystack reference')
    return { refund: failed, sent: false, error: failed.failureReason ?? undefined }
  }

  // Claim before any network call
  const now = new Date()
  const mayHaveBeenSent = refund.initiatedAt !== null || refund.retryCount > 0
  const claim = await db.refund.updateMany({
    where: {
      id: refund.id,
      status: 'PENDING',
      OR: [{ initiatedAt: null }, { initiatedAt: { lte: new Date(now.getTime() - STALE_REFUND_CLAIM_MS) } }],
    },
    data: { initiatedAt: now },
  })
  if (claim.count === 0) return { refund, sent: false, skipped: 'another run is sending it' }

  let secret: string
  try {
    secret = getSecret()
  } catch (error) {
    const failed = await recordRefundFailure(refund.id, error instanceof Error ? error.message : 'Paystack is not configured')
    return { refund: failed, sent: false, error: failed.failureReason ?? undefined }
  }
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
  const reference = refund.payment.gatewayReference

  try {
    if (mayHaveBeenSent) {
      const existing = await findExistingRefund(reference, refund.id, headers)
      if (existing === 'unknown') {
        const failed = await recordRefundFailure(refund.id, 'Could not check Paystack for an existing refund')
        return { refund: failed, sent: false, error: failed.failureReason ?? undefined }
      }
      if (existing) {
        const adopted = await applyPaystackStatus(refund.id, existing)
        return { refund: adopted, sent: false, skipped: 'Paystack already has this refund' }
      }
    }

    const res = await fetch(`${PAYSTACK_BASE}/refund`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        transaction: reference,
        // Leaving the amount out refunds the whole payment, to the pesewa
        ...(full ? {} : { amount: refund.amountPesewas }),
        currency: 'GHS',
        merchant_note: merchantNote(refund.id),
        customer_note: 'Refund for your cancelled FieGH booking',
      }),
    })
    const raw = await res.text()
    let json: { status?: boolean; message?: string; data?: PaystackRefund } | null = null
    try { json = JSON.parse(raw) } catch { /* handled below */ }

    if (!res.ok || !json?.status || !json.data) {
      console.error('[Refunds] Paystack refund failed:', { httpStatus: res.status, raw })
      const failed = await recordRefundFailure(refund.id, `Paystack returned HTTP ${res.status}${json?.message ? `: ${json.message}` : ''}`)
      return { refund: failed, sent: true, error: json?.message || 'Failed to create the refund' }
    }
    const updated = await applyPaystackStatus(refund.id, json.data)
    return { refund: updated, sent: true }
  } catch (error) {
    console.error('[Refunds] Network error:', error)
    const failed = await recordRefundFailure(refund.id, `Network error calling Paystack: ${error instanceof Error ? error.message : 'unknown'}`)
    return { refund: failed, sent: true, error: 'Network error calling Paystack' }
  }
}

/**
 * Looks for a refund Paystack already holds for this payment that carries our
 * note. Returns it, null when there is none, or 'unknown' when Paystack could
 * not be asked (in which case nothing must be sent).
 */
async function findExistingRefund(reference: string, refundId: string, headers: Record<string, string>): Promise<PaystackRefund | null | 'unknown'> {
  const res = await fetch(`${PAYSTACK_BASE}/refund?reference=${encodeURIComponent(reference)}&perPage=100`, { headers })
  let json: { status?: boolean; data?: PaystackRefund[] } | null = null
  try { json = await res.json() } catch { /* handled below */ }
  if (!res.ok || !json?.status || !Array.isArray(json.data)) return 'unknown'

  // Matched here as well as by the query, in case the filter is ignored
  const refOf = (r: PaystackRefund) =>
    r.transaction_reference ?? (typeof r.transaction === 'object' && r.transaction ? r.transaction.reference : undefined)
  return json.data.find((r) => r.merchant_note === merchantNote(refundId) && (refOf(r) === undefined || refOf(r) === reference)) ?? null
}

/** Writes what Paystack says about a refund onto our row, and onto the booking once it has landed. */
async function applyPaystackStatus(refundId: string, data: PaystackRefund): Promise<Refund> {
  const status = mapRefundStatus(data.status)
  if (status === 'FAILED') {
    if (data.id !== undefined) await db.refund.update({ where: { id: refundId }, data: { paystackRefundId: String(data.id) } })
    return recordRefundFailure(refundId, 'Paystack could not complete the refund')
  }
  const updated = await db.refund.update({
    where: { id: refundId },
    data: {
      status,
      failureReason: null,
      ...(data.id !== undefined ? { paystackRefundId: String(data.id) } : {}),
      ...(status === 'PROCESSED' ? { processedAt: new Date() } : {}),
    },
    include: { payment: { select: { amount: true } } },
  })
  notify(status === 'PROCESSED' ? 'refund.arrived' : 'refund.sent', { refundId })
  if (status === 'PROCESSED') {
    await db.booking.update({
      where: { id: updated.bookingId },
      data: { paymentStatus: updated.amount >= updated.payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    })
  }
  return updated
}

// ── Webhook ────────────────────────────────────────────────────────────────

export type RefundEvent = 'refund.pending' | 'refund.processing' | 'refund.processed' | 'refund.failed'
export const REFUND_EVENTS: RefundEvent[] = ['refund.pending', 'refund.processing', 'refund.processed', 'refund.failed']

/** Handles Paystack's refund webhooks. The signature is checked by the route before this runs. */
export async function handleRefundEvent(eventType: RefundEvent, data: Record<string, unknown>): Promise<void> {
  const paystackId = data.id !== undefined && data.id !== null ? String(data.id) : undefined
  const reference = typeof data.transaction_reference === 'string' ? data.transaction_reference : undefined

  let refund = paystackId ? await db.refund.findFirst({ where: { paystackRefundId: paystackId } }) : null
  if (!refund && reference) {
    // One refund per booking, so the payment's reference finds it
    refund = await db.refund.findFirst({ where: { payment: { gatewayReference: reference } } })
  }
  if (!refund) {
    console.warn('[Paystack webhook] no matching Refund row for refund event', { paystackId, reference })
    return
  }
  // A refund that has landed stays landed, whatever arrives late or twice;
  // and a failure already recorded is not counted again.
  if (refund.status === 'PROCESSED') return
  if (eventType === 'refund.failed' && refund.status === 'FAILED') return

  const status = eventType === 'refund.processed' ? 'processed' : eventType === 'refund.failed' ? 'failed' : 'processing'
  await applyPaystackStatus(refund.id, { id: paystackId, status })
}

// ── Hourly job ─────────────────────────────────────────────────────────────

export type RefundRunItem = { refundId: string; bookingId: string; amount: number; action: 'sent' | 'adopted' | 'failed' | 'skipped' | 'would-send'; status: string; error?: string }
export type RefundRun =
  | { mode: 'live'; checked: number; results: RefundRunItem[] }
  | { mode: 'dry-run'; reason: string; checked: number; results: RefundRunItem[] }

/**
 * Sends refunds that are owed and not yet with Paystack: ones recorded while
 * refunds were off, ones a run died on, and failed ones due another try.
 */
export async function runRefunds({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<RefundRun> {
  const live = refundsEnabled() && !dryRun
  const stale = new Date(now.getTime() - STALE_REFUND_CLAIM_MS)

  const waiting = await db.refund.findMany({
    where: { status: 'PENDING', OR: [{ initiatedAt: null }, { initiatedAt: { lte: stale } }] },
  })
  const retryable = (await db.refund.findMany({
    where: {
      status: 'FAILED',
      alertedAt: null,
      retryCount: { lt: MAX_REFUND_RETRIES },
      lastFailedAt: { lte: new Date(now.getTime() - REFUND_RETRY_DELAY_MS) },
    },
  })).filter((r) => classifyRefundFailure(r.failureReason) === 'TRANSIENT')

  const results: RefundRunItem[] = []
  const item = (r: Refund, action: RefundRunItem['action'], error?: string): RefundRunItem =>
    ({ refundId: r.id, bookingId: r.bookingId, amount: r.amount, action, status: r.status, ...(error ? { error } : {}) })

  for (const refund of [...waiting, ...retryable]) {
    if (!live) {
      results.push(item(refund, 'would-send'))
      continue
    }
    if (refund.status === 'FAILED') {
      // Put it back in line; only the run whose update matches retries it
      const claimed = await db.refund.updateMany({
        where: { id: refund.id, status: 'FAILED', retryCount: refund.retryCount },
        data: { status: 'PENDING', retryCount: { increment: 1 }, failureReason: null, initiatedAt: null },
      })
      if (claimed.count === 0) continue
    }
    try {
      const sent = await sendRefund(refund.id)
      const action = sent.error ? 'failed' : sent.sent ? 'sent' : sent.skipped === 'Paystack already has this refund' ? 'adopted' : 'skipped'
      results.push(item(sent.refund, action, sent.error ?? (action === 'skipped' ? sent.skipped : undefined)))
    } catch (error) {
      console.error('[Refund cron] sendRefund threw for refund', refund.id, error)
      results.push(item(refund, 'failed', error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const checked = waiting.length + retryable.length
  return live
    ? { mode: 'live', checked, results }
    : { mode: 'dry-run', reason: refundsEnabled() ? 'dryRun was requested' : 'REFUNDS_ENABLED is not set to true', checked, results }
}

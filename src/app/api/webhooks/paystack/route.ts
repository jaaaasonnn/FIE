import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { recordPayoutFailure } from '@/lib/payouts'

/**
 * POST /api/webhooks/paystack
 *
 * Handles transfer.success / transfer.failed / transfer.reversed (host payouts). Payment
 * confirmation still goes through the browser-redirect flow in
 * /api/payments/verify — this endpoint is new and specific to transfers,
 * which have no browser redirect to hang verification off of.
 *
 * Signature verification: Paystack signs the raw request body with our
 * secret key (HMAC-SHA512) and sends the result in the x-paystack-signature
 * header. We recompute it over the raw bytes — not a re-serialized version
 * of the parsed JSON, which could byte-for-byte differ — and reject
 * anything that doesn't match with a constant-time comparison.
 */
export async function POST(req: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
    return NextResponse.json({ error: 'Paystack is not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature')

  const expectedSignature = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')
  if (!signature || !safeCompare(signature, expectedSignature)) {
    console.warn('[Paystack webhook] signature verification failed — rejecting')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { event?: string; data?: Record<string, unknown> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (event.event === 'transfer.success' || event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    await handleTransferEvent(event.event, event.data ?? {})
  }
  // Any other (recognized-signature) event type is intentionally a no-op —
  // still 200, since a non-2xx makes Paystack retry, and there's nothing
  // to retry for an event type we don't act on.

  return NextResponse.json({ received: true })
}

type TransferEvent = 'transfer.success' | 'transfer.failed' | 'transfer.reversed'

async function handleTransferEvent(eventType: TransferEvent, data: Record<string, unknown>) {
  const transferCode = typeof data.transfer_code === 'string' ? data.transfer_code : undefined
  const reference = typeof data.reference === 'string' ? data.reference : undefined

  if (!transferCode && !reference) {
    console.warn('[Paystack webhook] transfer event with no transfer_code or reference, ignoring')
    return
  }

  // transfer_code is Paystack's own id for the transfer and is what we
  // stored at initiation time — the authoritative match. Our own reference
  // is the fallback in case a future event shape ever omits it.
  // Matching on either also catches a transfer that Paystack DID create even
  // though our initiate call errored before we saw its transfer_code.
  const payout = await db.payout.findFirst({
    where: {
      OR: [
        ...(transferCode ? [{ paystackTransferCode: transferCode }] : []),
        ...(reference ? [{ paystackTransferReference: reference }] : []),
      ],
    },
  })

  if (!payout) {
    console.warn('[Paystack webhook] no matching Payout row for transfer event', { transferCode, reference })
    return
  }

  if (eventType === 'transfer.success') {
    await db.payout.update({
      where: { id: payout.id },
      data: { status: 'COMPLETED', completedAt: new Date(), failureReason: null },
    })
    return
  }

  // Paystack redelivers webhooks until it gets a 2xx, so the same failure can
  // arrive more than once — only the first should count toward the retry
  // policy (and only the first should alert).
  if (payout.status !== 'PROCESSING') {
    console.info('[Paystack webhook] ignoring', eventType, 'for payout', payout.id, 'already', payout.status)
    return
  }

  // The "Paystack transfer failed/reversed" prefix is what the retry policy in
  // lib/payouts.ts keys off; any detail Paystack sends is kept after it (and is
  // checked for permanent reasons like "Account closed" first).
  const detail = extractFailureDetail(data)
  const label = eventType === 'transfer.reversed' ? 'reversed' : 'failed'
  await recordPayoutFailure(payout.id, `Paystack transfer ${label}${detail ? `: ${detail}` : ''}`, {
    completedAt: new Date(),
  })
}

/**
 * Note data.reason is NOT a failure reason — it's the narration we sent
 * when initiating ("FieGH host payout — booking …"). Paystack's docs don't
 * publish a transfer.failed sample payload; the transfer object carries a
 * `failures` field (null on success) and some payloads a `gateway_response`,
 * so both are read defensively.
 */
function extractFailureDetail(data: Record<string, unknown>): string | undefined {
  for (const value of [data.gateway_response, data.failures]) {
    if (!value) continue
    if (typeof value === 'string') return value.slice(0, 500)
    if (typeof value === 'object') {
      const message = (value as { message?: unknown; reason?: unknown }).message ?? (value as { reason?: unknown }).reason
      return (typeof message === 'string' ? message : JSON.stringify(value)).slice(0, 500)
    }
  }
  return undefined
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

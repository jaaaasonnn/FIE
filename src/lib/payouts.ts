import crypto from 'crypto'
import * as Sentry from '@sentry/nextjs'
import { db } from '@/lib/db'
import type { Payout } from '@prisma/client'

const PAYSTACK_BASE = 'https://api.paystack.co'
const MIN_TRANSFER_PESEWAS = 100 // Paystack's own floor is GHS 1

function getSecret(): string {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
    throw new Error('Paystack is not configured — set PAYSTACK_SECRET_KEY in .env')
  }
  return secret
}

export type InitiateHostPayoutResult = {
  ok: boolean
  payout: Payout
  error?: string
  /** true if Paystack was never called this time because the row already
   *  had a transfer code (or a terminal status) from a previous attempt. */
  alreadyInitiated?: boolean
}

/**
 * Initiates (or safely resumes) the Paystack transfer that pays a host for
 * one booking. This is a plain callable function, not a route — the next
 * slice wires a scheduler/trigger up to call it; for now it's meant to be
 * called directly (e.g. from a script or an admin action) or exercised in
 * tests.
 *
 * Safe to call more than once for the same (hostId, bookingId): the Payout
 * row is found-or-created in PENDING status BEFORE any Paystack call, so a
 * crash between "we decided to pay this" and "Paystack confirmed it" never
 * loses the record — a retry just picks the same row back up. Once that
 * row has a paystackTransferCode (or has reached a terminal status), this
 * function will not call Paystack again for it; it just returns the
 * existing state.
 *
 * `amount` is the USD amount to actually pay the host — i.e. already net
 * of platform commission — not the booking's gross price.
 */
export async function initiateHostPayout({
  hostId,
  bookingId,
  amount,
}: {
  hostId: string
  bookingId: string
  amount: number
}): Promise<InitiateHostPayoutResult> {
  const host = await db.user.findUnique({ where: { id: hostId } })
  if (!host) {
    throw new Error(`Host ${hostId} not found`)
  }
  if (!host.paystackRecipientCode || !host.payoutMethodVerifiedAt) {
    throw new Error(`Host ${hostId} has no verified payout method`)
  }

  // Find-or-create the Payout row for this booking FIRST, before any
  // network call — this is the record that survives a crash mid-call.
  let payout = await db.payout.findFirst({ where: { hostId, bookingId } })
  if (!payout) {
    payout = await db.payout.create({
      data: {
        hostId,
        bookingId,
        amount,
        currency: 'USD',
        method: host.payoutMethod ?? 'MOMO',
        momoNetwork: host.payoutMomoNetwork,
        momoNumber: host.payoutMomoNumber,
        accountNumber: host.payoutMethod === 'BANK_TRANSFER' ? host.payoutBankAccountNumber : host.payoutMomoNumber,
        accountName: host.payoutBankAccountName,
        status: 'PENDING',
        // Our own idempotent key — generated once here and reused on every
        // retry of this same row, unless Paystack already consumed it on a
        // transfer that then conclusively failed (see retryFailedPayouts).
        paystackTransferReference: newTransferReference(),
      },
    })
  }

  // Idempotency guard: already has a real Paystack transfer code, or has
  // already reached a terminal state from a prior real attempt — do not
  // call Paystack again no matter how many times this is retried.
  if (payout.paystackTransferCode || payout.status === 'COMPLETED' || payout.status === 'FAILED') {
    return { ok: payout.status !== 'FAILED', payout, alreadyInitiated: true }
  }

  const secret = getSecret()

  const rateRow = await db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' } })
  const usdToGhs = rateRow?.usdToGhs ?? Number(process.env.INITIAL_USD_TO_GHS ?? 15.5)
  const amountPesewas = Math.round(amount * usdToGhs * 100)

  if (amountPesewas < MIN_TRANSFER_PESEWAS) {
    const failed = await recordPayoutFailure(payout.id, 'Amount too small to transfer via Paystack', { initiatedAt: new Date() })
    return { ok: false, payout: failed, error: 'Amount too small to transfer via Paystack' }
  }

  try {
    const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'balance',
        amount: amountPesewas,
        recipient: host.paystackRecipientCode,
        reference: payout.paystackTransferReference,
        reason: `FieGH host payout — booking ${bookingId}`,
      }),
    })
    const raw = await res.text()
    let json: { status?: boolean; message?: string; data?: { transfer_code?: string; status?: string } } | null = null
    try { json = JSON.parse(raw) } catch { /* handled below via !json */ }

    if (!res.ok || !json?.status || !json.data?.transfer_code) {
      console.error('[Payouts] Paystack transfer initiate failed:', { httpStatus: res.status, raw })
      // The HTTP status is kept alongside Paystack's message because it's
      // what tells a 5xx (their side, worth retrying) apart from a 4xx.
      const failed = await recordPayoutFailure(
        payout.id,
        `Paystack returned HTTP ${res.status}${json?.message ? `: ${json.message}` : ''}`,
        { initiatedAt: new Date() },
      )
      return { ok: false, payout: failed, error: json?.message || 'Failed to initiate transfer' }
    }

    // Paystack transfers can require OTP finalization depending on the
    // account's dashboard settings — data.status will be "otp" rather than
    // "pending"/"success" in that case. Either way we now have a real
    // transfer_code; final settlement status still comes via webhook.
    const updated = await db.payout.update({
      where: { id: payout.id },
      data: {
        status: 'PROCESSING',
        paystackTransferCode: json.data.transfer_code,
        initiatedAt: new Date(),
      },
    })
    return { ok: true, payout: updated }
  } catch (error) {
    console.error('[Payouts] Transfer initiate network error:', error)
    const failed = await recordPayoutFailure(
      payout.id,
      `Network error calling Paystack: ${error instanceof Error ? error.message : 'unknown'}`,
      { initiatedAt: new Date() },
    )
    return { ok: false, payout: failed, error: 'Network error calling Paystack' }
  }
}

// ─── Failure handling & retry policy ────────────────────────────────────────

/** Automatic retries after the first attempt — so at most 3 attempts total. */
export const MAX_PAYOUT_RETRIES = 2

/** Minimum gap between a failure and its retry. The process-payouts cron runs
 *  hourly, so in practice a retry lands on the first run after this passes. */
export const PAYOUT_RETRY_DELAY_MS = 30 * 60 * 1000

export type PayoutFailureKind = 'TRANSIENT' | 'PERMANENT'

// Messages from Paystack's transfer error docs
// (https://paystack.com/docs/api/errors/transfer/ and
// https://paystack.com/docs/transfers/how-transfers-work/), plus the reasons
// our own code writes. Permanent patterns are checked FIRST, so a webhook
// failure whose detail says e.g. "Account closed" is never retried just
// because it also carries the retryable "transfer failed" prefix.
const PERMANENT_PATTERNS: RegExp[] = [
  /account closed/i,
  /cannot resolve account/i,
  /account number is (invalid|required)/i,
  /bank.?code is (invalid|required)/i,
  /recipient specified is invalid/i,
  /can'?t make the transfer to this recipient/i, // recipient on fraud watchlist
  /unique reference/i, // a transfer already exists under this reference — needs a human, never auto-retry
  /illegal special characters|invalid entries/i,
  /third party payouts/i, // business not upgraded to Registered
  /amount too small/i,
  /no verified payout method|host .* not found/i,
]

const TRANSIENT_PATTERNS: RegExp[] = [
  /balance is not enough/i, // our Paystack balance — fixed by topping up, then a retry succeeds
  /system malfunction/i, // Paystack: unspecified error at the customer's bank, "retry the transfer"
  /^Network error calling Paystack/,
  /^Paystack returned HTTP (5\d\d|429)\b/,
  // Paystack: "failed" = "typically happens when the processor is down";
  // "reversed" = "the customer's bank is unable to receive money at that moment"
  /^Paystack transfer (failed|reversed)\b/,
]

/**
 * Anything unrecognised is treated as PERMANENT: an unknown error gets one
 * alert and a human look, rather than being blindly retried.
 */
export function classifyPayoutFailure(reason: string | null | undefined): PayoutFailureKind {
  if (!reason) return 'PERMANENT'
  if (PERMANENT_PATTERNS.some((re) => re.test(reason))) return 'PERMANENT'
  if (TRANSIENT_PATTERNS.some((re) => re.test(reason))) return 'TRANSIENT'
  return 'PERMANENT'
}

/**
 * The single place a payout is marked FAILED. If the failure won't be retried
 * (permanent reason, or the retry budget is used up) it alerts via Sentry right
 * away; otherwise it leaves the payout for retryFailedPayouts() to pick up.
 */
export async function recordPayoutFailure(
  payoutId: string,
  reason: string,
  timestamps: { initiatedAt?: Date; completedAt?: Date } = {},
): Promise<Payout> {
  const now = new Date()
  const failed = await db.payout.update({
    where: { id: payoutId },
    data: { status: 'FAILED', failureReason: reason, lastFailedAt: now, ...timestamps },
  })

  const kind = classifyPayoutFailure(reason)
  if (kind === 'TRANSIENT' && failed.retryCount < MAX_PAYOUT_RETRIES) {
    return failed
  }

  alertPayoutFailure(failed, kind === 'PERMANENT' ? 'PERMANENT' : 'RETRIES_EXHAUSTED')
  return db.payout.update({ where: { id: payoutId }, data: { alertedAt: now } })
}

function alertPayoutFailure(payout: Payout, why: 'PERMANENT' | 'RETRIES_EXHAUSTED') {
  const summary =
    why === 'PERMANENT'
      ? 'permanent failure, not retried'
      : `still failing after ${payout.retryCount} automatic retries`
  console.error(`[Payouts] Payout ${payout.id} needs attention (${summary}):`, payout.failureReason)
  Sentry.captureException(new Error(`Host payout failed — ${summary}: ${payout.failureReason}`), {
    level: 'error',
    tags: { area: 'payouts', payout_failure: why },
    // No account/MoMo numbers here — IDs are enough to look the rest up.
    contexts: {
      payout: {
        payoutId: payout.id,
        hostId: payout.hostId,
        bookingId: payout.bookingId,
        amount: payout.amount,
        currency: payout.currency,
        method: payout.method,
        failureReason: payout.failureReason,
        retryCount: payout.retryCount,
        paystackTransferReference: payout.paystackTransferReference,
      },
    },
  })
}

export type RetryResult = { payoutId: string; ok: boolean; status: string; retryCount: number; error?: string }

/**
 * Picks FAILED payouts that are retryable (transient reason, not yet alerted,
 * under the retry cap, failed at least PAYOUT_RETRY_DELAY_MS ago) and runs
 * them through initiateHostPayout() again. Called from the process-payouts
 * cron, so the delay between attempts is the cron's own cadence.
 *
 * Rows that failed before this policy existed have no lastFailedAt and are
 * deliberately left alone.
 */
export async function retryFailedPayouts(): Promise<RetryResult[]> {
  const candidates = await db.payout.findMany({
    where: {
      status: 'FAILED',
      alertedAt: null,
      retryCount: { lt: MAX_PAYOUT_RETRIES },
      lastFailedAt: { lte: new Date(Date.now() - PAYOUT_RETRY_DELAY_MS) },
      bookingId: { not: null },
    },
  })

  const results: RetryResult[] = []
  for (const payout of candidates) {
    if (classifyPayoutFailure(payout.failureReason) !== 'TRANSIENT') continue

    // Claim the row atomically so two overlapping cron runs can't both retry
    // it — only the run whose update matches the current retryCount wins.
    //
    // Reference: if Paystack gave us a transfer_code, a transfer was really
    // created under this reference and has since conclusively failed/reversed,
    // so Paystack will reject the same reference ("Please provide a unique
    // reference") — a new one is needed. With no transfer_code, the failure
    // happened at initiation, and Paystack's docs say to retry with the SAME
    // reference so a request that did get through can't be paid twice.
    const claimed = await db.payout.updateMany({
      where: { id: payout.id, status: 'FAILED', retryCount: payout.retryCount },
      data: {
        status: 'PENDING',
        retryCount: { increment: 1 },
        failureReason: null,
        completedAt: null,
        ...(payout.paystackTransferCode
          ? { paystackTransferCode: null, paystackTransferReference: newTransferReference() }
          : {}),
      },
    })
    if (claimed.count === 0) continue

    try {
      const result = await initiateHostPayout({
        hostId: payout.hostId,
        bookingId: payout.bookingId!,
        amount: payout.amount,
      })
      results.push({
        payoutId: payout.id,
        ok: result.ok,
        status: result.payout.status,
        retryCount: result.payout.retryCount,
        error: result.error,
      })
    } catch (error) {
      // e.g. the host removed their payout method since — record it so the
      // row doesn't sit in PENDING, which the main cron query never revisits.
      const failed = await recordPayoutFailure(payout.id, error instanceof Error ? error.message : 'Unknown error')
      results.push({ payoutId: payout.id, ok: false, status: failed.status, retryCount: failed.retryCount, error: failed.failureReason ?? undefined })
    }
  }
  return results
}

// Paystack wants references to be lowercase alphanumerics plus - and _.
function newTransferReference(): string {
  return `pyt-${crypto.randomUUID()}`
}

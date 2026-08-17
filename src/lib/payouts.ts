import crypto from 'crypto'
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
        // retry of this same row, never regenerated.
        paystackTransferReference: `PYT-${crypto.randomUUID()}`,
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
    const failed = await db.payout.update({
      where: { id: payout.id },
      data: { status: 'FAILED', failureReason: 'Amount too small to transfer via Paystack', initiatedAt: new Date() },
    })
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
      const failed = await db.payout.update({
        where: { id: payout.id },
        data: { status: 'FAILED', failureReason: json?.message || `Paystack returned HTTP ${res.status}`, initiatedAt: new Date() },
      })
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
    const failed = await db.payout.update({
      where: { id: payout.id },
      data: { status: 'FAILED', failureReason: error instanceof Error ? error.message : 'Network error', initiatedAt: new Date() },
    })
    return { ok: false, payout: failed, error: 'Network error calling Paystack' }
  }
}

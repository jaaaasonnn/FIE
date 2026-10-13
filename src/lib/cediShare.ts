// What a host is sent, in cedis. A guest is charged in cedis on the day they
// pay, and the host is paid days or months later. The transfer is a fixed
// share of the cedis the guest actually paid (Payment.amountPesewas), never a
// fresh conversion at the rate on the day it is sent, so a move in the
// exchange rate in between costs nobody anything.
//
// Nothing is stored: the amount is worked out from the payment each time, for
// the transfer and for every page that shows it. This file is the sums only,
// so a page can use it; lib/payoutCedis.ts reads the payments.

import { hostShare } from '@/lib/disputes'

/** The parts of a payment the sum needs: the dollars it was for and the pesewas Paystack was asked to charge. */
export type CediSource = { amount: number; amountPesewas: number | null }

/**
 * The pesewas that `usd` of a payment came to: the same share of the cedis
 * charged. Rounded down, so a host is never sent a pesewa more than their
 * share. Null when the payment has no stored cedi amount.
 */
export function cediShare(usd: number, payment: CediSource | null | undefined): number | null {
  if (!payment || !payment.amountPesewas || !(payment.amount > 0)) return null
  // The small addition is for sums like 0.1 + 0.2: a whole number of pesewas must not round down to one less
  return Math.min(payment.amountPesewas, Math.floor((payment.amountPesewas * usd) / payment.amount + 1e-6))
}

/**
 * A host payout of `amount` dollars, in pesewas.
 *
 * `own` is the payment for this booking, or for this rent instalment. Rent an
 * admin took from the damage deposit (`coveredFromDeposit`) was paid in the
 * booking's first payment, so that share is worked out from `first`.
 *
 * Null when a payment it needs has no stored cedi amount: such a payout is
 * held for a person, never converted at today's rate.
 */
export function payoutPesewas({ amount, coveredFromDeposit = 0, own, first }: {
  amount: number
  coveredFromDeposit?: number
  own: CediSource | null | undefined
  first?: CediSource | null
}): number | null {
  const fromDeposit = Math.min(amount, hostShare(coveredFromDeposit))
  const fromOwn = amount - fromDeposit
  let total = 0
  if (fromDeposit > 0.005) {
    const part = cediShare(fromDeposit, first)
    if (part === null) return null
    total += part
  }
  if (fromOwn > 0.005) {
    const part = cediShare(fromOwn, own)
    if (part === null) return null
    total += part
  }
  return total
}

/** The reason recorded on a payout that is held because its payment has no stored cedi amount. */
export const NO_CEDI_AMOUNT = 'No stored cedi amount for the guest\'s payment, so the payout cannot be worked out. Pay it by hand.'

// Cancellation policies and the refund each one gives. Pure rules, no
// database and no network: the cancel route, the preview and every page that
// shows a policy read from here, so the site can only promise what this does.
//
// "Days before" counts calendar days from the day of cancelling to the
// check-in day, in Ghana. From the check-in day onwards a booking cannot be
// cancelled online at all (lib/cancelRules.ts).

export type Policy = 'FLEXIBLE' | 'MODERATE' | 'STRICT'
export type RentalMode = 'SHORT_STAY' | 'TEMP_STAY' | 'PERMANENT'

export const POLICIES: Policy[] = ['FLEXIBLE', 'MODERATE', 'STRICT']
export const DEFAULT_POLICY: Policy = 'MODERATE'
export const POLICY_LABELS: Record<Policy, string> = { FLEXIBLE: 'Flexible', MODERATE: 'Moderate', STRICT: 'Strict' }

/** Any stored value as a policy; unknown or missing falls back to the default. */
export function asPolicy(value: unknown): Policy {
  return POLICIES.includes(value as Policy) ? (value as Policy) : DEFAULT_POLICY
}

export function isPolicy(value: unknown): value is Policy {
  return POLICIES.includes(value as Policy)
}

function asMode(value: unknown): RentalMode {
  return value === 'TEMP_STAY' || value === 'PERMANENT' ? value : 'SHORT_STAY'
}

// A tier applies when the guest cancels at least `minDays` before check-in.
// Listed from the most notice to the least; below the last tier the stay
// price is not refunded.
type Tier = { minDays: number; percent: number }

const TIERS: Record<RentalMode, Record<Policy, Tier[]>> = {
  SHORT_STAY: {
    FLEXIBLE: [{ minDays: 1, percent: 100 }],
    MODERATE: [{ minDays: 5, percent: 100 }, { minDays: 1, percent: 50 }],
    STRICT:   [{ minDays: 14, percent: 100 }, { minDays: 7, percent: 50 }, { minDays: 1, percent: 0 }],
  },
  TEMP_STAY: {
    FLEXIBLE: [{ minDays: 7, percent: 100 }, { minDays: 1, percent: 50 }],
    MODERATE: [{ minDays: 14, percent: 100 }, { minDays: 7, percent: 50 }, { minDays: 1, percent: 0 }],
    STRICT:   [{ minDays: 30, percent: 100 }, { minDays: 14, percent: 50 }, { minDays: 1, percent: 0 }],
  },
  PERMANENT: {
    FLEXIBLE: [{ minDays: 14, percent: 100 }, { minDays: 1, percent: 50 }],
    MODERATE: [{ minDays: 30, percent: 100 }, { minDays: 14, percent: 50 }, { minDays: 1, percent: 0 }],
    STRICT:   [{ minDays: 60, percent: 100 }, { minDays: 30, percent: 50 }, { minDays: 1, percent: 0 }],
  },
}

/** The share of the stay price a guest gets back, cancelling this many days before check-in. */
export function refundPercent(rentalMode: unknown, policy: unknown, daysBefore: number): number {
  const tier = TIERS[asMode(rentalMode)][asPolicy(policy)].find((t) => daysBefore >= t.minDays)
  return tier ? tier.percent : 0
}

const cents = (n: number) => Math.round(n * 100) / 100

export type RefundInput = {
  rentalMode: unknown
  policy: unknown
  /** Who is cancelling. A host cancelling gives the guest everything back. */
  by: 'GUEST' | 'HOST'
  /** Calendar days from today (Ghana) to the check-in day */
  daysBefore: number
  subtotal: number
  serviceFee: number
  damageDeposit: number
  /** The nightly, monthly or yearly price the booking was made at */
  pricePerUnit: number
  /** What the guest actually paid, in USD. The refund can never exceed it. */
  paid: number
}

export type RefundQuote = {
  policy: Policy
  percent: number
  stayRefund: number
  serviceFeeRefund: number
  depositRefund: number
  /** Everything going back to the guest */
  total: number
  /** What is not refunded */
  kept: number
}

/**
 * The refund for cancelling a paid booking, worked out only from stored
 * booking values and the policy.
 *
 *  - Stay price: the policy's percentage. For monthly and long-term stays the
 *    amount kept is never more than one month's rent.
 *  - Service fee: back only when the whole stay price comes back.
 *  - Damage deposit: always back in full, since the guest never arrived.
 *  - A host cancelling: all three, in full.
 */
export function quoteRefund(input: RefundInput): RefundQuote {
  const mode = asMode(input.rentalMode)
  const policy = asPolicy(input.policy)
  const percent = input.by === 'HOST' ? 100 : refundPercent(mode, policy, input.daysBefore)

  let stayKept = input.subtotal * (1 - percent / 100)
  if (mode !== 'SHORT_STAY') {
    const monthsRent = mode === 'TEMP_STAY' ? input.pricePerUnit : input.pricePerUnit / 12
    stayKept = Math.min(stayKept, monthsRent)
  }
  const stayRefund = cents(input.subtotal - stayKept)
  const wholeStayBack = stayRefund >= cents(input.subtotal)

  const serviceFeeRefund = wholeStayBack ? cents(input.serviceFee) : 0
  const depositRefund = cents(input.damageDeposit)

  const total = cents(stayRefund + serviceFeeRefund + depositRefund)
  if (total > cents(input.paid) + 0.005) {
    // Stored amounts that add up to more than the payment are a data fault,
    // not something to pay out on.
    throw new Error(`Refund of ${total} is more than the ${input.paid} paid`)
  }
  return { policy, percent, stayRefund, serviceFeeRefund, depositRefund, total, kept: cents(input.paid - total) }
}

/**
 * The refund in pesewas: the same share of the cedis Paystack charged, so the
 * guest gets back the cedis they paid and not a fresh conversion.
 */
export function refundPesewas(refundUsd: number, paidUsd: number, chargedPesewas: number): number {
  if (refundUsd >= paidUsd) return chargedPesewas
  return Math.min(chargedPesewas, Math.round((chargedPesewas * refundUsd) / paidUsd))
}

// ── Wording ────────────────────────────────────────────────────────────────
// Built from the same tiers as the sums above.

const arrival = (mode: RentalMode) => (mode === 'SHORT_STAY' ? 'check-in' : 'move-in')
const price = (mode: RentalMode) => (mode === 'SHORT_STAY' ? 'stay price' : 'rent')

/** The policy's refund rules for one rental type, one plain sentence per tier. */
export function policyRuleLines(rentalModeRaw: unknown, policyRaw: unknown): string[] {
  const mode = asMode(rentalModeRaw)
  const tiers = TIERS[mode][asPolicy(policyRaw)]
  const lines = tiers.map((tier, i) => {
    const upper = i === 0 ? null : tiers[i - 1].minDays - 1
    const amount = tier.percent === 100 ? `Full refund of the ${price(mode)}`
      : tier.percent === 0 ? `No refund of the ${price(mode)}`
      : `${tier.percent}% of the ${price(mode)} back`
    const when = upper === null
      ? (tier.minDays === 1 ? `up to the day before ${arrival(mode)}` : `${tier.minDays} or more days before ${arrival(mode)}`)
      : tier.percent === 0
        ? `less than ${upper + 1} days before ${arrival(mode)}`
        : (tier.minDays === upper ? `${upper} day${upper === 1 ? '' : 's'} before ${arrival(mode)}` : `${tier.minDays} to ${upper} days before ${arrival(mode)}`)
    return `${amount} if you cancel ${when}.`
  })
  if (mode !== 'SHORT_STAY') lines.push("We never keep more than one month's rent.")
  return lines
}

/** What is true under every policy. */
export function commonRuleLines(rentalModeRaw: unknown): string[] {
  const mode = asMode(rentalModeRaw)
  return [
    `The service fee is refunded only when the whole ${price(mode)} is refunded.`,
    `The damage deposit is always refunded in full if you cancel before ${arrival(mode)}.`,
    `From the ${arrival(mode)} day onwards you cannot cancel online. Contact support at support@fiegh.com.`,
  ]
}

/** The last day (as days before check-in) on which the current refund still applies, or null at 0%. */
export function tierDeadline(rentalMode: unknown, policy: unknown, daysBefore: number): { percent: number; minDays: number } | null {
  const tier = TIERS[asMode(rentalMode)][asPolicy(policy)].find((t) => daysBefore >= t.minDays)
  return tier && tier.percent > 0 ? { percent: tier.percent, minDays: tier.minDays } : null
}

// ── Host cancellations ─────────────────────────────────────────────────────

export const HOST_CANCEL_REASONS = {
  PROPERTY_UNAVAILABLE: 'The property is no longer available',
  EMERGENCY: 'An emergency',
  DOUBLE_BOOKING: 'A double booking',
  GUEST_REQUEST: 'The guest asked me to cancel',
  OTHER: 'Another reason',
} as const
export type HostCancelReason = keyof typeof HOST_CANCEL_REASONS
export const MAX_CANCEL_NOTE = 300

export function isHostCancelReason(value: unknown): value is HostCancelReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HOST_CANCEL_REASONS, value)
}

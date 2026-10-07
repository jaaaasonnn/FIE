// Rules for disputes: who can report a problem on a booking and when, what
// an admin can decide, and exactly what each decision does to the money.
// Pure: no database and no network. The routes, the admin screen and every
// page that describes disputes read from here.
//
// A guest reports that the home is not as promised; a host reports damage,
// which concerns the deposit. One dispute per side per booking.

import { dayKey } from '@/lib/hostCalendar'
import { addDays, ghanaToday } from '@/lib/stayDates'
import { refundPesewas } from '@/lib/cancellationPolicy'
import { PLATFORM_COMMISSION, formatUsd } from '@/lib/utils'

export type DisputeRole = 'GUEST' | 'HOST'

/** A dispute in either of these states is still open: it holds the host's payout. */
export const OPEN_DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW']

export const GUEST_REASONS = {
  NOT_AS_DESCRIBED: 'The home is not as described',
  NO_ACCESS: 'I could not get in',
  UNSAFE_OR_UNCLEAN: 'The home is unsafe or unclean',
  MISSING_AMENITY: 'Something promised is missing',
  OTHER: 'Another problem',
} as const
export const HOST_REASONS = {
  DAMAGE: 'Damage to the home',
  MISSING_ITEMS: 'Items are missing',
  EXTRA_CLEANING: 'Extra cleaning was needed',
  RULES_BROKEN: 'House rules were broken',
  OTHER: 'Another problem',
} as const

export function reasonsFor(role: DisputeRole): Record<string, string> {
  return role === 'GUEST' ? GUEST_REASONS : HOST_REASONS
}
export function reasonLabel(role: string, reason: string): string {
  return reasonsFor(role === 'HOST' ? 'HOST' : 'GUEST')[reason] ?? reason
}
export function isReasonFor(role: DisputeRole, value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(reasonsFor(role), value)
}

export const MIN_DESCRIPTION = 20
export const MAX_DESCRIPTION = 2000

/** Photos each side can attach to one dispute. */
export const MAX_EVIDENCE_PER_SIDE = 6
export const MAX_EVIDENCE_BYTES = 5_000_000 // the dispute-evidence bucket's own limit
export const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** How long a link to a photo works for. */
export const EVIDENCE_LINK_SECONDS = 10 * 60

/** An aim, not a promise. Shown wherever a dispute is. */
export const DECISION_AIM = 'We aim to decide within 3 working days.'
/** An open dispute this old raises a daily alert. */
export const OVERDUE_DISPUTE_DAYS = 3

// ── Windows ────────────────────────────────────────────────────────────────
// Calendar days in Ghana, where the homes are.

export type DisputeWindow = { opens: string; closes: string }

/** A guest can report from the check-in day to the end of the day after. */
export function guestWindow(checkIn: Date): DisputeWindow {
  const opens = dayKey(checkIn)
  return { opens, closes: addDays(opens, 1) }
}

/** A host can report from the check-out day to the end of the second day after. */
export function hostWindow(checkOut: Date): DisputeWindow {
  const opens = dayKey(checkOut)
  return { opens, closes: addDays(opens, 2) }
}

export type EligibilityBooking = {
  status: string
  paymentStatus: string
  checkIn: Date
  checkOut: Date
}

export type Eligibility =
  | { ok: true; window: DisputeWindow }
  | { ok: false; message: string; window?: DisputeWindow }

const SUPPORT = 'Contact support at support@fiegh.com.'

/**
 * Whether this side can report a problem on the booking right now.
 * `existingRoles` are the sides that have already raised one; `hasRefund` is
 * whether any refund is on record for the booking.
 */
export function disputeEligibility({
  role, booking, existingRoles, hasRefund, now = new Date(),
}: {
  role: DisputeRole
  booking: EligibilityBooking
  existingRoles: string[]
  hasRefund: boolean
  now?: Date
}): Eligibility {
  if (existingRoles.includes(role)) {
    return { ok: false, message: 'You have already reported a problem on this booking.' }
  }
  if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
    return { ok: false, message: `A problem cannot be reported on a booking that is ${booking.status.toLowerCase()}. ${SUPPORT}` }
  }

  const today = ghanaToday(now)
  if (role === 'GUEST') {
    if (booking.paymentStatus !== 'PAID' || hasRefund) {
      return {
        ok: false,
        message: hasRefund
          ? `This booking already has a refund on record. ${SUPPORT}`
          : `This booking has not been paid for, so there is nothing to dispute. ${SUPPORT}`,
      }
    }
    const window = guestWindow(booking.checkIn)
    if (today < window.opens) return { ok: false, window, message: 'You can report a problem from the check-in day.' }
    if (today > window.closes) {
      return { ok: false, window, message: `The time to report a problem on this stay has passed. It closed at the end of the day after check-in. ${SUPPORT}` }
    }
    return { ok: true, window }
  }

  if (booking.paymentStatus !== 'PAID' && booking.paymentStatus !== 'PARTIALLY_REFUNDED') {
    return { ok: false, message: `A problem can only be reported on a stay that was paid for. ${SUPPORT}` }
  }
  const window = hostWindow(booking.checkOut)
  if (today < window.opens) return { ok: false, window, message: 'You can report a problem from the check-out day.' }
  if (today > window.closes) {
    return { ok: false, window, message: `The time to report a problem on this stay has passed. It closed at the end of the second day after check-out. ${SUPPORT}` }
  }
  return { ok: true, window }
}

// ── Decisions ──────────────────────────────────────────────────────────────

export const GUEST_OUTCOMES = ['FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED'] as const
export const HOST_OUTCOMES = ['DEPOSIT_RETURNED', 'DEPOSIT_KEPT', 'REJECTED'] as const
export type Outcome = (typeof GUEST_OUTCOMES)[number] | (typeof HOST_OUTCOMES)[number]

export function outcomesFor(role: string): readonly Outcome[] {
  return role === 'HOST' ? HOST_OUTCOMES : GUEST_OUTCOMES
}

export function outcomeLabel(role: string, outcome: string): string {
  if (outcome === 'FULL_REFUND') return 'Full refund to the guest'
  if (outcome === 'PARTIAL_REFUND') return 'Partial refund to the guest'
  if (outcome === 'DEPOSIT_RETURNED') return 'Deposit returned to the guest'
  if (outcome === 'DEPOSIT_KEPT') return 'Deposit kept for the host'
  if (outcome === 'REJECTED') return role === 'HOST' ? 'Not upheld: the deposit goes back to the guest' : 'Not upheld: the host is paid as normal'
  return outcome
}

/** Refunds that leave the host still owed a payout. Any other refund means no payout. */
export const PAYABLE_REFUND_REASONS = ['DISPUTE_PARTIAL', 'DISPUTE_DEPOSIT']

/** The host's share of a stay: the stay price, less any of it refunded, less the commission. */
export function hostShare(subtotal: number, stayRefunded = 0): number {
  return Math.max(0, subtotal - stayRefunded) * (1 - PLATFORM_COMMISSION)
}

const cents = (n: number) => Math.round(n * 100) / 100

export type DecisionInput = {
  role: string
  outcome: unknown
  /** The amount the admin entered: required for PARTIAL_REFUND and DEPOSIT_KEPT */
  amount?: unknown
  booking: { rentalMode: string; subtotal: number; serviceFee: number; damageDeposit: number }
  /** The booking's successful payment */
  payment: { id: string; amount: number; amountPesewas: number | null } | null
  /** A refund already on record for the booking, if any */
  existingRefund: { reason: string; amount: number } | null
  /** A payout already created for the booking, if any */
  payout: { status: string; amount: number } | null
}

export type DecisionRefund = {
  reason: 'DISPUTE_FULL' | 'DISPUTE_PARTIAL' | 'DISPUTE_DEPOSIT'
  stayRefund: number
  serviceFeeRefund: number
  depositRefund: number
  amount: number
  amountPesewas: number | null
}

export type DecisionEffect =
  | { ok: false; error: string }
  | {
      ok: true
      outcome: Outcome
      /** The amount stored on the dispute, for the two outcomes that take one */
      amount: number | null
      /** A refund to record and send through the refund code, or null */
      refund: DecisionRefund | null
      /** What the host is paid for the stay after this decision, when it changes it; null otherwise */
      hostPayout: number | null
      /** Things a person must do, because no code does them */
      manual: string[]
      /** The whole effect in plain sentences, shown to the admin before confirming */
      summary: string[]
    }

/**
 * Exactly what a decision would do to the money, worked out from stored
 * values. The admin sees this before confirming, and the same result is what
 * gets applied: nothing is taken from the request except the outcome and,
 * for the two outcomes that need one, an amount that is checked here.
 */
export function decisionEffect(input: DecisionInput): DecisionEffect {
  const role = input.role === 'HOST' ? 'HOST' : 'GUEST'
  const outcome = input.outcome as Outcome
  if (!outcomesFor(role).includes(outcome)) return { ok: false, error: 'Choose an outcome for this dispute' }

  const { booking, payment, existingRefund, payout } = input
  const shortStay = booking.rentalMode === 'SHORT_STAY'
  const paidOut = payout && payout.status !== 'FAILED' ? payout : null
  const manual: string[] = []
  const summary: string[] = []
  const pesewas = (usd: number) =>
    payment?.amountPesewas ? refundPesewas(usd, payment.amount, payment.amountPesewas) : null

  const readAmount = (max: number, what: string): number | string => {
    const n = Number(input.amount)
    if (!Number.isFinite(n) || n <= 0) return `Enter the amount ${what}`
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return 'Enter an amount in dollars and cents'
    if (n > max + 0.005) return `The amount cannot be more than ${formatUsd(max)}`
    return cents(n)
  }

  // ── A guest's dispute ────────────────────────────────────────────────
  if (role === 'GUEST') {
    if (outcome === 'REJECTED') {
      summary.push('No refund.')
      summary.push(shortStay
        ? `The hold on the payout is lifted. The host is paid ${formatUsd(hostShare(booking.subtotal))} by the next payout run.`
        : 'Payouts for monthly and long-term stays are made by hand.')
      return { ok: true, outcome, amount: null, refund: null, hostPayout: null, manual, summary }
    }

    if (!payment) return { ok: false, error: 'This booking has no successful payment on record, so nothing can be refunded' }
    if (existingRefund) return { ok: false, error: 'This booking already has a refund on record. Handle it by hand and write a correction on the dispute.' }

    if (outcome === 'FULL_REFUND') {
      const refund: DecisionRefund = {
        reason: 'DISPUTE_FULL',
        stayRefund: cents(booking.subtotal), serviceFeeRefund: cents(booking.serviceFee), depositRefund: cents(booking.damageDeposit),
        amount: cents(payment.amount), amountPesewas: pesewas(payment.amount),
      }
      summary.push(`The guest is refunded ${formatUsd(refund.amount)}: everything they paid.`)
      if (paidOut) {
        manual.push(`The host has already been sent ${formatUsd(paidOut.amount)}. Recover it by hand.`)
      } else {
        summary.push('The host is not paid for this stay.')
      }
      return { ok: true, outcome, amount: null, refund, hostPayout: 0, manual, summary: [...summary, ...manual] }
    }

    // PARTIAL_REFUND: from the stay price only. The service fee and the deposit are untouched.
    const amount = readAmount(booking.subtotal, 'to refund')
    if (typeof amount === 'string') return { ok: false, error: amount }
    const refund: DecisionRefund = {
      reason: 'DISPUTE_PARTIAL',
      stayRefund: amount, serviceFeeRefund: 0, depositRefund: 0,
      amount, amountPesewas: pesewas(amount),
    }
    const share = cents(hostShare(booking.subtotal, amount))
    summary.push(`The guest is refunded ${formatUsd(amount)} of the ${formatUsd(booking.subtotal)} stay price. The service fee is kept.`)
    if (paidOut) {
      const over = cents(paidOut.amount - share)
      if (over > 0) manual.push(`The host has already been sent ${formatUsd(paidOut.amount)} and is now owed ${formatUsd(share)}. Recover ${formatUsd(over)} by hand.`)
    } else if (shortStay) {
      summary.push(`The host is paid ${formatUsd(share)}: 92% of the ${formatUsd(booking.subtotal - amount)} left. The next payout run sends it.`)
    } else {
      manual.push(`Pay the host ${formatUsd(share)} by hand: 92% of the ${formatUsd(booking.subtotal - amount)} left. Payouts for monthly and long-term stays are not automatic.`)
    }
    return { ok: true, outcome, amount, refund, hostPayout: share, manual, summary: [...summary, ...manual] }
  }

  // ── A host's dispute: about the deposit only ─────────────────────────
  const deposit = cents(booking.damageDeposit)
  const depositRefund = (usd: number): DecisionRefund | null => {
    if (usd <= 0) return null
    if (!payment || existingRefund) {
      // One refund per booking: a second one cannot go through the refund code
      manual.push(`Return ${formatUsd(usd)} of the deposit to the guest by hand${existingRefund ? ' (this booking already has a refund on record)' : ''}.`)
      return null
    }
    summary.push(`The guest is refunded ${formatUsd(usd)} of the deposit.`)
    return { reason: 'DISPUTE_DEPOSIT', stayRefund: 0, serviceFeeRefund: 0, depositRefund: usd, amount: usd, amountPesewas: pesewas(usd) }
  }

  if (outcome === 'REJECTED') {
    summary.push('The report is not upheld.')
    if (deposit > 0) manual.push(`Return the ${formatUsd(deposit)} deposit to the guest by hand, as after any stay.`)
    return { ok: true, outcome, amount: null, refund: null, hostPayout: null, manual, summary: [...summary, ...manual] }
  }
  if (deposit <= 0) return { ok: false, error: 'This booking has no deposit, so there is nothing to keep or return' }

  if (outcome === 'DEPOSIT_RETURNED') {
    const refund = depositRefund(deposit)
    return { ok: true, outcome, amount: null, refund, hostPayout: null, manual, summary: [...summary, ...manual] }
  }

  // DEPOSIT_KEPT: all or part goes to the host, by hand; the rest goes back to the guest
  const amount = readAmount(deposit, 'of the deposit to keep for the host')
  if (typeof amount === 'string') return { ok: false, error: amount }
  summary.push(`${formatUsd(amount)} of the ${formatUsd(deposit)} deposit is kept for the host.`)
  manual.push(`Pay ${formatUsd(amount)} to the host by hand. Deposits are not paid out automatically.`)
  const refund = depositRefund(cents(deposit - amount))
  return { ok: true, outcome, amount, refund, hostPayout: null, manual, summary: [...summary, ...manual] }
}

// ── What each side is told ─────────────────────────────────────────────────

export function disputeStatusText(dispute: { status: string; outcome: string | null; raisedByRole: string }): string {
  if (dispute.status === 'RESOLVED' || dispute.status === 'CLOSED') {
    return dispute.outcome ? `Decided: ${outcomeLabel(dispute.raisedByRole, dispute.outcome).toLowerCase()}.` : 'Closed.'
  }
  return dispute.status === 'UNDER_REVIEW' ? `Our team is reviewing it. ${DECISION_AIM}` : `Reported. ${DECISION_AIM}`
}

/**
 * The link a booking shows to its guest or host: to report a problem while
 * their window is open, or to see one that either side has reported. Null
 * when there is nothing to do or see.
 */
export function problemLinkLabel(
  role: DisputeRole,
  booking: {
    status: string; paymentStatus: string; checkIn: string | Date; checkOut: string | Date
    disputes?: { raisedByRole: string }[] | null
    refund?: unknown
  },
  now: Date = new Date(),
): string | null {
  const disputes = booking.disputes ?? []
  if (disputes.length > 0) return 'View reported problem'
  const eligible = disputeEligibility({
    role,
    booking: { status: booking.status, paymentStatus: booking.paymentStatus, checkIn: new Date(booking.checkIn), checkOut: new Date(booking.checkOut) },
    existingRoles: [],
    hasRefund: !!booking.refund,
    now,
  })
  return eligible.ok ? 'Report a problem' : null
}

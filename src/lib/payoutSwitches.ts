// Safety switches for anything that moves money or completes bookings.
// Everything is off until it is turned on in the environment, so a fresh
// deploy can never do either by accident. See CLAUDE.md, "Payout and completion switches".
//
//   PAYOUTS_ENABLED=true        Real transfers may be attempted.
//   PAYOUTS_NOT_BEFORE=2027-01-15
//                               Only bookings created on or after this day
//                               (UTC) can ever be paid out. Required: without
//                               it payouts stay in dry run.
//   COMPLETION_ENABLED=true     Bookings may be marked COMPLETED.
//   REFUNDS_ENABLED=true        Refunds may be sent to Paystack. While off,
//                               cancelling still works and the refund is
//                               recorded as owed; nothing is sent.
//   DISPUTE_DECISIONS_ENABLED=true
//                               An admin's decision on a dispute takes
//                               effect. While off, deciding only reports what
//                               it would do and writes nothing. Reporting a
//                               problem and holding the payout are always on.
//   PAYMENT_WEBHOOK_ENABLED=true
//                               Paystack's charge.success webhook may confirm
//                               a payment. While off, the event is still
//                               signature-checked and logged as what it would
//                               do; nothing is written.
//   BOOKING_EXPIRY_ENABLED=true Unpaid bookings and unanswered requests may
//                               be ended once their time is up. While off,
//                               the job is a dry run and never calls Paystack.
//   BOOKING_EXPIRY_NOT_BEFORE=2027-01-15
//                               Only bookings created on or after this day
//                               (UTC) can ever be ended by the job. Required:
//                               without it the job stays in dry run.
//
//   RENT_REMINDERS_ENABLED=true Rent reminders may be written for instalments
//                               that are coming due or late. While off, the
//                               job is a dry run and never calls Paystack.
//   RENT_DEPOSIT_COVER_ENABLED=true
//                               An admin may cover a missed rent payment from
//                               the damage deposit. While off, the action only
//                               reports what it would do and writes nothing.
//   PAYOUT_LIMIT_GHS=50000      Not a switch: the most a single transfer may
//                               be, in cedis. A payout above it is held for a
//                               person and never split. Unset: nothing is held.
//
// Either cron also accepts ?dryRun=1, which reports what it would do and
// changes nothing, whatever the switches say.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A YYYY-MM-DD setting as the start of that day in UTC, or null if unset or not a real date. */
function dayFromEnv(value: string | undefined): Date | null {
  const raw = value?.trim()
  const m = raw ? DAY_RE.exec(raw) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

/** PAYOUTS_NOT_BEFORE as the start of that day in UTC, or null if unset or not a real date. */
export function payoutsNotBefore(): Date | null {
  return dayFromEnv(process.env.PAYOUTS_NOT_BEFORE)
}

export type PayoutGate =
  | { live: true; notBefore: Date }
  | { live: false; notBefore: Date | null; reason: string }

/** Whether real transfers are allowed right now, and if not, why. */
export function payoutGate(): PayoutGate {
  const notBefore = payoutsNotBefore()
  // Exactly "true": a typo or "1" must never switch payouts on
  if (process.env.PAYOUTS_ENABLED !== 'true') {
    return { live: false, notBefore, reason: 'PAYOUTS_ENABLED is not set to true' }
  }
  if (!notBefore) {
    return { live: false, notBefore, reason: 'PAYOUTS_NOT_BEFORE is not set to a date (YYYY-MM-DD)' }
  }
  return { live: true, notBefore }
}

export function completionEnabled(): boolean {
  return process.env.COMPLETION_ENABLED === 'true'
}

/** Exactly "true": while off, an admin's dispute decision is a dry run. */
export function disputeDecisionsEnabled(): boolean {
  return process.env.DISPUTE_DECISIONS_ENABLED === 'true'
}

/** Exactly "true", like the others: a typo must never switch refunds on. */
export function refundsEnabled(): boolean {
  return process.env.REFUNDS_ENABLED === 'true'
}

/** Exactly "true": while off, a charge.success webhook is checked and logged but changes nothing. */
export function paymentWebhookEnabled(): boolean {
  return process.env.PAYMENT_WEBHOOK_ENABLED === 'true'
}

export type ExpiryGate =
  | { live: true; notBefore: Date }
  | { live: false; notBefore: Date | null; reason: string }

/** Whether the expiry job may end bookings right now, and if not, why. */
export function expiryGate(): ExpiryGate {
  const notBefore = dayFromEnv(process.env.BOOKING_EXPIRY_NOT_BEFORE)
  if (process.env.BOOKING_EXPIRY_ENABLED !== 'true') {
    return { live: false, notBefore, reason: 'BOOKING_EXPIRY_ENABLED is not set to true' }
  }
  if (!notBefore) {
    return { live: false, notBefore, reason: 'BOOKING_EXPIRY_NOT_BEFORE is not set to a date (YYYY-MM-DD)' }
  }
  return { live: true, notBefore }
}

/** Exactly "true": while off, the rent reminder job is a dry run. */
export function rentRemindersEnabled(): boolean {
  return process.env.RENT_REMINDERS_ENABLED === 'true'
}

/** Exactly "true": while off, covering rent from a deposit only reports what it would do. */
export function rentDepositCoverEnabled(): boolean {
  return process.env.RENT_DEPOSIT_COVER_ENABLED === 'true'
}

/**
 * PAYOUT_LIMIT_GHS as pesewas: the most one transfer may be. Null when unset
 * or not a positive number, in which case no payout is held for its size.
 */
export function payoutLimitPesewas(): number | null {
  const raw = process.env.PAYOUT_LIMIT_GHS?.trim()
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null
  const pesewas = Math.round(Number(raw) * 100)
  return pesewas > 0 ? pesewas : null
}

/** Thrown when something tries to start a transfer while payouts are off. */
export class PayoutsOffError extends Error {
  constructor(reason: string) {
    super(`Payouts are switched off: ${reason}`)
    this.name = 'PayoutsOffError'
  }
}

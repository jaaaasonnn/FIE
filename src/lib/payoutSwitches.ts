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
//
// Either cron also accepts ?dryRun=1, which reports what it would do and
// changes nothing, whatever the switches say.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** PAYOUTS_NOT_BEFORE as the start of that day in UTC, or null if unset or not a real date. */
export function payoutsNotBefore(): Date | null {
  const raw = process.env.PAYOUTS_NOT_BEFORE?.trim()
  const m = raw ? DAY_RE.exec(raw) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
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

/** Thrown when something tries to start a transfer while payouts are off. */
export class PayoutsOffError extends Error {
  constructor(reason: string) {
    super(`Payouts are switched off: ${reason}`)
    this.name = 'PayoutsOffError'
  }
}

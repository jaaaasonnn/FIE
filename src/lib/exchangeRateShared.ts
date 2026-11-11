// The parts of lib/exchangeRate.ts that a page in the browser may read. Nothing here imports anything:
// exchangeRate.ts itself reaches the database, and a page that imported it would ship part of the database
// client to every visitor (lib/security/clientImports.test.ts).

/** Written as `updatedBy` when the rate came from the automatic fetch, not from an admin. */
export const AUTO_UPDATED_BY = 'auto:exchangerate-api'

export type AutoFetchStatus = {
  ok:    boolean
  at:    string   // ISO timestamp of this attempt
  rate?: number   // raw rate returned by the API, before buffer (only set when ok)
  error?: string  // only set when !ok
}

// ── Which rate is in force, and when there is none ───────────────────────────────────────────────────────────
// A dollar-to-cedi rate is used only when it is a real number above zero. Without one, pages show dollars only (no
// cedi line) and no payment is started (POST /api/payments refuses). Nothing here changes a sum: a usable rate is
// passed on exactly as it was stored.

/** A rate that can be used: a finite number above zero. Anything else (null, NaN, 0, a negative, text) is null. */
export function usableRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** INITIAL_USD_TO_GHS as a rate: a plain decimal number above zero, such as "15.5". Missing, empty, placeholder text,
 *  0 or a negative is null (the preview once had placeholder text there, and pages showed "GH₵ NaN"). */
export function envRate(raw: string | undefined): number | null {
  const text = (raw ?? '').trim()
  return /^\d+(\.\d+)?$/.test(text) ? usableRate(Number(text)) : null
}

/** The rate in force: the newest stored rate when there is one (null if it is not usable), else INITIAL_USD_TO_GHS. */
export function rateInForce(stored: { usdToGhs: number } | null | undefined, raw: string | undefined): number | null {
  return stored ? usableRate(stored.usdToGhs) : envRate(raw)
}

/** What a guest is told when a payment cannot be started because there is no rate to work out the cedis */
export const NO_RATE_TO_CHARGE = 'Payments are paused for a moment: we cannot work out the amount in cedis right now. You have not been charged. Please try again later.'
export const NO_EXCHANGE_RATE = 'NO_EXCHANGE_RATE'

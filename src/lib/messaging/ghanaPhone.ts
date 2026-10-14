// Ghana mobile numbers, for SMS. Pure: nothing here touches the database or
// the network.
//
// Accepted as typed: 0XXXXXXXXX, +233XXXXXXXXX or 233XXXXXXXXX, with spaces,
// dashes, dots or brackets in between. Only mobile ranges are accepted: the
// nine digits after the country code start with 2 or 5 (020-029, 050-059).
// 03x numbers are fixed lines and cannot take an SMS; anything else is not a
// Ghana number at all. "+2330..." (a 0 kept after the country code) is refused
// rather than guessed at.

/** The nine digits after 233 or 0, for a Ghana mobile number. */
const MOBILE = /^[25]\d{8}$/

/**
 * A Ghana mobile number in the form SMS providers take: "233241234567".
 * Null when it is not a valid Ghana mobile number.
 */
export function ghanaMsisdn(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const typed = input.trim()
  if (!/^\+?[\d\s().-]+$/.test(typed)) return null
  const digits = typed.replace(/\D/g, '')
  const plus = typed.startsWith('+')
  let national: string
  if (digits.startsWith('233') && digits.length === 12) national = digits.slice(3)
  else if (!plus && digits.startsWith('0') && digits.length === 10) national = digits.slice(1)
  else return null
  return MOBILE.test(national) ? `233${national}` : null
}

/** "233241234567" (or any form above) as "+233 24 *** **67", for logs and errors. Never the whole number. */
export function maskMsisdn(input: string): string {
  const msisdn = ghanaMsisdn(input)
  if (!msisdn) return '[number]'
  return `+233 ${msisdn.slice(3, 5)} *** **${msisdn.slice(-2)}`
}

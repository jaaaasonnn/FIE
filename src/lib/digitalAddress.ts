// Ghana Post digital addresses (GhanaPostGPS), such as GA-183-8164.
//
// Only the shape is checked here: an area code of two characters (a letter,
// then a letter or a digit), then two groups of three or four digits. Nothing
// here can tell whether a code really exists or where it points; an admin
// looks that up by hand when they check a listing (lib/listingCheckRules.ts).
//
// Pure, so the forms and the server check with the same function.

export const DIGITAL_ADDRESS_EXAMPLE = 'GA-183-8164'
export const DIGITAL_ADDRESS_ERROR = `Enter a Ghana Post digital address like ${DIGITAL_ADDRESS_EXAMPLE}`

export type DigitalAddressResult = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * What someone typed, as the value to store: upper case, with single hyphens,
 * "GA-183-8164". Nothing (null, undefined, an empty string) stores null.
 * Spaces, hyphens and dots between the parts are all accepted, or none at all.
 */
export function parseDigitalAddress(raw: unknown): DigitalAddressResult {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: DIGITAL_ADDRESS_ERROR }
  const text = raw.trim().toUpperCase()
  if (text === '') return { ok: true, value: null }
  if (text.length > 20) return { ok: false, error: DIGITAL_ADDRESS_ERROR }

  // With separators the groups are as typed: GA-183-8164, GW 0012 3456
  const parted = /^([A-Z][A-Z0-9])[\s.-]+(\d{3,4})[\s.-]+(\d{3,4})$/.exec(text)
  if (parted) return { ok: true, value: `${parted[1]}-${parted[2]}-${parted[3]}` }

  // Run together, the digits split evenly, or three then four: GA1838164
  const joined = /^([A-Z][A-Z0-9])[\s.-]*(\d{6,8})$/.exec(text)
  if (joined) {
    const digits = joined[2]
    const first = digits.length === 8 ? 4 : 3
    return { ok: true, value: `${joined[1]}-${digits.slice(0, first)}-${digits.slice(first)}` }
  }
  return { ok: false, error: DIGITAL_ADDRESS_ERROR }
}

/** True for a value already in the stored form. */
export function isDigitalAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9]-\d{3,4}-\d{3,4}$/.test(value)
}

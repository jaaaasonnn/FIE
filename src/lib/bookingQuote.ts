// Works out how long a stay is, and what it costs per unit, from the dates
// and the listing itself. POST /api/bookings uses this instead of any
// length or price sent by the client.

export type QuoteListing = {
  rentalModes: string // JSON array, as stored on Listing
  priceNightly: number | null
  priceMonthly: number | null
  priceAnnual: number | null
  minStayNights: number
}

export type StayQuote =
  | { ok: true; units: number; pricePerUnit: number; checkIn: Date; checkOut: Date }
  | { ok: false; error: string }

const DAY_MS = 86_400_000
// The site sends local-midnight dates, so "today" can be up to a day behind
// the server clock, and a month or year added in the guest's time zone can
// land an hour or so off the same sum done in UTC.
const PAST_GRACE_MS = DAY_MS
const CALENDAR_TOLERANCE_MS = 36 * 3_600_000
const MAX_MONTHS = 11

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function offersMode(listing: QuoteListing, mode: string): boolean {
  try {
    const modes = JSON.parse(listing.rentalModes || '[]')
    return Array.isArray(modes) && modes.includes(mode)
  } catch {
    return false
  }
}

export function quoteStay(
  listing: QuoteListing,
  rentalMode: unknown,
  checkInRaw: unknown,
  checkOutRaw: unknown,
  now: Date = new Date(),
): StayQuote {
  const fail = (error: string): StayQuote => ({ ok: false, error })

  if (rentalMode !== 'SHORT_STAY' && rentalMode !== 'TEMP_STAY' && rentalMode !== 'PERMANENT') {
    return fail('Unknown rental type')
  }
  if (!offersMode(listing, rentalMode)) return fail('This listing does not offer that rental type')

  const checkIn = parseDate(checkInRaw)
  const checkOut = parseDate(checkOutRaw)
  if (!checkIn || !checkOut) return fail('Check-in and check-out must be valid dates')
  if (checkIn.getTime() < now.getTime() - PAST_GRACE_MS) return fail('Check-in cannot be in the past')
  if (checkOut.getTime() <= checkIn.getTime()) return fail('Check-out must be after check-in')

  const days = (checkOut.getTime() - checkIn.getTime()) / DAY_MS
  const near = (expected: Date) => Math.abs(checkOut.getTime() - expected.getTime()) <= CALENDAR_TOLERANCE_MS

  let units: number
  let pricePerUnit: number | null

  if (rentalMode === 'SHORT_STAY') {
    units = Math.round(days)
    if (units < 1) return fail('A stay must be at least one night')
    if (units < listing.minStayNights) return fail(`Minimum stay is ${listing.minStayNights} nights`)
    pricePerUnit = listing.priceNightly
  } else if (rentalMode === 'TEMP_STAY') {
    units = Math.round(days / 30.4375)
    if (units < 1 || units > MAX_MONTHS) return fail(`Monthly stays must be 1 to ${MAX_MONTHS} months`)
    const expected = new Date(checkIn)
    expected.setUTCMonth(expected.getUTCMonth() + units)
    if (!near(expected)) return fail('Monthly stays must be a whole number of months')
    pricePerUnit = listing.priceMonthly
  } else {
    units = 1
    const expected = new Date(checkIn)
    expected.setUTCFullYear(expected.getUTCFullYear() + 1)
    if (!near(expected)) return fail('Long-term rentals are booked one year at a time')
    pricePerUnit = listing.priceAnnual
  }

  if (pricePerUnit == null || !Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
    return fail('This listing has no price set for that rental type')
  }

  return { ok: true, units, pricePerUnit, checkIn, checkOut }
}

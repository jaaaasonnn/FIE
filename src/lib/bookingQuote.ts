// Works out how long a stay is, and what it costs per unit, from the dates
// and the listing itself. POST /api/bookings uses this instead of any
// length or price sent by the client.

import { parseDay } from '@/lib/hostCalendar'
import { addMonthsClamped, addYearClamped, daysBetween, ghanaToday } from '@/lib/stayDates'

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

const MAX_MONTHS = 11
// Anything with a time in it, such as 2027-03-09T00:00:00.000Z
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/

export const STALE_PAGE_ERROR = 'This page is out of date. Please refresh the page and choose your dates again.'

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

  // Dates arrive as calendar days ("2027-03-09"). An exact moment, which is
  // what older copies of the page sent, would shift between time zones.
  if (typeof checkInRaw !== 'string' || typeof checkOutRaw !== 'string') {
    return fail('Check-in and check-out must be valid dates')
  }
  if (TIMESTAMP_RE.test(checkInRaw) || TIMESTAMP_RE.test(checkOutRaw)) return fail(STALE_PAGE_ERROR)
  const checkIn = parseDay(checkInRaw)
  const checkOut = parseDay(checkOutRaw)
  if (!checkIn || !checkOut) return fail('Check-in and check-out must be valid dates')
  // "Today" is today in Ghana, where the homes are
  if (checkInRaw < ghanaToday(now)) return fail('Check-in cannot be in the past')
  if (checkOut.getTime() <= checkIn.getTime()) return fail('Check-out must be after check-in')

  let units: number
  let pricePerUnit: number | null

  if (rentalMode === 'SHORT_STAY') {
    units = daysBetween(checkIn, checkOut)
    if (units < listing.minStayNights) return fail(`Minimum stay is ${listing.minStayNights} nights`)
    pricePerUnit = listing.priceNightly
  } else if (rentalMode === 'TEMP_STAY') {
    units = 0
    for (let months = 1; months <= MAX_MONTHS; months++) {
      if (addMonthsClamped(checkIn, months).getTime() === checkOut.getTime()) units = months
    }
    if (units === 0) {
      const tooLong = checkOut.getTime() > addMonthsClamped(checkIn, MAX_MONTHS).getTime()
      return fail(tooLong ? `Monthly stays must be 1 to ${MAX_MONTHS} months` : 'Monthly stays must be a whole number of months')
    }
    pricePerUnit = listing.priceMonthly
  } else {
    units = 1
    if (addYearClamped(checkIn).getTime() !== checkOut.getTime()) {
      return fail('Long-term rentals are booked one year at a time')
    }
    pricePerUnit = listing.priceAnnual
  }

  if (pricePerUnit == null || !Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
    return fail('This listing has no price set for that rental type')
  }

  return { ok: true, units, pricePerUnit, checkIn, checkOut }
}

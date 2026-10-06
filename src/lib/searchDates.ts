// Turns the dates a guest searches with into the range of nights to check,
// and into the database conditions that leave out listings taken on any of
// those nights. Days are compared at midday UTC, as the host calendar does,
// so a stay stored at any guest's local midnight is matched correctly.

import { HOST_BLOCK, dayKey, parseDay } from '@/lib/hostCalendar'

const DAY_MS = 86_400_000
export const MAX_SEARCH_NIGHTS = 366
export const MAX_SEARCH_MONTHS = 11

/** Bookings in these states do not take dates. Same rule as the booking route. */
export const FREE_STATUSES = ['CANCELLED', 'DECLINED']

export type SearchRange =
  | { ok: true; checkIn: string; checkOut: string; nights: number; firstNight: Date; lastNight: Date }
  | { ok: false; error: string }

/**
 * checkIn / checkOut are "YYYY-MM-DD". What the range covers depends on the
 * rental type:
 *  - Short Stay (or no type): check-in to check-out. Check-in alone is one night.
 *  - Monthly: `months` calendar months from the move-in date (1 to 11, default 1).
 *  - Long-Term: one year from the move-in date.
 */
export function parseSearchRange(
  input: { checkIn: unknown; checkOut?: unknown; months?: unknown; mode?: unknown },
  now: Date = new Date(),
): SearchRange {
  const fail = (error: string): SearchRange => ({ ok: false, error })

  const start = parseDay(input.checkIn)
  if (!start) return fail('The check-in date must be a real date in the form YYYY-MM-DD')
  const today = parseDay(dayKey(now))!
  if (start.getTime() < today.getTime()) return fail('The check-in date cannot be in the past')

  let end: Date
  if (input.mode === 'TEMP_STAY') {
    const months = input.months === undefined || input.months === null || input.months === '' ? 1 : Number(input.months)
    if (!Number.isInteger(months) || months < 1 || months > MAX_SEARCH_MONTHS) {
      return fail(`Monthly stays are 1 to ${MAX_SEARCH_MONTHS} months`)
    }
    end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + months)
  } else if (input.mode === 'PERMANENT') {
    end = new Date(start)
    end.setUTCFullYear(end.getUTCFullYear() + 1)
  } else if (input.checkOut === undefined || input.checkOut === null || input.checkOut === '') {
    end = new Date(start.getTime() + DAY_MS)
  } else {
    const parsed = parseDay(input.checkOut)
    if (!parsed) return fail('The check-out date must be a real date in the form YYYY-MM-DD')
    if (parsed.getTime() <= start.getTime()) return fail('The check-out date must be after the check-in date')
    end = parsed
  }

  const nights = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  if (nights > MAX_SEARCH_NIGHTS) return fail('You can search for stays of up to one year')

  return {
    ok: true,
    checkIn: dayKey(start),
    checkOut: dayKey(end),
    nights,
    firstNight: start,
    // The last night slept is the day before check-out
    lastNight: new Date(end.getTime() - DAY_MS),
  }
}

/**
 * Prisma conditions for "free on every night of the range": no stay that takes
 * dates covers any of the nights, and the host has not blocked any of them.
 * A stay ending on the search's first day does not clash.
 */
export function availabilityWhere(range: { firstNight: Date; lastNight: Date }) {
  return [
    {
      bookings: {
        none: {
          status: { notIn: FREE_STATUSES },
          checkIn: { lte: range.lastNight },
          checkOut: { gt: range.firstNight },
        },
      },
    },
    {
      blockedDates: {
        none: { reason: HOST_BLOCK, date: { gte: range.firstNight, lte: range.lastNight } },
      },
    },
  ]
}

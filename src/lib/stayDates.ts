// A stay's check-in and check-out are calendar days, not moments. They are
// sent between the page and the server as "YYYY-MM-DD" and stored at 12:00 UTC
// of that day (the same rule as a host's blocked days), so every time zone
// reads the same date. Ghana is on UTC all year, so the UTC day is also the
// day at the property.

import { dayKey, parseDay } from '@/lib/hostCalendar'

export const DAY_MS = 86_400_000

/** Today's date in Ghana, as "2027-03-09". */
export function ghanaToday(now: Date = new Date()): string {
  return dayKey(now)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The day a guest clicked in a date picker (a local-midnight Date) as "2027-03-09". */
export function toDayKey(picked: Date): string {
  return `${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`
}

/** "2027-03-09" as the Date a date picker shows for that day, or null if it is not a real date. */
export function fromDayKey(key: string | null | undefined): Date | null {
  if (!parseDay(key)) return null
  const [y, m, d] = key!.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Moves a day key by a number of days. */
export function addDays(key: string, days: number): string {
  return dayKey(new Date(parseDay(key)!.getTime() + days * DAY_MS))
}

/**
 * Calendar months after a stored (12:00 UTC) day. A day the target month does
 * not have falls back to its last day: 31 January plus one month is 28 February.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay), 12))
}

/** One year after a stored day. 29 February lands on 28 February. */
export function addYearClamped(date: Date): Date {
  return addMonthsClamped(date, 12)
}

/** Whole days between two stored days. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

/** A stored stay date for display, the same in every time zone. */
export function formatStayDate(value: string | Date, options: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString('en-GH', { ...options, timeZone: 'UTC' })
}

// ── Date picker rules ────────────────────────────────────────────────────

/**
 * The nights that are taken, as day keys. A stay takes each night from its
 * check-in day up to the day before check-out, so the check-out day itself
 * stays free for the next guest to arrive.
 */
export function takenNights(stays: { start: string; end: string }[], blockedDays: string[]): Set<string> {
  const taken = new Set<string>(blockedDays)
  for (const stay of stays) {
    for (let day = stay.start; day < stay.end; day = addDays(day, 1)) taken.add(day)
  }
  return taken
}

/**
 * The latest day a guest can check out after arriving on `checkIn`: the first
 * taken night after it (leaving that morning is fine), or null if nothing is
 * taken within `horizonDays`.
 */
export function lastCheckOut(checkIn: string, taken: Set<string>, horizonDays = 800): string | null {
  let day = checkIn
  for (let i = 0; i < horizonDays; i++) {
    day = addDays(day, 1)
    if (taken.has(day)) return day
  }
  return null
}

/** True when every night from check-in up to (not including) check-out is free. */
export function nightsAreFree(checkIn: string, checkOut: string, taken: Set<string>): boolean {
  for (let day = checkIn; day < checkOut; day = addDays(day, 1)) {
    if (taken.has(day)) return false
  }
  return true
}

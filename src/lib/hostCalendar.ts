// Rules for dates a host blocks on their own listing.
//
// A host block is one BlockedDate row per calendar day with reason HOST,
// stored at 12:00 UTC of that day. Midday is deliberate: a guest's stay is
// sent as local midnights, so a block at midday still falls inside the stay
// for a browser up to twelve hours either side of UTC, and the booking
// route's existing "any blocked date inside the stay" check catches it.

export const HOST_BLOCK = 'HOST'
export const GUEST_BLOCK = 'BOOKED'
export const MAX_BLOCK_DAYS = 365
export const MAX_DAYS_AHEAD = 730
export const MAX_NOTE_LENGTH = 200

const DAY_MS = 86_400_000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** "2027-03-09" to that day at 12:00 UTC, or null if it is not a real date. */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const m = DAY_RE.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d, 12))
  // Reject overflow such as 2027-02-31
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

/** The UTC calendar day of a stored date, as "2027-03-09". */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export type DayRange =
  | { ok: true; start: Date; end: Date; days: Date[] }
  | { ok: false; error: string }

/**
 * Validates an inclusive start-to-end range of days.
 * `forBlocking` adds the rules that only apply when creating blocks: no past
 * days and nothing more than two years ahead. Unblocking has neither.
 */
export function parseDayRange(startRaw: unknown, endRaw: unknown, opts: { forBlocking: boolean; now?: Date }): DayRange {
  const start = parseDay(startRaw)
  const end = parseDay(endRaw ?? startRaw)
  if (!start || !end) return { ok: false, error: 'Dates must be real calendar dates in the form YYYY-MM-DD' }
  if (end.getTime() < start.getTime()) return { ok: false, error: 'The end date must be on or after the start date' }

  const count = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1
  if (count > MAX_BLOCK_DAYS) return { ok: false, error: `You can change at most ${MAX_BLOCK_DAYS} days at a time` }

  if (opts.forBlocking) {
    const now = opts.now ?? new Date()
    const today = parseDay(dayKey(now))!
    if (start.getTime() < today.getTime()) return { ok: false, error: 'You cannot block dates in the past' }
    if (end.getTime() > today.getTime() + MAX_DAYS_AHEAD * DAY_MS) {
      return { ok: false, error: 'You can block dates up to two years ahead' }
    }
  }

  const days = Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * DAY_MS))
  return { ok: true, start, end, days }
}

/** Trims a note, turning empty into null. Returns an error string when too long or not text. */
export function parseNote(value: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, note: null }
  if (typeof value !== 'string') return { ok: false, error: 'The note must be text' }
  const note = value.trim()
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: `The note can be at most ${MAX_NOTE_LENGTH} characters` }
  return { ok: true, note: note || null }
}

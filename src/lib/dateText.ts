// Dates as people read them, from our own month and weekday names: never the runtime's locale data.
//
// SU5: a page drawn on the server and then in the browser must produce the same text, or React throws the
// server's copy away (error 418). Locale data differs between runtimes: Node's ICU, Chromium and Firefox
// write September short as "Sept", Safari "Sep". So no date text is built with toLocaleDateString or with
// Intl's month or weekday names. Intl is used, where a time zone is asked for, for numbers only.
// Imports nothing, so client and server files can use it.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Sep", "September" */
export const monthName = (month: number, length: 'short' | 'long') => (length === 'long' ? MONTHS[month - 1] : MONTHS[month - 1].slice(0, 3))
/** "Mon", "Monday" */
export const weekdayName = (weekday: number, length: 'short' | 'long') => (length === 'long' ? WEEKDAYS[weekday] : WEEKDAYS[weekday].slice(0, 3))

/** Which parts to write. The order and punctuation are fixed: "Mon, 6 September 2027", "6 Sep", "September 2027", "Sunday". */
export type DayFormat = {
  weekday?: 'short' | 'long'
  day?: 'numeric'
  month?: 'short' | 'long'
  year?: 'numeric'
}

/** The calendar day of a moment, as numbers. `zone`: an IANA zone, or 'local' for the runtime's own. */
export function dayOf(value: string | Date, zone: string = 'UTC'): { year: number; month: number; day: number; weekday: number } {
  const date = new Date(value)
  let year: number, month: number, day: number
  if (zone === 'UTC') {
    year = date.getUTCFullYear(); month = date.getUTCMonth() + 1; day = date.getUTCDate()
  } else if (zone === 'local') {
    year = date.getFullYear(); month = date.getMonth() + 1; day = date.getDate()
  } else {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date)
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    year = part('year'); month = part('month'); day = part('day')
  }
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() }
}

/**
 * A day as text: "Mon, 6 September 2027", "6 Sep 2027", "6 Sep", "September 2027". The same in Node and in
 * every browser. `zone` defaults to UTC, which is Ghana time all year and how stays are stored.
 */
export function formatDay(value: string | Date, format: DayFormat, zone: string = 'UTC'): string {
  const d = dayOf(value, zone)
  const body = [format.day ? String(d.day) : '', format.month ? monthName(d.month, format.month) : '', format.year ? String(d.year) : ''].filter(Boolean).join(' ')
  if (!format.weekday) return body
  return body ? `${weekdayName(d.weekday, format.weekday)}, ${body}` : weekdayName(d.weekday, format.weekday)
}

/** "06/09/2027" */
export function formatDayNumeric(value: string | Date, zone: string = 'UTC'): string {
  const d = dayOf(value, zone)
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`
}

/** A moment as text: "6 Sep 2027, 3:45 pm", in `zone` (UTC by default, or 'local'). */
export function formatMoment(value: string | Date, zone: string = 'UTC'): string {
  const date = new Date(value)
  let hour: number, minute: number
  if (zone === 'UTC') { hour = date.getUTCHours(); minute = date.getUTCMinutes() }
  else if (zone === 'local') { hour = date.getHours(); minute = date.getMinutes() }
  else {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date)
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    hour = part('hour') % 24; minute = part('minute')
  }
  return `${formatDay(date, { day: 'numeric', month: 'short', year: 'numeric' }, zone)}, ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`
}

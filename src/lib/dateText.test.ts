import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { formatDay, formatDayNumeric, formatMoment } from './dateText'
import { formatStayDate } from './stayDates'
import { formatPayBy } from './payDeadline'

// SU5: date text is built from our own names, so Node (the server's copy of a page) and every browser write
// the same: September is "Sep" everywhere (Node, Chromium and Firefox say "Sept", Safari "Sep"), and React
// keeps the server's page. Every month, in the six zones `npm run test:tz` runs in, given as the reader's zone,
// and in the process's own zone.

const ZONES = ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Africa/Accra', 'Pacific/Auckland']
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// The 15th of each month of 2027, at noon UTC (as stays are stored), and its weekday
const MONTHS = LONG.map((_, i) => ({ i, noon: new Date(Date.UTC(2027, i, 15, 12)), weekday: new Date(Date.UTC(2027, i, 15)).toUTCString().slice(0, 3) }))
const WEEKDAY_LONG: Record<string, string> = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' }

describe('stay dates read the same in Node and every browser, every month', () => {
  it.each(MONTHS)('month $i: every format formatStayDate is asked for', ({ i, noon, weekday }) => {
    expect(formatStayDate(noon, { day: 'numeric', month: 'short' })).toBe(`15 ${SHORT[i]}`)
    expect(formatStayDate(noon, { day: 'numeric', month: 'short', year: 'numeric' })).toBe(`15 ${SHORT[i]} 2027`)
    expect(formatStayDate(noon, { day: 'numeric', month: 'long', year: 'numeric' })).toBe(`15 ${LONG[i]} 2027`)
    expect(formatStayDate(noon, { weekday: 'short', day: 'numeric', month: 'long' })).toBe(`${weekday}, 15 ${LONG[i]}`)
    expect(formatStayDate(noon, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })).toBe(`${WEEKDAY_LONG[weekday]}, 15 ${LONG[i]} 2027`)
    expect(formatStayDate(noon, { month: 'long', year: 'numeric' })).toBe(`${LONG[i]} 2027`)
    expect(formatDay(noon, { month: 'short', year: 'numeric' })).toBe(`${SHORT[i]} 2027`)
    expect(formatDayNumeric(noon)).toBe(`15/${String(i + 1).padStart(2, '0')}/2027`)
    expect(formatMoment(new Date(Date.UTC(2027, i, 15, 0, 5)))).toBe(`15 ${SHORT[i]} 2027, 12:05 am`)
  })

  for (const zone of ZONES) {
    it.each(MONTHS)(`in ${zone}, month $i: the day in that zone, with our names`, ({ i, weekday }) => {
      // 10:00 UTC on the 15th is the 15th in every one of these zones (Auckland 22:00 or 23:00, Los Angeles 02:00 or 03:00)
      const at = new Date(Date.UTC(2027, i, 15, 10))
      expect(formatDay(at, { day: 'numeric', month: 'short', year: 'numeric' }, zone)).toBe(`15 ${SHORT[i]} 2027`)
      expect(formatDay(at, { weekday: 'long', day: 'numeric', month: 'long' }, zone)).toBe(`${WEEKDAY_LONG[weekday]}, 15 ${LONG[i]}`)
      expect(formatPayBy(at, new Date(Date.UTC(2030, 0, 1)), zone)).toMatch(new RegExp(`^${weekday} 15 ${SHORT[i]}, \\d{1,2}:00 [ap]m$`))
      // Stay dates do not depend on the zone at all
      expect(formatStayDate(at, { day: 'numeric', month: 'short' })).toBe(`15 ${SHORT[i]}`)
    })
  }

  it.each(MONTHS)('in the process\'s own zone (TZ), month $i', ({ i }) => {
    const local = new Date(2027, i, 15, 9, 30)
    expect(formatDay(local, { day: 'numeric', month: 'short' }, 'local')).toBe(`15 ${SHORT[i]}`)
    expect(formatMoment(local, 'local')).toBe(`15 ${SHORT[i]} 2027, 9:30 am`)
    expect(formatPayBy(local, new Date(2030, 0, 1))).toMatch(new RegExp(`15 ${SHORT[i]}, 9:30 am$`))
  })
})

describe('no date text from the runtime\'s locale data', () => {
  // A guard for the next date written in a page: it would differ between Node and Safari again
  const SRC = path.join(__dirname, '..')
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [])

  it('no toLocaleDateString, toLocaleTimeString, or toLocaleString on a date, and Intl only for numbers', () => {
    const found: string[] = []
    for (const file of files(SRC)) {
      const text = fs.readFileSync(file, 'utf8')
      const rel = path.relative(SRC, file)
      if (/toLocale(Date|Time)String\(/.test(text)) found.push(`${rel}: toLocaleDateString/TimeString`)
      if (/new Date\([^)]*\)\.toLocaleString\(/.test(text)) found.push(`${rel}: a date's toLocaleString`)
      for (const m of text.matchAll(/Intl\.DateTimeFormat\([^)]*\{([^}]*)\}/g)) {
        if (/\b(month|weekday)\s*:\s*'(short|long|narrow)'|dayPeriod|timeStyle|dateStyle/.test(m[1])) found.push(`${rel}: Intl date names`)
      }
      if (/\.toLocaleString\(\)/.test(text)) found.push(`${rel}: toLocaleString() with no locale`)
    }
    expect(found).toEqual([])
  })
})

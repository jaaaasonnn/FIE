import { describe, it, expect } from 'vitest'
import {
  addDays, addMonthsClamped, addYearClamped, daysBetween, formatStayDate, fromDayKey,
  ghanaToday, lastCheckOut, nightsAreFree, takenNights, toDayKey,
} from './stayDates'
import { parseDay } from './hostCalendar'

// These run under several time zones (npm run test:tz). Nothing here may
// depend on the zone the test machine is in.
const noon = (key: string) => parseDay(key)!
const iso = (d: Date) => d.toISOString()

describe('day keys and the date picker', () => {
  it('reads the day a guest clicked, whatever the time zone', () => {
    // A picker hands back local midnight of the clicked day
    expect(toDayKey(new Date(2027, 2, 9))).toBe('2027-03-09')
    expect(toDayKey(new Date(2027, 0, 1))).toBe('2027-01-01')
    expect(toDayKey(new Date(2027, 11, 31))).toBe('2027-12-31')
  })

  it('round-trips through the picker on clock-change days', () => {
    for (const key of ['2027-03-14', '2027-03-28', '2027-04-04', '2027-09-26', '2027-10-31', '2027-11-07']) {
      expect(toDayKey(fromDayKey(key)!)).toBe(key)
    }
  })

  it('shows a stored day back on the same day in the picker', () => {
    const picked = fromDayKey('2027-03-09')!
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2027, 2, 9])
    expect(fromDayKey('2027-02-30')).toBeNull()
    expect(fromDayKey('2027-03-09T00:00:00Z')).toBeNull()
    expect(fromDayKey(null)).toBeNull()
  })

  it('sends the same stored value for the same clicked day', () => {
    // What the page sends and what the server stores
    expect(iso(noon(toDayKey(new Date(2027, 6, 18))))).toBe('2027-07-18T12:00:00.000Z')
  })

  it('moves by whole days across clock changes and month ends', () => {
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29')
    expect(addDays('2027-10-30', 2)).toBe('2027-11-01')
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(daysBetween(noon('2027-03-27'), noon('2027-03-29'))).toBe(2)
    expect(daysBetween(noon('2027-10-20'), noon('2028-10-20'))).toBe(366)
  })
})

describe('today in Ghana', () => {
  it('is the UTC date at any hour', () => {
    expect(ghanaToday(new Date('2027-01-10T00:00:00Z'))).toBe('2027-01-10')
    expect(ghanaToday(new Date('2027-01-10T23:59:59Z'))).toBe('2027-01-10')
    expect(ghanaToday(new Date('2027-01-11T00:00:00Z'))).toBe('2027-01-11')
  })
})

describe('calendar months and years', () => {
  it('keeps the day of the month when it exists', () => {
    expect(iso(addMonthsClamped(noon('2027-02-01'), 3))).toBe('2027-05-01T12:00:00.000Z')
    expect(iso(addMonthsClamped(noon('2027-11-15'), 3))).toBe('2028-02-15T12:00:00.000Z')
  })

  it('falls back to the last day of a shorter month', () => {
    expect(iso(addMonthsClamped(noon('2027-01-31'), 1))).toBe('2027-02-28T12:00:00.000Z')
    expect(iso(addMonthsClamped(noon('2028-01-31'), 1))).toBe('2028-02-29T12:00:00.000Z')
    expect(iso(addMonthsClamped(noon('2027-03-31'), 1))).toBe('2027-04-30T12:00:00.000Z')
    expect(iso(addMonthsClamped(noon('2027-08-31'), 6))).toBe('2028-02-29T12:00:00.000Z')
  })

  it('adds one year, with 29 February landing on 28 February', () => {
    expect(iso(addYearClamped(noon('2026-10-21')))).toBe('2027-10-21T12:00:00.000Z')
    expect(iso(addYearClamped(noon('2028-02-29')))).toBe('2029-02-28T12:00:00.000Z')
  })
})

describe('formatStayDate', () => {
  it('shows the stored calendar day in every time zone', () => {
    const opts = { day: 'numeric', month: 'short', year: 'numeric' } as const
    expect(formatStayDate('2027-07-18T12:00:00.000Z', opts)).toMatch(/18.*Jul.*2027/)
    expect(formatStayDate(noon('2027-01-01'), opts)).toMatch(/1.*Jan.*2027/)
    expect(formatStayDate('2027-12-31T12:00:00.000Z', opts)).toMatch(/31.*Dec.*2027/)
    expect(formatStayDate('2027-07-18T12:00:00.000Z', { weekday: 'long' })).toBe('Sunday')
  })
})

describe('date picker rules', () => {
  const taken = takenNights([{ start: '2027-07-18', end: '2027-07-22' }], ['2027-07-25'])

  it('takes the nights of a stay but leaves its check-out day free', () => {
    expect([...taken].sort()).toEqual(['2027-07-18', '2027-07-19', '2027-07-20', '2027-07-21', '2027-07-25'])
    expect(taken.has('2027-07-22')).toBe(false)
  })

  it('lets a guest check out on the day another guest checks in', () => {
    expect(lastCheckOut('2027-07-15', taken)).toBe('2027-07-18')
    expect(nightsAreFree('2027-07-15', '2027-07-18', taken)).toBe(true)
    expect(nightsAreFree('2027-07-15', '2027-07-19', taken)).toBe(false)
  })

  it('lets a guest arrive on the day another guest checks out', () => {
    expect(nightsAreFree('2027-07-22', '2027-07-25', taken)).toBe(true)
    expect(lastCheckOut('2027-07-22', taken)).toBe('2027-07-25')
    expect(nightsAreFree('2027-07-22', '2027-07-26', taken)).toBe(false)
  })

  it('has no limit when nothing is taken ahead', () => {
    expect(lastCheckOut('2027-07-26', taken)).toBeNull()
    expect(nightsAreFree('2027-07-26', '2027-08-26', taken)).toBe(true)
  })
})

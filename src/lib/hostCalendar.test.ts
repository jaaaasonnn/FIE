import { describe, it, expect } from 'vitest'
import { parseDay, dayKey, parseDayRange, parseNote } from './hostCalendar'

const now = new Date('2027-01-10T08:00:00Z')
const block = (a: unknown, b?: unknown) => parseDayRange(a, b, { forBlocking: true, now })

describe('parseDay', () => {
  it('reads a day as midday UTC', () => {
    expect(parseDay('2027-03-09')?.toISOString()).toBe('2027-03-09T12:00:00.000Z')
    expect(dayKey(parseDay('2027-03-09')!)).toBe('2027-03-09')
  })
  it('rejects anything that is not a real date', () => {
    for (const bad of ['2027-02-31', '2027-13-01', '09/03/2027', '2027-3-9', '', null, 20270309, '2027-03-09T00:00:00Z']) {
      expect(parseDay(bad)).toBeNull()
    }
  })
})

describe('parseDayRange for blocking', () => {
  it('accepts a single day and an inclusive range', () => {
    expect(block('2027-01-10')).toMatchObject({ ok: true })
    const r = block('2027-02-01', '2027-02-03')
    expect(r.ok && r.days.map(dayKey)).toEqual(['2027-02-01', '2027-02-02', '2027-02-03'])
  })
  it('refuses past days but allows today', () => {
    expect(block('2027-01-09')).toMatchObject({ ok: false, error: 'You cannot block dates in the past' })
    expect(block('2027-01-10').ok).toBe(true)
  })
  it('refuses an inverted range, more than 365 days, and more than two years ahead', () => {
    expect(block('2027-02-03', '2027-02-01').ok).toBe(false)
    expect(block('2027-02-01', '2028-02-01')).toMatchObject({ ok: false, error: 'You can change at most 365 days at a time' })
    expect(block('2027-02-01', '2028-01-31').ok).toBe(true)
    expect(block('2029-01-11')).toMatchObject({ ok: false, error: 'You can block dates up to two years ahead' })
    expect(block('2029-01-09').ok).toBe(true)
  })
})

describe('parseDayRange for unblocking', () => {
  it('allows past days', () => {
    expect(parseDayRange('2026-12-01', '2026-12-05', { forBlocking: false, now }).ok).toBe(true)
  })
})

describe('parseNote', () => {
  it('trims, empties to null, and caps the length', () => {
    expect(parseNote('  Family visiting  ')).toEqual({ ok: true, note: 'Family visiting' })
    expect(parseNote('')).toEqual({ ok: true, note: null })
    expect(parseNote('   ')).toEqual({ ok: true, note: null })
    expect(parseNote('x'.repeat(201)).ok).toBe(false)
    expect(parseNote(42).ok).toBe(false)
  })
})

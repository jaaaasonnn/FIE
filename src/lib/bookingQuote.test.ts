import { describe, it, expect } from 'vitest'
import { quoteStay, STALE_PAGE_ERROR, type QuoteListing } from './bookingQuote'

const NOW = new Date('2027-01-10T12:00:00Z')
const listing: QuoteListing = {
  rentalModes: '["SHORT_STAY","TEMP_STAY","PERMANENT"]',
  priceNightly: 80, priceMonthly: 900, priceAnnual: 9600, minStayNights: 2,
}
const q = (mode: unknown, a: unknown, b: unknown, l = listing, now = NOW) => quoteStay(l, mode, a, b, now)
const iso = (d: Date) => d.toISOString()

describe('quoteStay', () => {
  it('counts nights from the dates', () => {
    expect(q('SHORT_STAY', '2027-02-01', '2027-02-06')).toMatchObject({ ok: true, units: 5, pricePerUnit: 80 })
  })

  it('stores each date at 12:00 UTC of the calendar day', () => {
    const r = q('SHORT_STAY', '2027-02-01', '2027-02-06')
    expect(r.ok && iso(r.checkIn)).toBe('2027-02-01T12:00:00.000Z')
    expect(r.ok && iso(r.checkOut)).toBe('2027-02-06T12:00:00.000Z')
  })

  it('counts nights exactly across the clock changes in the UK and the US', () => {
    // 28 March 2027 (UK) and 14 March 2027 (US) are 23-hour days there
    expect(q('SHORT_STAY', '2027-03-27', '2027-03-29')).toMatchObject({ ok: true, units: 2 })
    expect(q('SHORT_STAY', '2027-03-13', '2027-03-16')).toMatchObject({ ok: true, units: 3 })
    // 31 October 2027 (UK) and 7 November 2027 (US) are 25-hour days
    expect(q('SHORT_STAY', '2027-10-30', '2027-11-01')).toMatchObject({ ok: true, units: 2 })
    expect(q('SHORT_STAY', '2027-11-06', '2027-11-09')).toMatchObject({ ok: true, units: 3 })
  })

  it('counts whole calendar months', () => {
    expect(q('TEMP_STAY', '2027-02-01', '2027-05-01')).toMatchObject({ ok: true, units: 3, pricePerUnit: 900 })
    expect(q('TEMP_STAY', '2027-03-15', '2028-02-15')).toMatchObject({ ok: true, units: 11 })
  })

  it('ends a monthly stay on the last day of a shorter month', () => {
    expect(q('TEMP_STAY', '2027-01-31', '2027-02-28')).toMatchObject({ ok: true, units: 1 })
    expect(q('TEMP_STAY', '2028-01-31', '2028-02-29')).toMatchObject({ ok: true, units: 1 })
    expect(q('TEMP_STAY', '2027-01-31', '2027-04-30')).toMatchObject({ ok: true, units: 3 })
    expect(q('TEMP_STAY', '2027-01-31', '2027-03-03')).toMatchObject({ ok: false, error: 'Monthly stays must be a whole number of months' })
  })

  it('prices a long-term rental as one year', () => {
    expect(q('PERMANENT', '2027-02-01', '2028-02-01')).toMatchObject({ ok: true, units: 1, pricePerUnit: 9600 })
    expect(q('PERMANENT', '2028-02-29', '2029-02-28')).toMatchObject({ ok: true, units: 1 })
  })

  it('rejects missing, invalid, past and inverted dates', () => {
    expect(q('SHORT_STAY', undefined, '2027-02-06').ok).toBe(false)
    expect(q('SHORT_STAY', 'not a date', '2027-02-06').ok).toBe(false)
    expect(q('SHORT_STAY', '2027-02-30', '2027-03-06').ok).toBe(false)
    expect(q('SHORT_STAY', 1801526400000, '2027-02-06').ok).toBe(false)
    expect(q('SHORT_STAY', '2027-01-05', '2027-01-08')).toMatchObject({ ok: false, error: 'Check-in cannot be in the past' })
    expect(q('SHORT_STAY', '2027-02-06', '2027-02-01')).toMatchObject({ ok: false, error: 'Check-out must be after check-in' })
    expect(q('SHORT_STAY', '2027-02-06', '2027-02-06').ok).toBe(false)
  })

  it('tells a guest on an old copy of the page to refresh', () => {
    expect(q('SHORT_STAY', '2027-02-01T00:00:00.000Z', '2027-02-06T00:00:00.000Z')).toEqual({ ok: false, error: STALE_PAGE_ERROR })
    expect(q('SHORT_STAY', '2027-02-01', '2027-02-05T23:00:00.000Z')).toEqual({ ok: false, error: STALE_PAGE_ERROR })
    expect(STALE_PAGE_ERROR).toMatch(/refresh the page/)
  })

  it('treats today as today in Ghana, whatever the hour', () => {
    const lateEvening = new Date('2027-01-10T23:30:00Z')
    const justAfterMidnight = new Date('2027-01-11T00:30:00Z')
    expect(q('SHORT_STAY', '2027-01-10', '2027-01-13', listing, lateEvening).ok).toBe(true)
    expect(q('SHORT_STAY', '2027-01-10', '2027-01-13', listing, justAfterMidnight)).toMatchObject({ ok: false, error: 'Check-in cannot be in the past' })
    expect(q('SHORT_STAY', '2027-01-11', '2027-01-13', listing, justAfterMidnight).ok).toBe(true)
  })

  it('enforces the minimum stay and the month limits', () => {
    expect(q('SHORT_STAY', '2027-02-01', '2027-02-02')).toMatchObject({ ok: false, error: 'Minimum stay is 2 nights' })
    expect(q('TEMP_STAY', '2027-02-01', '2028-02-01')).toMatchObject({ ok: false, error: 'Monthly stays must be 1 to 11 months' })
    expect(q('TEMP_STAY', '2027-02-01', '2027-03-15')).toMatchObject({ ok: false, error: 'Monthly stays must be a whole number of months' })
    expect(q('PERMANENT', '2027-02-01', '2029-02-01').ok).toBe(false)
    expect(q('PERMANENT', '2027-02-01', '2028-01-31').ok).toBe(false)
  })

  it('rejects a rental type the listing does not offer or has no price for', () => {
    expect(q('TEMP_STAY', '2027-02-01', '2027-03-01', { ...listing, rentalModes: '["SHORT_STAY"]' }).ok).toBe(false)
    expect(q('SHORT_STAY', '2027-02-01', '2027-02-06', { ...listing, priceNightly: null }).ok).toBe(false)
    expect(q('SHORT_STAY', '2027-02-01', '2027-02-06', { ...listing, priceNightly: 0 }).ok).toBe(false)
    expect(q('ADMIN', '2027-02-01', '2027-02-06').ok).toBe(false)
  })
})

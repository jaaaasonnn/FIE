import { describe, it, expect } from 'vitest'
import { quoteStay, type QuoteListing } from './bookingQuote'

const NOW = new Date('2027-01-10T12:00:00Z')
const listing: QuoteListing = {
  rentalModes: '["SHORT_STAY","TEMP_STAY","PERMANENT"]',
  priceNightly: 80, priceMonthly: 900, priceAnnual: 9600, minStayNights: 2,
}
const q = (mode: unknown, a: unknown, b: unknown, l = listing) => quoteStay(l, mode, a, b, NOW)

describe('quoteStay', () => {
  it('counts nights from the dates', () => {
    expect(q('SHORT_STAY', '2027-02-01T00:00:00Z', '2027-02-06T00:00:00Z')).toMatchObject({ ok: true, units: 5, pricePerUnit: 80 })
  })
  it('counts whole months, including across a short month and an hour of clock change', () => {
    expect(q('TEMP_STAY', '2027-02-01T00:00:00Z', '2027-05-01T00:00:00Z')).toMatchObject({ ok: true, units: 3, pricePerUnit: 900 })
    expect(q('TEMP_STAY', '2027-03-01T05:00:00Z', '2027-04-01T04:00:00Z')).toMatchObject({ ok: true, units: 1 })
  })
  it('prices a long-term rental as one year', () => {
    expect(q('PERMANENT', '2027-02-01T00:00:00Z', '2028-02-01T00:00:00Z')).toMatchObject({ ok: true, units: 1, pricePerUnit: 9600 })
  })
  it('rejects missing, invalid, past and inverted dates', () => {
    expect(q('SHORT_STAY', undefined, '2027-02-06T00:00:00Z').ok).toBe(false)
    expect(q('SHORT_STAY', 'not a date', '2027-02-06T00:00:00Z').ok).toBe(false)
    expect(q('SHORT_STAY', '2027-01-05T00:00:00Z', '2027-01-08T00:00:00Z')).toMatchObject({ ok: false, error: 'Check-in cannot be in the past' })
    expect(q('SHORT_STAY', '2027-02-06T00:00:00Z', '2027-02-01T00:00:00Z')).toMatchObject({ ok: false, error: 'Check-out must be after check-in' })
    expect(q('SHORT_STAY', '2027-02-06T00:00:00Z', '2027-02-06T00:00:00Z').ok).toBe(false)
  })
  it('allows check-in today', () => {
    expect(q('SHORT_STAY', '2027-01-10T00:00:00Z', '2027-01-13T00:00:00Z').ok).toBe(true)
  })
  it('enforces the minimum stay and the month limits', () => {
    expect(q('SHORT_STAY', '2027-02-01T00:00:00Z', '2027-02-02T00:00:00Z')).toMatchObject({ ok: false, error: 'Minimum stay is 2 nights' })
    expect(q('TEMP_STAY', '2027-02-01T00:00:00Z', '2028-02-01T00:00:00Z').ok).toBe(false)
    expect(q('TEMP_STAY', '2027-02-01T00:00:00Z', '2027-03-15T00:00:00Z')).toMatchObject({ ok: false, error: 'Monthly stays must be a whole number of months' })
    expect(q('PERMANENT', '2027-02-01T00:00:00Z', '2029-02-01T00:00:00Z').ok).toBe(false)
  })
  it('rejects a rental type the listing does not offer or has no price for', () => {
    expect(q('TEMP_STAY', '2027-02-01T00:00:00Z', '2027-03-01T00:00:00Z', { ...listing, rentalModes: '["SHORT_STAY"]' }).ok).toBe(false)
    expect(q('SHORT_STAY', '2027-02-01T00:00:00Z', '2027-02-06T00:00:00Z', { ...listing, priceNightly: null }).ok).toBe(false)
    expect(q('SHORT_STAY', '2027-02-01T00:00:00Z', '2027-02-06T00:00:00Z', { ...listing, priceNightly: 0 }).ok).toBe(false)
    expect(q('ADMIN', '2027-02-01T00:00:00Z', '2027-02-06T00:00:00Z').ok).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { parseSearchRange, availabilityWhere } from './searchDates'

const now = new Date('2027-01-10T08:00:00Z')
const p = (input: Parameters<typeof parseSearchRange>[0]) => parseSearchRange(input, now)

describe('parseSearchRange', () => {
  it('reads a short stay as nights between check-in and check-out', () => {
    const r = p({ checkIn: '2027-02-13', checkOut: '2027-02-16', mode: 'SHORT_STAY' })
    expect(r).toMatchObject({ ok: true, nights: 3, checkIn: '2027-02-13', checkOut: '2027-02-16' })
    expect(r.ok && r.firstNight.toISOString()).toBe('2027-02-13T12:00:00.000Z')
    expect(r.ok && r.lastNight.toISOString()).toBe('2027-02-15T12:00:00.000Z')
  })
  it('treats check-in alone as one night', () => {
    expect(p({ checkIn: '2027-02-13' })).toMatchObject({ ok: true, nights: 1, checkOut: '2027-02-14' })
  })
  it('uses months for monthly stays, defaulting to one, and ignores check-out', () => {
    expect(p({ checkIn: '2027-02-01', mode: 'TEMP_STAY' })).toMatchObject({ ok: true, checkOut: '2027-03-01', nights: 28 })
    expect(p({ checkIn: '2027-02-01', mode: 'TEMP_STAY', months: '3', checkOut: '2027-02-02' })).toMatchObject({ ok: true, checkOut: '2027-05-01' })
    expect(p({ checkIn: '2027-02-01', mode: 'TEMP_STAY', months: '12' }).ok).toBe(false)
    expect(p({ checkIn: '2027-02-01', mode: 'TEMP_STAY', months: '1.5' }).ok).toBe(false)
  })
  it('ends a monthly search on the last day of a shorter month, as the booking route does', () => {
    expect(p({ checkIn: '2027-01-31', mode: 'TEMP_STAY' })).toMatchObject({ ok: true, checkOut: '2027-02-28', nights: 28 })
    expect(p({ checkIn: '2028-01-31', mode: 'TEMP_STAY' })).toMatchObject({ ok: true, checkOut: '2028-02-29' })
    expect(p({ checkIn: '2027-01-31', mode: 'TEMP_STAY', months: '3' })).toMatchObject({ ok: true, checkOut: '2027-04-30' })
    expect(p({ checkIn: '2028-02-29', mode: 'PERMANENT' })).toMatchObject({ ok: true, checkOut: '2029-02-28' })
  })
  it('checks one year for long-term rentals', () => {
    expect(p({ checkIn: '2027-02-01', mode: 'PERMANENT' })).toMatchObject({ ok: true, checkOut: '2028-02-01', nights: 365 })
  })
  it('refuses past dates, inverted or empty ranges, bad dates and more than a year', () => {
    expect(p({ checkIn: '2027-01-09', checkOut: '2027-01-12' })).toMatchObject({ ok: false, error: 'The check-in date cannot be in the past' })
    expect(p({ checkIn: '2027-01-10', checkOut: '2027-01-12' }).ok).toBe(true)
    expect(p({ checkIn: '2027-02-16', checkOut: '2027-02-13' })).toMatchObject({ ok: false, error: 'The check-out date must be after the check-in date' })
    expect(p({ checkIn: '2027-02-16', checkOut: '2027-02-16' }).ok).toBe(false)
    expect(p({ checkIn: 'banana' }).ok).toBe(false)
    expect(p({ checkIn: '2027-02-13', checkOut: '2027-02-31' }).ok).toBe(false)
    expect(p({ checkIn: '2027-02-01', checkOut: '2028-02-03' })).toMatchObject({ ok: false, error: 'You can search for stays of up to one year' })
  })
})

describe('availabilityWhere', () => {
  it('excludes stays covering a night and host blocks on a night, not stays that end on the first day', () => {
    const r = p({ checkIn: '2027-02-13', checkOut: '2027-02-16' })
    if (!r.ok) throw new Error('range should parse')
    const [stays, blocks] = availabilityWhere(r)
    expect(stays.bookings!.none.status).toEqual({ notIn: ['CANCELLED', 'DECLINED'] })
    // a stay checking out on the 13th (at any local midnight) is before the first night's midday
    expect(new Date('2027-02-13T00:00:00Z') > r.firstNight).toBe(false)
    expect(stays.bookings!.none.checkOut).toEqual({ gt: r.firstNight })
    expect(stays.bookings!.none.checkIn).toEqual({ lte: r.lastNight })
    expect(blocks.blockedDates!.none).toEqual({ reason: 'HOST', date: { gte: r.firstNight, lte: r.lastNight } })
  })
})

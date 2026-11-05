import { describe, expect, it } from 'vitest'
import { fromSheet, searchSummary, sheetParams, startingFilters } from '@/lib/searchQuery'
import { cardPriceFor, stayPrice } from '@/lib/exploreRows'

// App shell, stage 2: the phone's search sheet and summary pill, and the search card's prices.

const filters = (q: Record<string, string>) => startingFilters((k) => q[k] ?? null)

describe('the summary pill', () => {
  it('reads "Accra · 10 to 12 Mar · 2 guests"', () => {
    expect(searchSummary(filters({ q: 'Accra', checkIn: '2027-03-10', checkOut: '2027-03-12', guests: '2' }))).toBe('Accra · 10 to 12 Mar · 2 guests')
  })
  it('names both months when the stay crosses one, and "Anywhere" with no place', () => {
    expect(searchSummary(filters({ checkIn: '2027-02-27', checkOut: '2027-03-02' }))).toBe('Anywhere · 27 Feb to 2 Mar')
  })
  it('a monthly stay gives its months, a long-term one its move-in day', () => {
    expect(searchSummary(filters({ mode: 'TEMP_STAY', checkIn: '2027-03-10', months: '3' }))).toBe('Anywhere · From 10 Mar, 3 months')
    expect(searchSummary(filters({ mode: 'PERMANENT', checkIn: '2027-03-10', q: 'Kumasi' }))).toBe('Kumasi · From 10 Mar')
  })
  it('is null with nothing chosen (the pill says "Where to?")', () => {
    expect(searchSummary(filters({}))).toBeNull()
    expect(searchSummary(filters({ guests: '1' }))).toBe('Anywhere · 1 guest')
  })
})

describe('the sheet and the search page', () => {
  it('the sheet starts from the search shown, and its answer changes only its own fields', () => {
    const f = { ...filters({ q: 'Osu', mode: 'SHORT_STAY', checkIn: '2027-03-10', checkOut: '2027-03-12', guests: '3' }), bedrooms: '2', sort: 'price_asc' }
    expect(sheetParams(f)).toBe('q=Osu&mode=SHORT_STAY&checkIn=2027-03-10&checkOut=2027-03-12&guests=3')
    const next = fromSheet(f, 'q=Tema&mode=TEMP_STAY&checkIn=2027-04-01&months=2')
    expect(next).toMatchObject({ query: 'Tema', mode: 'TEMP_STAY', checkIn: '2027-04-01', checkOut: '', months: '2', guests: '', bedrooms: '2', sort: 'price_asc' })
  })
  it('the address\'s q and checked start the search', () => {
    expect(filters({ q: 'Accra', checked: 'true' })).toMatchObject({ query: 'Accra', checked: true })
    expect(filters({ checked: 'yes' }).checked).toBe(false)
  })
})

describe('a search card\'s price', () => {
  const home = { rentalModes: ['SHORT_STAY', 'TEMP_STAY', 'PERMANENT'], priceNightly: 80, priceMonthly: 900, priceAnnual: 9600 }
  it('follows the rental type searched', () => {
    expect(cardPriceFor(home, 'SHORT_STAY')).toEqual({ usd: 80, unit: '/night' })
    expect(cardPriceFor(home, 'TEMP_STAY')).toEqual({ usd: 900, unit: '/month' })
    expect(cardPriceFor(home, 'PERMANENT')).toEqual({ usd: 800, unit: '/month' })
    expect(cardPriceFor(home, '')).toEqual({ usd: 80, unit: '/night' })
  })
  it('the stay price for the dates: nights x nightly, months x monthly, nothing for long-term', () => {
    const dates = (o: Partial<{ mode: string; checkIn: string; checkOut: string; months: string }>) => ({ mode: '', checkIn: '', checkOut: '', months: '1', ...o })
    expect(stayPrice({ usd: 80, unit: '/night' }, dates({ checkIn: '2027-03-10', checkOut: '2027-03-13' }))).toEqual({ usd: 240, units: 3, unit: 'night' })
    expect(stayPrice({ usd: 900, unit: '/month' }, dates({ mode: 'TEMP_STAY', checkIn: '2027-03-10', months: '3' }))).toEqual({ usd: 2700, units: 3, unit: 'month' })
    expect(stayPrice({ usd: 800, unit: '/month' }, dates({ mode: 'PERMANENT', checkIn: '2027-03-10' }))).toBeNull()
    expect(stayPrice({ usd: 80, unit: '/night' }, dates({ checkIn: '2027-03-10' }))).toBeNull()
  })
})

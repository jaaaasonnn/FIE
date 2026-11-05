import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from './security/harness'

// Explore on a phone (app shell, stage 2): which cities get a row, what a card's price says, and that the
// rows are made of live homes only (switched on, not on hold, the host not suspended, with a photo).

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))

import { NOW, home, person, reset } from './security/harness'
import { aboutCedis, cardPrice, cityKey, pickCities, CARDS_PER_ROW } from '@/lib/exploreRows'
import { getExplore } from '@/lib/explore'
import { forgetCached } from '@/lib/shortCache'

const photo = (id: string) => JSON.stringify([`https://images.unsplash.com/photo-${id}?w=800`])

describe('pickCities', () => {
  it('needs three homes for a row, the most homes first, at most four rows', () => {
    const cities = [
      ...Array(5).fill('Accra'), ...Array(4).fill('Kumasi'), ...Array(3).fill('Tema'), ...Array(3).fill('Cape Coast'),
      ...Array(3).fill('Ho'), ...Array(2).fill('Tamale'),
    ]
    expect(pickCities(cities).map((c) => [c.label, c.count])).toEqual([['Accra', 5], ['Kumasi', 4], ['Cape Coast', 3], ['Ho', 3]])
  })

  it('counts spellings that differ only in case or spaces as one city, under its most used spelling', () => {
    const picks = pickCities(['Accra', 'accra ', ' Accra', 'Accra', 'Kumasi'])
    expect(picks).toEqual([{ label: 'Accra', variants: ['Accra', 'accra ', ' Accra'], count: 4 }])
    expect(cityKey('  Cape   Coast ')).toBe('cape coast')
  })

  it('gives no rows with fewer than three homes anywhere, and none with no homes', () => {
    expect(pickCities(['Accra', 'Accra', 'Kumasi'])).toEqual([])
    expect(pickCities([])).toEqual([])
    expect(pickCities(['', '   '])).toEqual([])
  })
})

describe('cardPrice', () => {
  const base = { priceNightly: null, priceMonthly: null, priceAnnual: null }
  it('is per night for a home that offers short stays', () => {
    expect(cardPrice({ ...base, rentalModes: ['TEMP_STAY', 'SHORT_STAY'], priceNightly: 80, priceMonthly: 900 })).toEqual({ usd: 80, unit: '/night' })
  })
  it('is per month otherwise: the monthly price, or a long-term home\'s yearly price / 12 as the listing page shows it', () => {
    expect(cardPrice({ ...base, rentalModes: ['TEMP_STAY', 'PERMANENT'], priceMonthly: 900, priceAnnual: 9600 })).toEqual({ usd: 900, unit: '/month' })
    expect(cardPrice({ ...base, rentalModes: ['PERMANENT'], priceAnnual: 9000 })).toEqual({ usd: 750, unit: '/month' })
  })
  it('is nothing when the home has no usable price for what it offers', () => {
    expect(cardPrice({ ...base, rentalModes: ['SHORT_STAY'], priceMonthly: 900 })).toBeNull()
    expect(cardPrice({ ...base, rentalModes: ['SHORT_STAY'], priceNightly: 0 })).toBeNull()
  })
  it('writes cedis as the listing page does', () => {
    expect(aboutCedis(100, 15.5)).toBe('About GH₵ 1,550')
    expect(aboutCedis(123.45, 15.5)).toBe('About GH₵ 1,913')
  })
})

describe('getExplore', () => {
  beforeEach(() => {
    reset(state)
    forgetCached('exchange-rate')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    person(state, 'host', 'HOST')
    person(state, 'gone', 'HOST', { suspendedAt: NOW })
    ;(state.tables.exchangeRate ??= []).push({ id: 'r', usdToGhs: 15.5, updatedAt: NOW })
  })

  it('makes rows of live homes only', async () => {
    for (let i = 0; i < 3; i++) home(state, `a${i}`, 'host', { city: 'Accra', photos: photo(`a${i}`) })
    home(state, 'off', 'host', { city: 'Accra', photos: photo('off'), isActive: false })
    home(state, 'held', 'host', { city: 'Accra', photos: photo('held'), isActive: false, moderationHold: true })
    home(state, 'suspended', 'gone', { city: 'Accra', photos: photo('s') })
    home(state, 'nophoto', 'host', { city: 'Accra' })
    const { rows, rate, failed } = await getExplore(NOW)
    expect(failed).toBe(false)
    expect(rate).toBe(15.5)
    // One city row; the "More homes" row that follows a single city row has no other live home to show
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'city', city: 'Accra' })
    expect(rows[0].homes.map((h) => h.id).sort()).toEqual(['a0', 'a1', 'a2'])
    const shown = rows.flatMap((r) => r.homes.map((h) => h.id))
    for (const id of ['off', 'held', 'suspended', 'nophoto']) expect(shown).not.toContain(id)
  })

  it('a city with too few live homes has no row: its homes are in "More homes on FieGH"', async () => {
    home(state, 'a0', 'host', { city: 'Accra', photos: photo('a0') })
    home(state, 'a1', 'host', { city: 'Accra', photos: photo('a1') })
    home(state, 'held', 'host', { city: 'Accra', photos: photo('held'), isActive: false, moderationHold: true })
    const { rows } = await getExplore(NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('more')
    expect(rows[0].homes.map((h) => h.id).sort()).toEqual(['a0', 'a1'])
  })

  it('at most eight cards a row', async () => {
    for (let i = 0; i < 11; i++) home(state, `a${i}`, 'host', { city: 'Accra', photos: photo(`a${i}`) })
    for (let i = 0; i < 3; i++) home(state, `k${i}`, 'host', { city: 'Kumasi', photos: photo(`k${i}`) })
    const { rows } = await getExplore(NOW)
    expect(rows.map((r) => [r.kind, r.homes.length])).toEqual([['city', CARDS_PER_ROW], ['city', 3]])
  })

  it('no live homes: no rows, so the page shows its empty state', async () => {
    home(state, 'off', 'host', { photos: photo('off'), isActive: false })
    expect((await getExplore(NOW)).rows).toEqual([])
  })
})

// AS10: a card's price is written the same way everywhere (Explore, search, Wishlists): whole dollars when there are
// no cents, cents when there are, never a stray decimal; cedis rounded to whole cedis with thousands marked.
describe('prices as cards write them', async () => {
  const { formatUsdCompact } = await import('@/lib/utils')
  it('dollars', () => {
    expect(formatUsdCompact(80)).toBe('$80')
    expect(formatUsdCompact(1250.5)).toBe('$1,250.50')
    expect(formatUsdCompact(0.1 + 0.2)).toBe('$0.30')
    expect(formatUsdCompact(1234567.891)).toBe('$1,234,567.89')
    expect(formatUsdCompact(18000 / 12)).toBe('$1,500')
    expect(formatUsdCompact(10000 / 12)).toBe('$833.33')
  })
  it('cedis', () => {
    expect(aboutCedis(1250.5, 15.655)).toBe('About GH₵ 19,577')
    expect(aboutCedis(80, 15.5)).toBe('About GH₵ 1,240')
    expect(aboutCedis(0.1 + 0.2, 15.5)).toBe('About GH₵ 5')
    expect(aboutCedis(1234567.891, 15.5)).toBe('About GH₵ 19,135,802')
  })
})

// Explore on a phone (app shell, stage 2): which cities get a row of homes, and what a card's price says.
// Pure, so the rules are tested on their own (exploreRows.test.ts); the database read is lib/explore.ts.
// Imports nothing that reaches the server: components/home/ExplorePhone.tsx draws from it.

/** A city needs this many live homes for a row of its own */
export const MIN_HOMES_PER_CITY = 3
export const MAX_CITY_ROWS = 4
export const CARDS_PER_ROW = 8
/** With fewer city rows than this, one row of other homes follows them ("More homes on FieGH") */
export const MIN_CITY_ROWS = 2

/** Hosts type the city: "Accra", "accra " and "Accra" are one place. */
export function cityKey(city: string): string {
  return city.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type CityPick = {
  /** The spelling most of its homes use (the first in alphabetical order on a tie) */
  label: string
  /** Every spelling stored for it, to ask the database for its homes */
  variants: string[]
  count: number
}

/**
 * The cities with a row: at least MIN_HOMES_PER_CITY live homes, the most homes first (then by name), at most
 * MAX_CITY_ROWS. `cities` is the stored city of every live home, one entry per home.
 */
export function pickCities(cities: string[]): CityPick[] {
  const byKey = new Map<string, Map<string, number>>()
  for (const raw of cities) {
    const key = cityKey(raw)
    if (!key) continue
    const spellings = byKey.get(key) ?? new Map<string, number>()
    spellings.set(raw, (spellings.get(raw) ?? 0) + 1)
    byKey.set(key, spellings)
  }
  const picks: CityPick[] = []
  for (const spellings of byKey.values()) {
    const entries = [...spellings.entries()]
    const count = entries.reduce((n, [, c]) => n + c, 0)
    if (count < MIN_HOMES_PER_CITY) continue
    const [label] = entries
      .map(([s, c]) => [s.trim().replace(/\s+/g, ' '), c] as const)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))[0]
    picks.push({ label, variants: entries.map(([s]) => s), count })
  }
  return picks.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en')).slice(0, MAX_CITY_ROWS)
}

export type CardPriceInput = {
  rentalModes: string[]
  priceNightly: number | null
  priceMonthly: number | null
  priceAnnual: number | null
}

export type CardPrice = { usd: number; unit: '/night' | '/month' }

/**
 * Per night for a home that offers short stays, otherwise per month, as the listing page's booking box shows
 * it: a monthly stay's monthly price, a long-term home's yearly price / 12 (ListingClient.tsx). Null when the
 * home has no usable price.
 */
export function cardPrice(l: CardPriceInput): CardPrice | null {
  const offers = (m: string) => l.rentalModes.includes(m)
  const ok = (n: number | null): n is number => typeof n === 'number' && n > 0
  if (offers('SHORT_STAY') && ok(l.priceNightly)) return { usd: l.priceNightly, unit: '/night' }
  if (offers('TEMP_STAY') && ok(l.priceMonthly)) return { usd: l.priceMonthly, unit: '/month' }
  if (offers('PERMANENT') && ok(l.priceAnnual)) return { usd: l.priceAnnual / 12, unit: '/month' }
  return null
}

/**
 * A search card's price for the rental type searched: per night for Short Stay, per month for Monthly, a long-term
 * home's yearly price / 12 per month for Long-Term, and with no type chosen the same rule as Explore.
 */
export function cardPriceFor(l: CardPriceInput, mode: string): CardPrice | null {
  const ok = (n: number | null): n is number => typeof n === 'number' && n > 0
  if (mode === 'SHORT_STAY') return ok(l.priceNightly) ? { usd: l.priceNightly, unit: '/night' } : cardPrice(l)
  if (mode === 'TEMP_STAY') return ok(l.priceMonthly) ? { usd: l.priceMonthly, unit: '/month' } : cardPrice(l)
  if (mode === 'PERMANENT') return ok(l.priceAnnual) ? { usd: l.priceAnnual / 12, unit: '/month' } : cardPrice(l)
  return cardPrice(l)
}

/**
 * The stay price for the dates searched, as the booking box works it out (price per unit x units): nights x the
 * nightly price for a short stay, months x the monthly price for a monthly stay. Null for anything else (a
 * long-term rental, no dates, or a price that is not per night or per month). Never the deposit.
 */
export function stayPrice(price: CardPrice | null, dates: { mode: string; checkIn: string; checkOut: string; months: string }): { usd: number; units: number; unit: 'night' | 'month' } | null {
  if (!price || !dates.checkIn) return null
  if (price.unit === '/night' && (dates.mode === 'SHORT_STAY' || dates.mode === '') && dates.checkOut) {
    const nights = Math.round((Date.parse(`${dates.checkOut}T12:00:00Z`) - Date.parse(`${dates.checkIn}T12:00:00Z`)) / 86_400_000)
    return nights > 0 ? { usd: price.usd * nights, units: nights, unit: 'night' } : null
  }
  const months = parseInt(dates.months, 10)
  if (price.unit === '/month' && dates.mode === 'TEMP_STAY' && months > 0) return { usd: price.usd * months, units: months, unit: 'month' }
  return null
}

/** "About GH₵ 1,550", written as the listing page writes it */
export function aboutCedis(usd: number, rate: number): string {
  return `About GH₵ ${(usd * rate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

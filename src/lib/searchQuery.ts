import type { PublicCheck } from '@/lib/listingCheckRules'
import { formatDay } from '@/lib/dateText'

// The search page's query and what it does with the answer, in one place for the browser
// (app/search/SearchClient.tsx) and for the server, which runs the first search with the page
// (app/search/page.tsx, lib/serverRead.ts). Both must ask the same question and show the same list.

// ── API listing type ─────────────────────────────────────────────────────────
export type ApiListing = {
  id:            string
  title:         string
  propertyType:  string
  region:        string
  city:          string
  neighbourhood: string | null
  bedrooms:      number
  bathrooms:     number
  maxGuests:     number
  priceNightly:  number | null
  priceMonthly:  number | null
  priceAnnual:   number | null
  avgRating:     number
  reviewCount:   number
  photos:        string[]
  rentalModes:   string[]
  lat:           number | null
  lng:           number | null
  /** Set while FieGH's check of the address and photos stands */
  check?:        PublicCheck | null
  host: {
    isVerified:  boolean
    isSuperhost: boolean
  }
}

// ── Display price helper ─────────────────────────────────────────────────────
export function getDisplayPrice(l: ApiListing, mode: string) {
  // A long-term-only home has no monthly rate to book at: show the yearly
  // price (the card adds the monthly equivalent underneath).
  const longTermOnly = l.rentalModes?.length === 1 && l.rentalModes[0] === 'PERMANENT'
  if (longTermOnly && l.priceAnnual) return { price: l.priceAnnual, unit: '/year' }
  if (mode === 'SHORT_STAY' && l.priceNightly)  return { price: l.priceNightly,  unit: '/night' }
  if (mode === 'PERMANENT'  && l.priceAnnual)   return { price: l.priceAnnual,   unit: '/year'  }
  if (l.priceMonthly) return { price: l.priceMonthly, unit: '/mo' }
  if (l.priceNightly) return { price: l.priceNightly, unit: '/night' }
  if (l.priceAnnual)  return { price: l.priceAnnual,  unit: '/year' }
  return { price: 0, unit: '' }
}

// ── Dates ────────────────────────────────────────────────────────────────────
export type DateFilters = { mode: string; checkIn: string; checkOut: string; months: string }

/** The date parameters to send, or null when there is not enough to search by dates yet. */
export function dateQuery(f: DateFilters): Record<string, string> | null {
  if (!f.checkIn) return null
  if (f.mode === 'TEMP_STAY') return { checkIn: f.checkIn, months: f.months || '1' }
  if (f.mode === 'PERMANENT') return { checkIn: f.checkIn }
  // Short stays and "all types" wait for a check-out before filtering
  return f.checkOut ? { checkIn: f.checkIn, checkOut: f.checkOut } : null
}

// ── Filters ──────────────────────────────────────────────────────────────────
/**
 * The filters a search starts with: the address's (from the home page's search box, Explore's chips and rows,
 * the search sheet), the rest empty.
 */
export function startingFilters(get: (key: string) => string | null) {
  return {
    query:        (get('q') || '').slice(0, 100),
    mode:         get('mode')   || '',
    region:       get('region') || '',
    guests:       get('guests') || '',
    checkIn:      get('checkIn')  || '',
    checkOut:     get('checkOut') || '',
    months:       get('months')   || '1',
    minPrice:     '',
    maxPrice:     '',
    bedrooms:     '',
    propertyType: '',
    hostIdChecked: false,
    checked:      get('checked') === 'true',
    superhost:    false,
    sort:         'newest',
    amenities:    [] as string[],
  }
}
export type SearchFilters = ReturnType<typeof startingFilters>

/** The query sent to GET /api/listings for these filters. */
export function searchQuery(filters: SearchFilters): URLSearchParams {
  const q = new URLSearchParams()
  if (filters.mode)         q.set('mode',         filters.mode)
  if (filters.region)       q.set('region',       filters.region)
  if (filters.bedrooms)     q.set('bedrooms',     filters.bedrooms)
  if (filters.propertyType) q.set('propertyType', filters.propertyType)
  if (filters.hostIdChecked) q.set('hostIdChecked', 'true')
  if (filters.checked)      q.set('checked',      'true')
  if (filters.superhost)    q.set('superhost',    'true')
  if (dateQuery(filters)) for (const [k, v] of Object.entries(dateQuery(filters)!)) q.set(k, v)
  // The typed words are matched on the server, over every home (G2)
  if (filters.query.trim()) q.set('q', filters.query.trim())
  q.set('limit', '50')
  return q
}

/** The list shown for a successful answer: narrowed and sorted here where the API does not. */
export function shapeResults(data: { listings?: ApiListing[]; total?: unknown }, filters: SearchFilters): { results: ApiListing[]; total: number } {
  let results: ApiListing[] = data.listings ?? []

  // Party size from the homepage search (guests or occupants)
  const guests = parseInt(filters.guests, 10)
  if (guests > 0) results = results.filter((l) => l.maxGuests >= guests)

  // Client-side price filter (min/max) — not in API yet
  if (filters.minPrice) {
    const min = parseFloat(filters.minPrice)
    results = results.filter((l) => {
      const { price } = getDisplayPrice(l, filters.mode)
      return price >= min
    })
  }
  if (filters.maxPrice) {
    const max = parseFloat(filters.maxPrice)
    results = results.filter((l) => {
      const { price } = getDisplayPrice(l, filters.mode)
      return price <= max
    })
  }

  // Client-side sort
  if (filters.sort === 'price_asc')    results.sort((a, b) => (getDisplayPrice(a, filters.mode).price) - (getDisplayPrice(b, filters.mode).price))
  if (filters.sort === 'price_desc')   results.sort((a, b) => (getDisplayPrice(b, filters.mode).price) - (getDisplayPrice(a, filters.mode).price))
  if (filters.sort === 'top_rated')    results.sort((a, b) => b.avgRating  - a.avgRating)
  if (filters.sort === 'most_reviewed') results.sort((a, b) => b.reviewCount - a.reviewCount)

  // Every home that matches, not just this page of them, unless a filter
  // only the browser applies (party size, price) has narrowed the page
  const narrowedHere = parseInt(filters.guests, 10) > 0 || !!filters.minPrice || !!filters.maxPrice
  return { results, total: narrowedHere || typeof data.total !== 'number' ? results.length : data.total }
}

// ── The phone's search sheet (components/search/SearchSheet.tsx, public/sheet.js) ─────────────────────────────
/** The search shown, as the sheet's fields are named */
export function sheetParams(f: SearchFilters): string {
  const p = new URLSearchParams()
  if (f.query.trim()) p.set('q', f.query.trim())
  if (f.mode) p.set('mode', f.mode)
  if (f.checkIn) p.set('checkIn', f.checkIn)
  if (f.checkOut) p.set('checkOut', f.checkOut)
  if (f.months && f.months !== '1') p.set('months', f.months)
  if (f.guests) p.set('guests', f.guests)
  return p.toString()
}

/** The sheet's answer, as filters: only the fields the sheet has, the rest kept */
export function fromSheet(f: SearchFilters, params: string): SearchFilters {
  const p = new URLSearchParams(params)
  return { ...f, query: (p.get('q') || '').slice(0, 100), mode: p.get('mode') || '', checkIn: p.get('checkIn') || '', checkOut: p.get('checkOut') || '', months: p.get('months') || '1', guests: p.get('guests') || '' }
}

const day = (key: string) => formatDay(`${key}T12:00:00Z`, { day: 'numeric', month: 'short' })

/** The phone's summary pill: "Accra · 10 to 12 Mar · 2 guests", or null when nothing is chosen ("Where to?"). */
export function searchSummary(f: SearchFilters): string | null {
  const place = f.query.trim() || f.region
  let dates = ''
  if (f.checkIn) {
    if (f.mode === 'TEMP_STAY') dates = `From ${day(f.checkIn)}, ${f.months === '1' || !f.months ? '1 month' : `${f.months} months`}`
    else if (f.mode === 'PERMANENT' || !f.checkOut) dates = `From ${day(f.checkIn)}`
    else {
      const a = f.checkIn.slice(0, 7) === f.checkOut.slice(0, 7)
      dates = `${a ? String(Number(f.checkIn.slice(8, 10))) : day(f.checkIn)} to ${day(f.checkOut)}`
    }
  }
  const n = parseInt(f.guests, 10)
  const guests = n > 0 ? `${n} ${n === 1 ? 'guest' : 'guests'}` : ''
  if (!place && !dates && !guests) return null
  return [place || 'Anywhere', dates, guests].filter(Boolean).join(' · ')
}

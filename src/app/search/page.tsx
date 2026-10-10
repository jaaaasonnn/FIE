'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Search, SlidersHorizontal, MapPin, Star, Bed, Bath, X,
  Map as MapIcon, Loader2, Home,
} from 'lucide-react'
import { MODE_ICONS } from '@/lib/rentalModes'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { GHANA_REGIONS, PROPERTY_TYPES, formatUsdCompact } from '@/lib/utils'
import { HostIdBadge, SuperhostBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { MapListing } from '@/components/map/ListingsMap'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { CheckedBadge } from '@/components/listing/CheckedBadge'
import { CHECK_FILTER_LABEL, HOST_ID_BADGE, type PublicCheck } from '@/lib/listingCheckRules'

// ── Dynamic map import (SSR-off) ─────────────────────────────────────────────
const ListingsMap = dynamic(
  () => import('@/components/map/ListingsMap').then((m) => m.ListingsMap),
  { ssr: false, loading: () => <MapSkeleton /> },
)

function MapSkeleton() {
  return (
    <div className="w-full h-full rounded-2xl animate-pulse"
      style={{ backgroundColor: '#F4F2EE' }} />
  )
}

// ── API listing type ─────────────────────────────────────────────────────────
type ApiListing = {
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

/** Rental type with its icon, for the filter pills. */
function ModeLabel({ mode }: { mode: string }) {
  const Icon = MODE_ICONS[mode]
  return <>{Icon && <Icon size={13} strokeWidth={1.75} aria-hidden />}{MODE_LABELS[mode]}</>
}

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: 'Short Stay',
  TEMP_STAY:  'Monthly',
  PERMANENT:  'Long-Term',
}

const SORT_OPTIONS = [
  { value: 'newest',        label: 'Newest' },
  { value: 'price_asc',    label: 'Price: low to high' },
  { value: 'price_desc',   label: 'Price: high to low' },
  { value: 'top_rated',    label: 'Top Rated' },
  { value: 'most_reviewed', label: 'Most Reviewed' },
]

// ── Display price helper ─────────────────────────────────────────────────────
function getDisplayPrice(l: ApiListing, mode: string) {
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

const dateInputStyle = {
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text-primary)',
}

// ── Dates ────────────────────────────────────────────────────────────────────
type DateFilters = { mode: string; checkIn: string; checkOut: string; months: string }

/** The date parameters to send, or null when there is not enough to search by dates yet. */
function dateQuery(f: DateFilters): Record<string, string> | null {
  if (!f.checkIn) return null
  if (f.mode === 'TEMP_STAY') return { checkIn: f.checkIn, months: f.months || '1' }
  if (f.mode === 'PERMANENT') return { checkIn: f.checkIn }
  // Short stays and "all types" wait for a check-out before filtering
  return f.checkOut ? { checkIn: f.checkIn, checkOut: f.checkOut } : null
}

const dayLabel = (key: string, withYear = false) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })

/** "13 to 16 Oct, 3 nights", "From 13 Oct, 3 months" or "From 13 Oct, one year". */
function dateSummary(f: DateFilters): string {
  if (f.mode === 'TEMP_STAY') return `From ${dayLabel(f.checkIn)}, ${f.months === '1' ? '1 month' : `${f.months} months`}`
  if (f.mode === 'PERMANENT') return `From ${dayLabel(f.checkIn)}, one year`
  const a = new Date(`${f.checkIn}T12:00:00Z`), b = new Date(`${f.checkOut}T12:00:00Z`)
  const nights = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
  const from = sameMonth ? String(a.getUTCDate()) : dayLabel(f.checkIn)
  return `${from} to ${dayLabel(f.checkOut)}, ${nights} ${nights === 1 ? 'night' : 'nights'}`
}

const todayKey = () => new Date().toISOString().slice(0, 10)

// ── Search UI ────────────────────────────────────────────────────────────────
function SearchContent() {
  const params = useSearchParams()
  const { rate: ghsRate } = useExchangeRate()

  const [showFilters,   setShowFilters]   = useState(false)
  const [showMapMobile, setShowMapMobile] = useState(false)
  const [listings,      setListings]      = useState<ApiListing[]>([])
  const [total,         setTotal]         = useState(0)
  // Set when the server refuses the chosen dates (for example a past check-in)
  const [dateError,     setDateError]     = useState('')

  const [filters, setFilters] = useState({
    query:        '',
    mode:         params.get('mode')   || '',
    region:       params.get('region') || '',
    guests:       params.get('guests') || '',
    checkIn:      params.get('checkIn')  || '',
    checkOut:     params.get('checkOut') || '',
    months:       params.get('months')   || '1',
    minPrice:     '',
    maxPrice:     '',
    bedrooms:     '',
    propertyType: '',
    hostIdChecked: false,
    checked:      false,
    superhost:    false,
    sort:         'newest',
    amenities:    [] as string[],
  })
  // Loading until results arrive for the current filters (derived, not toggled in the effect)
  const [loadedFilters, setLoadedFilters] = useState<typeof filters | null>(null)
  const loading = loadedFilters !== filters

  // ── Fetch from /api/listings whenever filters change ──────────────────
  useEffect(() => {
    let active = true
    async function runSearch(): Promise<ApiListing[]> {
      const q = new URLSearchParams()
      if (filters.mode)         q.set('mode',         filters.mode)
      if (filters.region)       q.set('region',       filters.region)
      if (filters.bedrooms)     q.set('bedrooms',     filters.bedrooms)
      if (filters.propertyType) q.set('propertyType', filters.propertyType)
      if (filters.hostIdChecked) q.set('hostIdChecked', 'true')
      if (filters.checked)      q.set('checked',      'true')
      if (filters.superhost)    q.set('superhost',    'true')
      if (dateQuery(filters)) for (const [k, v] of Object.entries(dateQuery(filters)!)) q.set(k, v)
      q.set('limit', '50')

      const res  = await fetch(`/api/listings?${q}`)
      const data = await res.json()
      // A refused date range comes back as an error, with nothing to show
      if (!res.ok) throw new Error(data.error ?? 'Search failed')
      let results: ApiListing[] = data.listings ?? []

      // Client-side free-text search (title, city, neighbourhood, region) — not in API yet
      if (filters.query.trim()) {
        const needle = filters.query.trim().toLowerCase()
        results = results.filter((l) =>
          l.title.toLowerCase().includes(needle) ||
          l.city.toLowerCase().includes(needle) ||
          l.region.toLowerCase().includes(needle) ||
          (l.neighbourhood?.toLowerCase().includes(needle) ?? false),
        )
      }

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

      return results
    }
    runSearch()
      .then((results) => {
        if (!active) return
        setListings(results)
        setTotal(results.length)
        setDateError('')
      })
      .catch((err: Error) => {
        if (!active) return
        // Only a date problem empties the list; other failures keep the last results
        if (dateQuery(filters)) { setListings([]); setTotal(0); setDateError(err.message) }
      })
      .finally(() => { if (active) setLoadedFilters(filters) })
    return () => { active = false }
  }, [filters])

  // ── Map listings (only those with coordinates) ─────────────────────────
  const mapListings: MapListing[] = listings
    .filter((l) => l.lat != null && l.lng != null)
    .map((l) => ({
      ...getDisplayPrice(l, filters.mode),
      id:            l.id,
      title:         l.title,
      neighbourhood: l.neighbourhood ?? l.city,
      city:          l.city,
      photo:         l.photos?.[0] ?? '',
      rating:        l.avgRating,
      reviews:       l.reviewCount,
      check:         l.check ?? null,
      coordinates:   [l.lng!, l.lat!] as [number, number],
    }))

  // ── List and map, linked ───────────────────────────────────────────────
  // Hovering a card highlights its pin; tapping a pin highlights its card
  // and brings it into view.
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null)
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLAnchorElement>())

  const handleMapSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    if (!id) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    cardRefs.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [])

  // Dates travel to the listing page, which pre-fills its booking box
  const dq = dateQuery(filters)
  const listingQuery = dq ? `?${new URLSearchParams({ ...dq, ...(filters.mode ? { mode: filters.mode } : {}) })}` : ''

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>

      {/* Sticky top bar */}
      <div className="sticky z-30"
        style={{
          top: '4.25rem',
          backgroundColor: 'var(--color-bg-card)',
          borderBottom: '1px solid var(--color-border)',
          boxShadow: '0 1px 6px rgba(31,27,22,0.05)',
        }}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            {/* Search input */}
            <div className="flex-1 min-w-0 flex items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
              <Search size={15} style={{ color: 'var(--color-text-muted)' }} className="flex-shrink-0" />
              <input
                placeholder="Search by city, neighbourhood..."
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                className="flex-1 text-sm bg-transparent border-none outline-none"
                style={{ color: 'var(--color-text-primary)' }}
              />
              {filters.query && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, query: '' }))}
                  className="flex-shrink-0"
                  style={{ color: 'var(--color-text-muted)' }}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Mode pills — desktop */}
            <div className="hidden md:flex gap-1">
              {['', 'SHORT_STAY', 'TEMP_STAY', 'PERMANENT'].map((m) => (
                <button key={m}
                  onClick={() => setFilters((f) => ({ ...f, mode: m }))}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all whitespace-nowrap"
                  style={
                    filters.mode === m
                      ? { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }
                      : { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }
                  }>
                  {m ? <ModeLabel mode={m} /> : 'All types'}
                </button>
              ))}
            </div>

            {/* Filters toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                border:          `1px solid ${showFilters ? 'var(--color-accent)' : 'var(--color-border)'}`,
                backgroundColor: showFilters ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)',
                color:           showFilters ? 'var(--color-accent)'        : 'var(--color-text-primary)',
              }}>
              <SlidersHorizontal size={15} />
              Filters
            </button>

            {/* Mobile map button */}
            <button
              onClick={() => setShowMapMobile(true)}
              className="md:hidden flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              <MapIcon size={15} /> Map
            </button>
          </div>

          {/* Dates: always visible, since they decide what is available */}
          <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
            <label className="flex flex-col text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              {filters.mode === 'TEMP_STAY' || filters.mode === 'PERMANENT' ? 'Move-in' : 'Check-in'}
              <input type="date" value={filters.checkIn} min={todayKey()}
                onChange={(e) => setFilters((f) => ({ ...f, checkIn: e.target.value, checkOut: f.checkOut && e.target.value && f.checkOut <= e.target.value ? '' : f.checkOut }))}
                className="focus-ring mt-1 text-sm px-3 py-2 rounded-xl font-normal"
                style={dateInputStyle} />
            </label>
            {filters.mode === 'TEMP_STAY' ? (
              <label className="flex flex-col text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Months
                <select value={filters.months}
                  onChange={(e) => setFilters((f) => ({ ...f, months: e.target.value }))}
                  className="focus-ring mt-1 text-sm px-3 py-2 rounded-xl font-normal"
                  style={dateInputStyle}>
                  {Array.from({ length: 11 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ) : filters.mode === 'PERMANENT' ? (
              <p className="text-xs pb-2.5" style={{ color: 'var(--color-text-secondary)' }}>Checks one year from this date.</p>
            ) : (
              <label className="flex flex-col text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Check-out
                <input type="date" value={filters.checkOut} min={filters.checkIn || todayKey()}
                  onChange={(e) => setFilters((f) => ({ ...f, checkOut: e.target.value }))}
                  className="focus-ring mt-1 text-sm px-3 py-2 rounded-xl font-normal"
                  style={dateInputStyle} />
              </label>
            )}
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="mt-3 pt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              {[
                { label: 'Region',   value: filters.region,       key: 'region',       options: GHANA_REGIONS.map((r) => ({ val: r, label: r })) },
                { label: 'Type',     value: filters.propertyType, key: 'propertyType', options: PROPERTY_TYPES.map((t) => ({ val: t, label: t })) },
                { label: 'Bedrooms', value: filters.bedrooms,     key: 'bedrooms',     options: [1,2,3,4,5].map((n) => ({ val: String(n), label: `${n}+ beds` })) },
                { label: 'Sort',     value: filters.sort,         key: 'sort',         options: SORT_OPTIONS.map((o) => ({ val: o.value, label: o.label })) },
              ].map(({ label, value, key, options }) => (
                <select key={key} value={value}
                  onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                  className="text-xs p-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>
                  <option value="">{label}</option>
                  {options.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
              ))}

              <div className="flex gap-2 items-center">
                <input type="number" placeholder="Min $" value={filters.minPrice}
                  onChange={(e) => setFilters((f) => ({ ...f, minPrice: e.target.value }))}
                  className="w-full text-xs p-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }} />
                <span style={{ color: 'var(--color-text-muted)' }}>to</span>
                <input type="number" placeholder="Max $" value={filters.maxPrice}
                  onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
                  className="w-full text-xs p-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }} />
              </div>

              <div className="flex gap-3 items-center flex-wrap">
                {[
                  { key: 'checked',       label: CHECK_FILTER_LABEL, checked: filters.checked },
                  { key: 'hostIdChecked', label: HOST_ID_BADGE,      checked: filters.hostIdChecked },
                  { key: 'superhost', label: 'Superhost', checked: filters.superhost },
                ].map(({ key, label, checked }) => (
                  <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    <input type="checkbox" checked={checked}
                      onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Split layout */}
      {/* The fixed-viewport height + independent inner scroll is a desktop-only
          pattern (it exists so the map panel can stay pinned while the list
          scrolls past it). Applying it on mobile — where the map panel is
          hidden anyway — created two independently-scrollable containers
          (the page and this panel), and on iOS Safari specifically 100vh
          doesn't track the address bar's show/hide, so taps could land on
          the wrong scroll container. Below md, this is just normal page flow. */}
      <div className="max-w-[1600px] mx-auto flex md:h-[calc(100vh_-_4.25rem_-_121px)]">

        {/* LEFT: scrollable listings */}
        <div className="flex-[58] md:overflow-y-auto px-4 sm:px-6 py-6">

          {/* Result count + chips */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <p className="text-sm flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
              {loading
                ? <><Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent)' }} /> Searching…</>
                : <span><strong style={{ color: 'var(--color-text-primary)' }}>{total}</strong> properties found
                    {filters.region && <span> in <strong>{filters.region}</strong></span>}
                    {filters.mode   && <span> · <strong>{MODE_LABELS[filters.mode]}</strong></span>}
                    {dateQuery(filters) && !dateError && <span>, available {dateSummary(filters).replace(/^From/, 'from')}</span>}
                  </span>}
            </p>

            <div className="flex flex-wrap gap-2">
              {dateQuery(filters) && (
                <button onClick={() => setFilters((f) => ({ ...f, checkIn: '', checkOut: '' }))}
                  aria-label={`Clear dates: ${dateSummary(filters)}`}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-deep)', border: '1px solid var(--color-border-strong)' }}>
                  {dateSummary(filters)} <X size={11} />
                </button>
              )}
              {filters.mode && (
                <button onClick={() => setFilters((f) => ({ ...f, mode: '' }))}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-deep)', border: '1px solid var(--color-border-strong)' }}>
                  {MODE_LABELS[filters.mode]} <X size={11} />
                </button>
              )}
              {filters.region && (
                <button onClick={() => setFilters((f) => ({ ...f, region: '' }))}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-deep)', border: '1px solid var(--color-border-strong)' }}>
                  {filters.region} <X size={11} />
                </button>
              )}
            </div>
          </div>

          {dateError && !loading && (
            <p role="alert" className="mb-5 text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
              {dateError}. Change the dates above to search again.
            </p>
          )}

          {/* Listing cards */}
          {!loading && listings.length === 0 ? (
            <div className="text-center py-20">
<div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-deep)' }}>
                <Home size={26} strokeWidth={1.75} aria-hidden />
              </div>
              <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>No properties found</h3>
              <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>Try adjusting your filters.</p>
              <Button onClick={() => setFilters({
                query: '', mode: '', region: '', guests: '', checkIn: '', checkOut: '', months: '1', minPrice: '', maxPrice: '',
                bedrooms: '', propertyType: '', hostIdChecked: false, checked: false,
                superhost: false, sort: 'newest', amenities: [],
              })}>
                Clear all filters
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {(loading ? Array.from({ length: 6 }) : listings).map((item, idx) => {
                if (loading || !item) {
                  return (
                    <div key={idx} className="flex gap-3 rounded-2xl p-3 animate-pulse"
                      style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                      <div className="flex-shrink-0 rounded-xl" style={{ width: 110, height: 100, backgroundColor: '#E8E2D9' }} />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-3.5 rounded-full w-4/5" style={{ backgroundColor: '#E8E2D9' }} />
                        <div className="h-3 rounded-full w-1/2"  style={{ backgroundColor: '#EDE8E1' }} />
                        <div className="h-3 rounded-full w-1/3"  style={{ backgroundColor: '#EDE8E1' }} />
                      </div>
                    </div>
                  )
                }

                const l = item as ApiListing
                const { price, unit } = getDisplayPrice(l, filters.mode)

                return (
                  <Link key={l.id} href={`/listings/${l.id}${listingQuery}`}
                    ref={(el) => {
                      if (el) cardRefs.current.set(l.id, el)
                      else cardRefs.current.delete(l.id)
                    }}
                    data-selected={selectedId === l.id}
                    // Real pointers only: a tap fires no mouse pointer events
                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHoveredCardId(l.id) }}
                    onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHoveredCardId(null) }}
                    className="listing-card group flex gap-3 rounded-2xl p-3"
                    style={{
                      backgroundColor: 'var(--color-bg-card)',
                      textDecoration:  'none',
                      // Clear of the sticky header and filter bar when scrolled to
                      scrollMarginTop: 'calc(4.25rem + 121px + 12px)',
                      scrollMarginBottom: 12,
                    }}>
                    {/* Thumbnail */}
                    <div className="relative flex-shrink-0 rounded-xl overflow-hidden"
                      style={{ width: 110, height: 100 }}>
                      {l.photos?.[0] && (
                        <Image src={l.photos[0]} alt={l.title}
                          fill
                          sizes="110px"
                          className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                      )}
                      {l.rentalModes?.[0] && (
                        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}>
                          {MODE_LABELS[l.rentalModes[0]]}
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 py-0.5">
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <h3 className="font-semibold text-sm leading-snug line-clamp-2 flex-1"
                          style={{ color: 'var(--color-text-primary)' }}>
                          {l.title}
                        </h3>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <Star size={10} fill="#C9932E" color="#C9932E" />
                          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                            {l.avgRating.toFixed(1)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-xs mb-2"
                        style={{ color: 'var(--color-text-secondary)' }}>
                        <MapPin size={10} />
                        {l.neighbourhood ?? l.city}, {l.city}
                      </div>

                      <div className="flex items-center gap-2 text-xs mb-2"
                        style={{ color: 'var(--color-text-muted)' }}>
                        <span className="flex items-center gap-0.5"><Bed  size={10} />{l.bedrooms} bd</span>
                        <span className="flex items-center gap-0.5"><Bath size={10} />{l.bathrooms} ba</span>
                      </div>

                      <div className="flex items-end justify-between gap-2 flex-wrap">
                        <div>
                          <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                            {formatUsdCompact(price)}
                          </span>
                          <span className="text-xs ml-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            {unit}
                          </span>
                          {unit === '/year' && (
                            <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                              About {formatUsdCompact(price / 12)} a month
                            </div>
                          )}
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                            About GH₵ {(price * ghsRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                        {(l.host?.isVerified || l.host?.isSuperhost || l.check) && (
                          <div className="flex gap-1 flex-wrap justify-end ml-auto">
                            <CheckedBadge check={l.check} />
                            {l.host.isVerified  && <HostIdBadge />}
                            {l.host.isSuperhost && <SuperhostBadge />}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT: sticky map — desktop only */}
        <div className="hidden md:block flex-[42] sticky"
          style={{ top: 'calc(4.25rem + 121px)', height: 'calc(100vh - 4.25rem - 121px)', padding: '12px 12px 12px 0' }}>
          <ListingsMap listings={mapListings} initialRegion={filters.region || undefined}
            listingQuery={listingQuery} highlightId={hoveredCardId} onSelect={handleMapSelect} />
        </div>
      </div>

      {/* Mobile full-screen map overlay */}
      {showMapMobile && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--color-bg)' }}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
            <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
              Map view · {total} properties
            </span>
            <button onClick={() => setShowMapMobile(false)}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              <X size={14} /> Close
            </button>
          </div>
          <div className="flex-1">
            <ListingsMap listings={mapListings} initialRegion={filters.region || undefined}
            listingQuery={listingQuery} highlightId={hoveredCardId} onSelect={handleMapSelect} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>
}

'use client'

import { useState, useEffect, Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Search, SlidersHorizontal, MapPin, Star, Bed, Bath, X,
  Map as MapIcon, Loader2,
} from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { GHANA_REGIONS, PROPERTY_TYPES } from '@/lib/utils'
import { VerifiedBadge, SuperhostBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { MapListing } from '@/components/map/ListingsMap'

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
  host: {
    isVerified:  boolean
    isSuperhost: boolean
  }
}

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay',
  TEMP_STAY:  '📅 Monthly',
  PERMANENT:  '🏠 Long-Term',
}

const SORT_OPTIONS = [
  { value: 'newest',        label: 'Newest' },
  { value: 'price_asc',    label: 'Price: Low → High' },
  { value: 'price_desc',   label: 'Price: High → Low' },
  { value: 'top_rated',    label: 'Top Rated' },
  { value: 'most_reviewed', label: 'Most Reviewed' },
]

// ── Display price helper ─────────────────────────────────────────────────────
function getDisplayPrice(l: ApiListing, mode: string) {
  if (mode === 'SHORT_STAY' && l.priceNightly)  return { price: l.priceNightly,  unit: '/night' }
  if (mode === 'PERMANENT'  && l.priceAnnual)   return { price: l.priceAnnual,   unit: '/year'  }
  if (l.priceMonthly) return { price: l.priceMonthly, unit: '/mo' }
  if (l.priceNightly) return { price: l.priceNightly, unit: '/night' }
  if (l.priceAnnual)  return { price: l.priceAnnual,  unit: '/year' }
  return { price: 0, unit: '' }
}

// ── Search UI ────────────────────────────────────────────────────────────────
function SearchContent() {
  const params = useSearchParams()

  const [showFilters,   setShowFilters]   = useState(false)
  const [showMapMobile, setShowMapMobile] = useState(false)
  const [listings,      setListings]      = useState<ApiListing[]>([])
  const [total,         setTotal]         = useState(0)
  const [loading,       setLoading]       = useState(true)

  const [filters, setFilters] = useState({
    mode:         params.get('mode')   || '',
    region:       params.get('region') || '',
    minPrice:     '',
    maxPrice:     '',
    bedrooms:     '',
    propertyType: '',
    verified:     false,
    superhost:    false,
    sort:         'newest',
    amenities:    [] as string[],
  })

  // ── Fetch from /api/listings whenever filters change ──────────────────
  const fetchListings = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (filters.mode)         q.set('mode',         filters.mode)
      if (filters.region)       q.set('region',       filters.region)
      if (filters.bedrooms)     q.set('bedrooms',     filters.bedrooms)
      if (filters.propertyType) q.set('propertyType', filters.propertyType)
      if (filters.verified)     q.set('verified',     'true')
      if (filters.superhost)    q.set('superhost',    'true')
      q.set('limit', '50')

      const res  = await fetch(`/api/listings?${q}`)
      const data = await res.json()
      let results: ApiListing[] = data.listings ?? []

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

      setListings(results)
      setTotal(results.length)
    } catch {
      // Keep existing results on error
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { fetchListings() }, [fetchListings])

  // ── Map listings (only those with coordinates) ─────────────────────────
  const mapListings: MapListing[] = listings
    .filter((l) => l.lat != null && l.lng != null)
    .map((l) => ({
      id:            l.id,
      title:         l.title,
      neighbourhood: l.neighbourhood ?? l.city,
      city:          l.city,
      photo:         l.photos?.[0] ?? '',
      rating:        l.avgRating,
      reviews:       l.reviewCount,
      priceNightly:  l.priceNightly  ?? undefined,
      priceMonthly:  l.priceMonthly  ?? undefined,
      priceAnnual:   l.priceAnnual   ?? undefined,
      coordinates:   [l.lng!, l.lat!] as [number, number],
      activeMode:    filters.mode || undefined,
    }))

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
            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
              <Search size={15} style={{ color: 'var(--color-text-muted)' }} className="flex-shrink-0" />
              <input
                placeholder="Search by city, neighbourhood..."
                className="flex-1 text-sm bg-transparent border-none outline-none"
                style={{ color: 'var(--color-text-primary)' }}
              />
            </div>

            {/* Mode pills — desktop */}
            <div className="hidden md:flex gap-1">
              {['', 'SHORT_STAY', 'TEMP_STAY', 'PERMANENT'].map((m) => (
                <button key={m}
                  onClick={() => setFilters((f) => ({ ...f, mode: m }))}
                  className="px-3 py-2 rounded-full text-xs font-semibold transition-all whitespace-nowrap"
                  style={
                    filters.mode === m
                      ? { backgroundColor: 'var(--color-accent)', color: '#fff' }
                      : { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }
                  }>
                  {m ? MODE_LABELS[m] : 'All types'}
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
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
              <MapIcon size={15} /> Map
            </button>
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
                <span style={{ color: 'var(--color-text-muted)' }}>–</span>
                <input type="number" placeholder="Max $" value={filters.maxPrice}
                  onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
                  className="w-full text-xs p-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }} />
              </div>

              <div className="flex gap-3 items-center">
                {[
                  { key: 'verified',  label: 'Verified',  checked: filters.verified },
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
      <div className="max-w-[1600px] mx-auto flex" style={{ height: 'calc(100vh - 4.25rem - 57px)' }}>

        {/* LEFT: scrollable listings */}
        <div className="flex-[58] overflow-y-auto px-4 sm:px-6 py-6">

          {/* Result count + chips */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <p className="text-sm flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
              {loading
                ? <><Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent)' }} /> Searching…</>
                : <><strong style={{ color: 'var(--color-text-primary)' }}>{total}</strong> properties found
                    {filters.region && <span> in <strong>{filters.region}</strong></span>}
                    {filters.mode   && <span> · <strong>{MODE_LABELS[filters.mode]}</strong></span>}
                  </>}
            </p>

            <div className="flex flex-wrap gap-2">
              {filters.mode && (
                <button onClick={() => setFilters((f) => ({ ...f, mode: '' }))}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid #E5D0A8' }}>
                  {MODE_LABELS[filters.mode]} <X size={11} />
                </button>
              )}
              {filters.region && (
                <button onClick={() => setFilters((f) => ({ ...f, region: '' }))}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: '#EAF5EE', color: '#2D6A42', border: '1px solid #B8DEC5' }}>
                  {filters.region} <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Listing cards */}
          {!loading && listings.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🏠</div>
              <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>No properties found</h3>
              <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>Try adjusting your filters.</p>
              <Button onClick={() => setFilters({
                mode: '', region: '', minPrice: '', maxPrice: '',
                bedrooms: '', propertyType: '', verified: false,
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
                  <Link key={l.id} href={`/listings/${l.id}`}
                    className="listing-card group flex gap-3 rounded-2xl p-3"
                    style={{
                      backgroundColor: 'var(--color-bg-card)',
                      border:          '1px solid var(--color-border)',
                      boxShadow:       '0 1px 6px rgba(31,27,22,0.06)',
                      textDecoration:  'none',
                    }}>
                    {/* Thumbnail */}
                    <div className="relative flex-shrink-0 rounded-xl overflow-hidden"
                      style={{ width: 110, height: 100 }}>
                      {l.photos?.[0] && (
                        <img src={l.photos[0]} alt={l.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy" />
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

                      <div className="flex items-end justify-between">
                        <div>
                          <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                            ${price.toLocaleString()}
                          </span>
                          <span className="text-xs ml-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            {unit}
                          </span>
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                            ≈ GH₵ {(price * 15.5).toLocaleString()}
                          </div>
                        </div>
                        {(l.host?.isVerified || l.host?.isSuperhost) && (
                          <div className="flex gap-1">
                            {l.host.isVerified  && <VerifiedBadge />}
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
          style={{ top: 'calc(4.25rem + 57px)', height: 'calc(100vh - 4.25rem - 57px)', padding: '12px 12px 12px 0' }}>
          <ListingsMap listings={mapListings} initialRegion={filters.region || undefined} />
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
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
              <X size={14} /> Close
            </button>
          </div>
          <div className="flex-1">
            <ListingsMap listings={mapListings} initialRegion={filters.region || undefined} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>
}

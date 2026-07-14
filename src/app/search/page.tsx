'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Search, SlidersHorizontal, MapPin, Star, Bed, Bath, X, Map as MapIcon,
} from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { GHANA_REGIONS, PROPERTY_TYPES, RENTAL_MODES } from '@/lib/utils'
import { VerifiedBadge, SuperhostBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { MapListing } from '@/components/map/ListingsMap'

// ── Dynamic import — no SSR (maplibre-gl uses browser APIs) ────────────────
const ListingsMap = dynamic(
  () => import('@/components/map/ListingsMap').then((m) => m.ListingsMap),
  { ssr: false, loading: () => <MapSkeleton /> },
)

function MapSkeleton() {
  return (
    <div
      className="w-full h-full rounded-2xl animate-pulse"
      style={{ backgroundColor: '#F4F2EE' }}
    />
  )
}

// ── Mock data with realistic Ghana coordinates ──────────────────────────────
const MOCK_RESULTS = [
  {
    id: '1', title: 'Luxury 3BR Apartment in East Legon', type: 'Apartment',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'East Legon',
    bedrooms: 3, bathrooms: 2, maxGuests: 6,
    priceNightly: 120, priceMonthly: 2200, priceAnnual: 24000,
    rating: 4.9, reviews: 47,
    photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=500&q=70',
    modes: ['SHORT_STAY', 'TEMP_STAY'], verified: true, superhost: true,
    amenities: ['WiFi', 'Pool', 'Air Conditioning', 'Generator/Inverter', 'Parking', 'CCTV'],
    coordinates: [-0.1667, 5.6354] as [number, number],
  },
  {
    id: '2', title: 'Modern Studio in Cantonments', type: 'Studio',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Cantonments',
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    priceNightly: 65, priceMonthly: 900,
    rating: 4.8, reviews: 23,
    photo: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=500&q=70',
    modes: ['SHORT_STAY'], verified: true, superhost: false,
    amenities: ['WiFi', 'Air Conditioning', 'CCTV'],
    coordinates: [-0.1833, 5.5676] as [number, number],
  },
  {
    id: '3', title: 'Spacious 4BR House, Airport Hills', type: 'House',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Airport Hills',
    bedrooms: 4, bathrooms: 3, maxGuests: 8,
    priceMonthly: 1800, priceAnnual: 19200,
    rating: 4.7, reviews: 12,
    photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=500&q=70',
    modes: ['TEMP_STAY', 'PERMANENT'], verified: true, superhost: false,
    amenities: ['WiFi', 'Generator/Inverter', 'Parking', 'Boys Quarters', 'CCTV'],
    coordinates: [-0.1654, 5.6033] as [number, number],
  },
  {
    id: '4', title: 'Cosy Villa in Kumasi (Nhyiaeso)', type: 'Villa',
    region: 'Ashanti', city: 'Kumasi', neighbourhood: 'Nhyiaeso',
    bedrooms: 5, bathrooms: 4, maxGuests: 10,
    priceNightly: 200, priceMonthly: 3500,
    rating: 5.0, reviews: 8,
    photo: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=500&q=70',
    modes: ['SHORT_STAY', 'TEMP_STAY'], verified: true, superhost: true,
    amenities: ['Swimming Pool', 'WiFi', 'Air Conditioning', 'Garden', 'Gym'],
    coordinates: [-1.6234, 6.6930] as [number, number],
  },
  {
    id: '5', title: 'Furnished 2BR Apartment, Labone', type: 'Apartment',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Labone',
    bedrooms: 2, bathrooms: 2, maxGuests: 4,
    priceMonthly: 950, priceAnnual: 10200,
    rating: 4.6, reviews: 31,
    photo: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=500&q=70',
    modes: ['TEMP_STAY', 'PERMANENT'], verified: true, superhost: false,
    amenities: ['WiFi', 'Air Conditioning', 'CCTV', 'Parking'],
    coordinates: [-0.1768, 5.5641] as [number, number],
  },
  {
    id: '6', title: 'Private Guestroom, Osu Oxford Street', type: 'Guestroom',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Osu',
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    priceNightly: 38, priceMonthly: 550,
    rating: 4.7, reviews: 55,
    photo: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500&q=70',
    modes: ['SHORT_STAY'], verified: false, superhost: false,
    amenities: ['WiFi', 'Air Conditioning'],
    coordinates: [-0.1870, 5.5600] as [number, number],
  },
  {
    id: '7', title: 'Serviced Apartment, Ridge', type: 'Serviced apartment',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Ridge',
    bedrooms: 2, bathrooms: 2, maxGuests: 4,
    priceNightly: 95, priceMonthly: 1400,
    rating: 4.5, reviews: 19,
    photo: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=500&q=70',
    modes: ['SHORT_STAY', 'TEMP_STAY'], verified: true, superhost: false,
    amenities: ['WiFi', 'Air Conditioning', 'Swimming Pool', 'Gym', 'CCTV'],
    coordinates: [-0.1937, 5.5652] as [number, number],
  },
  {
    id: '8', title: 'Entire Compound House, Tema', type: 'Entire compound',
    region: 'Greater Accra', city: 'Tema', neighbourhood: 'Community 25',
    bedrooms: 6, bathrooms: 4, maxGuests: 15,
    priceAnnual: 16000, priceMonthly: 1400,
    rating: 4.4, reviews: 6,
    photo: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=500&q=70',
    modes: ['PERMANENT'], verified: true, superhost: false,
    amenities: ['Generator/Inverter', 'Water Storage Tank', 'Parking', 'Boys Quarters'],
    coordinates: [0.0134, 5.6698] as [number, number],
  },
]

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay',
  TEMP_STAY: '📅 Monthly',
  PERMANENT: '🏠 Long-Term',
}

const SORT_OPTIONS = [
  { value: 'newest',       label: 'Newest' },
  { value: 'price_asc',   label: 'Price: Low → High' },
  { value: 'price_desc',  label: 'Price: High → Low' },
  { value: 'top_rated',   label: 'Top Rated' },
  { value: 'most_reviewed', label: 'Most Reviewed' },
]

// ── Search UI ──────────────────────────────────────────────────────────────

function SearchContent() {
  const params = useSearchParams()

  const [showFilters, setShowFilters] = useState(false)
  const [showMapMobile, setShowMapMobile] = useState(false)
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

  // ── Filtering ──────────────────────────────────────────────────────
  const results = MOCK_RESULTS.filter((l) => {
    if (filters.mode         && !l.modes.includes(filters.mode))  return false
    if (filters.region       && l.region !== filters.region)       return false
    if (filters.bedrooms     && l.bedrooms < parseInt(filters.bedrooms)) return false
    if (filters.propertyType && l.type !== filters.propertyType)   return false
    if (filters.verified     && !l.verified)                       return false
    if (filters.superhost    && !l.superhost)                      return false
    if (filters.amenities.length > 0 &&
        !filters.amenities.every((a) => l.amenities.includes(a)))  return false
    return true
  })

  function getDisplayPrice(l: typeof MOCK_RESULTS[0]) {
    if (filters.mode === 'SHORT_STAY' && l.priceNightly)  return { price: l.priceNightly,  unit: '/night' }
    if (filters.mode === 'PERMANENT'  && l.priceAnnual)   return { price: l.priceAnnual,   unit: '/year'  }
    if (l.priceMonthly)  return { price: l.priceMonthly,  unit: '/mo' }
    if (l.priceNightly)  return { price: l.priceNightly,  unit: '/night' }
    if (l.priceAnnual)   return { price: l.priceAnnual,   unit: '/year' }
    return { price: 0, unit: '' }
  }

  // Build MapListing array for the map component
  const mapListings: MapListing[] = results.map((l) => ({
    id:           l.id,
    title:        l.title,
    neighbourhood: l.neighbourhood,
    city:         l.city,
    photo:        l.photo,
    rating:       l.rating,
    reviews:      l.reviews,
    priceNightly: l.priceNightly,
    priceMonthly: l.priceMonthly,
    priceAnnual:  l.priceAnnual,
    coordinates:  l.coordinates,
    activeMode:   filters.mode || undefined,
  }))

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>

      {/* ── Sticky top bar ─────────────────────────────────────────────── */}
      <div
        className="sticky z-30"
        style={{
          top: '4.25rem',   // same as navbar height
          backgroundColor: 'var(--color-bg-card)',
          borderBottom: '1px solid var(--color-border)',
          boxShadow: '0 1px 6px rgba(31,27,22,0.05)',
        }}
      >
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">

            {/* Search input */}
            <div
              className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
            >
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
                <button
                  key={m}
                  onClick={() => setFilters({ ...filters, mode: m })}
                  className="px-3 py-2 rounded-full text-xs font-semibold transition-all whitespace-nowrap"
                  style={
                    filters.mode === m
                      ? { backgroundColor: 'var(--color-accent)', color: '#fff' }
                      : { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border)' }
                  }
                >
                  {m ? MODE_LABELS[m] : 'All types'}
                </button>
              ))}
            </div>

            {/* Filters toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                border: `1px solid ${showFilters ? 'var(--color-accent)' : 'var(--color-border)'}`,
                backgroundColor: showFilters ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)',
                color: showFilters ? 'var(--color-accent)' : 'var(--color-text-primary)',
              }}
            >
              <SlidersHorizontal size={15} />
              Filters
            </button>

            {/* Mobile: Show Map button */}
            <button
              onClick={() => setShowMapMobile(true)}
              className="md:hidden flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
            >
              <MapIcon size={15} />
              Map
            </button>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div
              className="mt-3 pt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              {[
                { label: 'Region', value: filters.region, key: 'region',
                  options: GHANA_REGIONS.map((r) => ({ val: r, label: r })) },
                { label: 'Type', value: filters.propertyType, key: 'propertyType',
                  options: PROPERTY_TYPES.map((t) => ({ val: t, label: t })) },
                { label: 'Bedrooms', value: filters.bedrooms, key: 'bedrooms',
                  options: [1,2,3,4,5].map((n) => ({ val: String(n), label: `${n}+ beds` })) },
                { label: 'Sort', value: filters.sort, key: 'sort',
                  options: SORT_OPTIONS.map((o) => ({ val: o.value, label: o.label })) },
              ].map(({ label, value, key, options }) => (
                <select
                  key={key}
                  value={value}
                  onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
                  className="text-xs p-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
                >
                  <option value="">{label}</option>
                  {options.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
              ))}

              <div className="flex gap-2 items-center">
                <input type="number" placeholder="Min $" value={filters.minPrice}
                  onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }} />
                <span style={{ color: 'var(--color-text-muted)' }}>–</span>
                <input type="number" placeholder="Max $" value={filters.maxPrice}
                  onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }} />
              </div>

              <div className="flex gap-3 items-center">
                {[
                  { key: 'verified', label: 'Verified', checked: filters.verified },
                  { key: 'superhost', label: 'Superhost', checked: filters.superhost },
                ].map(({ key, label, checked }) => (
                  <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    <input type="checkbox" checked={checked}
                      onChange={(e) => setFilters({ ...filters, [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Split layout ──────────────────────────────────────────────────── */}
      <div className="max-w-[1600px] mx-auto flex" style={{ height: 'calc(100vh - 4.25rem - 57px)' }}>

        {/* LEFT: Scrollable listings panel (58%) */}
        <div className="flex-[58] overflow-y-auto px-4 sm:px-6 py-6">

          {/* Result count + active filter chips */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>{results.length}</strong> properties found
              {filters.region && <span> in <strong>{filters.region}</strong></span>}
              {filters.mode   && <span> · <strong>{MODE_LABELS[filters.mode]}</strong></span>}
            </p>

            <div className="flex flex-wrap gap-2">
              {filters.mode && (
                <button
                  onClick={() => setFilters({ ...filters, mode: '' })}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)',
                           border: '1px solid #E5D0A8' }}
                >
                  {MODE_LABELS[filters.mode]} <X size={11} />
                </button>
              )}
              {filters.region && (
                <button
                  onClick={() => setFilters({ ...filters, region: '' })}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: '#EAF5EE', color: '#2D6A42', border: '1px solid #B8DEC5' }}
                >
                  {filters.region} <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Listing grid — 2 columns */}
          {results.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {results.map((listing) => {
                const { price, unit } = getDisplayPrice(listing)
                return (
                  <Link
                    key={listing.id}
                    href={`/listings/${listing.id}`}
                    className="listing-card group flex gap-3 rounded-2xl p-3"
                    style={{
                      backgroundColor: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      boxShadow: '0 1px 6px rgba(31,27,22,0.06)',
                      textDecoration: 'none',
                    }}
                  >
                    {/* Thumbnail */}
                    <div className="relative flex-shrink-0 rounded-xl overflow-hidden"
                      style={{ width: 110, height: 100 }}>
                      <img
                        src={listing.photo} alt={listing.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                      {listing.modes[0] && (
                        <span
                          className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff',
                                   backdropFilter: 'blur(4px)' }}
                        >
                          {MODE_LABELS[listing.modes[0]]}
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 py-0.5">
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <h3
                          className="font-semibold text-sm leading-snug line-clamp-2 flex-1"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {listing.title}
                        </h3>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <Star size={10} fill="#C9932E" color="#C9932E" />
                          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                            {listing.rating}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-xs mb-2"
                        style={{ color: 'var(--color-text-secondary)' }}>
                        <MapPin size={10} />
                        {listing.neighbourhood}, {listing.city}
                      </div>

                      <div className="flex items-center gap-2 text-xs mb-2"
                        style={{ color: 'var(--color-text-muted)' }}>
                        <span className="flex items-center gap-0.5"><Bed size={10} />{listing.bedrooms} bd</span>
                        <span className="flex items-center gap-0.5"><Bath size={10} />{listing.bathrooms} ba</span>
                      </div>

                      <div className="flex items-end justify-between">
                        <div>
                          <span className="text-sm font-bold"
                            style={{ color: 'var(--color-text-primary)' }}>
                            ${price.toLocaleString()}
                          </span>
                          <span className="text-xs ml-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            {unit}
                          </span>
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                            ≈ GH₵ {(price * 15.5).toLocaleString()}
                          </div>
                        </div>
                        {(listing.verified || listing.superhost) && (
                          <div className="flex gap-1">
                            {listing.verified  && <VerifiedBadge />}
                            {listing.superhost && <SuperhostBadge />}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🏠</div>
              <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                No properties found
              </h3>
              <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>
                Try adjusting your filters or search a different region.
              </p>
              <Button onClick={() => setFilters({
                mode: '', region: '', minPrice: '', maxPrice: '',
                bedrooms: '', propertyType: '', verified: false,
                superhost: false, sort: 'newest', amenities: [],
              })}>
                Clear all filters
              </Button>
            </div>
          )}
        </div>

        {/* RIGHT: Sticky map panel (42%) — desktop only */}
        <div
          className="hidden md:block flex-[42] sticky"
          style={{ top: 'calc(4.25rem + 57px)', height: 'calc(100vh - 4.25rem - 57px)', padding: '12px 12px 12px 0' }}
        >
          <ListingsMap
            listings={mapListings}
            initialRegion={filters.region || undefined}
          />
        </div>
      </div>

      {/* ── Mobile: full-screen map overlay ──────────────────────────────── */}
      {showMapMobile && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}
          >
            <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
              Map view · {results.length} properties
            </span>
            <button
              onClick={() => setShowMapMobile(false)}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
            >
              <X size={14} /> Close
            </button>
          </div>

          {/* Map fills rest of screen */}
          <div className="flex-1">
            <ListingsMap
              listings={mapListings}
              initialRegion={filters.region || undefined}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>
}

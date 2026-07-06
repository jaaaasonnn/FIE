'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Search, SlidersHorizontal, MapPin, Star, Bed, Bath, X } from 'lucide-react'
import Link from 'next/link'
import { GHANA_REGIONS, PROPERTY_TYPES, AMENITIES_LIST, RENTAL_MODES } from '@/lib/utils'
import { Badge, VerifiedBadge, SuperhostBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

const MOCK_RESULTS = [
  {
    id: '1', title: 'Luxury 3BR Apartment in East Legon', type: 'Apartment',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'East Legon',
    bedrooms: 3, bathrooms: 2, maxGuests: 6, priceNightly: 120, priceMonthly: 2200, priceAnnual: 24000,
    rating: 4.9, reviews: 47, photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=500&q=70',
    modes: ['SHORT_STAY', 'TEMP_STAY'], verified: true, superhost: true,
    amenities: ['WiFi', 'Pool', 'Air Conditioning', 'Generator/Inverter', 'Parking', 'CCTV']
  },
  {
    id: '2', title: 'Modern Studio in Cantonments', type: 'Studio',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Cantonments',
    bedrooms: 1, bathrooms: 1, maxGuests: 2, priceNightly: 65, priceMonthly: 900,
    rating: 4.8, reviews: 23, photo: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=500&q=70',
    modes: ['SHORT_STAY'], verified: true, superhost: false, amenities: ['WiFi', 'Air Conditioning', 'CCTV']
  },
  {
    id: '3', title: 'Spacious 4BR House, Airport Hills', type: 'House',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Airport Hills',
    bedrooms: 4, bathrooms: 3, maxGuests: 8, priceMonthly: 1800, priceAnnual: 19200,
    rating: 4.7, reviews: 12, photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=500&q=70',
    modes: ['TEMP_STAY', 'PERMANENT'], verified: true, superhost: false,
    amenities: ['WiFi', 'Generator/Inverter', 'Parking', 'Boys Quarters', 'CCTV']
  },
  {
    id: '4', title: 'Cosy Villa in Kumasi (Nhyiaeso)', type: 'Villa',
    region: 'Ashanti', city: 'Kumasi', neighbourhood: 'Nhyiaeso',
    bedrooms: 5, bathrooms: 4, maxGuests: 10, priceNightly: 200, priceMonthly: 3500,
    rating: 5.0, reviews: 8, photo: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=500&q=70',
    modes: ['SHORT_STAY', 'TEMP_STAY'], verified: true, superhost: true,
    amenities: ['Swimming Pool', 'WiFi', 'Air Conditioning', 'Garden', 'Gym']
  },
  {
    id: '5', title: 'Furnished 2BR Apartment, Labone', type: 'Apartment',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Labone',
    bedrooms: 2, bathrooms: 2, maxGuests: 4, priceMonthly: 950, priceAnnual: 10200,
    rating: 4.6, reviews: 31, photo: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=500&q=70',
    modes: ['TEMP_STAY', 'PERMANENT'], verified: true, superhost: false,
    amenities: ['WiFi', 'Air Conditioning', 'CCTV', 'Parking']
  },
  {
    id: '6', title: 'Private Guestroom, Osu Oxford Street', type: 'Guestroom',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Osu',
    bedrooms: 1, bathrooms: 1, maxGuests: 2, priceNightly: 38, priceMonthly: 550,
    rating: 4.7, reviews: 55, photo: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500&q=70',
    modes: ['SHORT_STAY'], verified: false, superhost: false, amenities: ['WiFi', 'Air Conditioning']
  },
  {
    id: '7', title: 'Serviced Apartment, Ridge', type: 'Serviced apartment',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Ridge',
    bedrooms: 2, bathrooms: 2, maxGuests: 4, priceNightly: 95, priceMonthly: 1400,
    rating: 4.5, reviews: 19, photo: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=500&q=70',
    modes: ['SHORT_STAY', 'TEMP_STAY'], verified: true, superhost: false,
    amenities: ['WiFi', 'Air Conditioning', 'Swimming Pool', 'Gym', 'CCTV', 'Security Guard']
  },
  {
    id: '8', title: 'Entire Compound House, Tema', type: 'Entire compound',
    region: 'Greater Accra', city: 'Tema', neighbourhood: 'Community 25',
    bedrooms: 6, bathrooms: 4, maxGuests: 15, priceAnnual: 16000, priceMonthly: 1400,
    rating: 4.4, reviews: 6, photo: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=500&q=70',
    modes: ['PERMANENT'], verified: true, superhost: false,
    amenities: ['Generator/Inverter', 'Water Storage Tank', 'Parking', 'Boys Quarters', 'Borehole Water']
  },
]

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay',
  TEMP_STAY: '📅 Monthly',
  PERMANENT: '🏠 Long-Term'
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'top_rated', label: 'Top Rated' },
  { value: 'most_reviewed', label: 'Most Reviewed' },
]

function SearchContent() {
  const params = useSearchParams()
  const router = useRouter()
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    mode: params.get('mode') || '',
    region: params.get('region') || '',
    minPrice: '', maxPrice: '',
    bedrooms: '', propertyType: '',
    verified: false, superhost: false,
    sort: 'newest',
    amenities: [] as string[]
  })

  const results = MOCK_RESULTS.filter((l) => {
    if (filters.mode && !l.modes.includes(filters.mode)) return false
    if (filters.region && l.region !== filters.region) return false
    if (filters.bedrooms && l.bedrooms < parseInt(filters.bedrooms)) return false
    if (filters.propertyType && l.type !== filters.propertyType) return false
    if (filters.verified && !l.verified) return false
    if (filters.superhost && !l.superhost) return false
    if (filters.amenities.length > 0 && !filters.amenities.every((a) => l.amenities.includes(a))) return false
    return true
  })

  function getDisplayPrice(listing: typeof MOCK_RESULTS[0]) {
    if (filters.mode === 'SHORT_STAY' && listing.priceNightly) return { price: listing.priceNightly, unit: '/night' }
    if (filters.mode === 'PERMANENT' && listing.priceAnnual) return { price: listing.priceAnnual, unit: '/year' }
    if (listing.priceMonthly) return { price: listing.priceMonthly, unit: '/month' }
    if (listing.priceNightly) return { price: listing.priceNightly, unit: '/night' }
    if (listing.priceAnnual) return { price: listing.priceAnnual, unit: '/year' }
    return { price: 0, unit: '' }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Top bar */}
      <div className="sticky top-16 z-30 bg-white border-b border-stone-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            {/* Search input */}
            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-stone-200 bg-stone-50">
              <Search size={16} className="text-stone-400 flex-shrink-0" />
              <input
                placeholder="Search by city, neighbourhood..."
                className="flex-1 text-sm bg-transparent border-none outline-none"
                style={{ }}
              />
            </div>

            {/* Mode pills */}
            <div className="hidden md:flex gap-1">
              {['', 'SHORT_STAY', 'TEMP_STAY', 'PERMANENT'].map((m) => (
                <button
                  key={m}
                  onClick={() => setFilters({ ...filters, mode: m })}
                  className="px-3 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap"
                  style={
                    filters.mode === m
                      ? { backgroundColor: 'var(--brown-dark)', color: 'var(--color-accent)' }
                      : { backgroundColor: '#F3F4F6', color: '#374151' }
                  }
                >
                  {m ? MODE_LABELS[m] : 'All types'}
                </button>
              ))}
            </div>

            {/* Filters button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all"
              style={{
                borderColor: showFilters ? 'var(--amber)' : '#E5E7EB',
                backgroundColor: showFilters ? '#FFF8EE' : '#fff',
                color: showFilters ? 'var(--amber)' : '#374151'
              }}
            >
              <SlidersHorizontal size={16} />
              Filters
            </button>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="mt-3 pt-3 border-t border-stone-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <select
                value={filters.region}
                onChange={(e) => setFilters({ ...filters, region: e.target.value })}
                className="text-xs p-2 rounded-lg border border-stone-200 bg-white"
              >
                <option value="">All regions</option>
                {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>

              <select
                value={filters.propertyType}
                onChange={(e) => setFilters({ ...filters, propertyType: e.target.value })}
                className="text-xs p-2 rounded-lg border border-stone-200 bg-white"
              >
                <option value="">Any type</option>
                {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>

              <select
                value={filters.bedrooms}
                onChange={(e) => setFilters({ ...filters, bedrooms: e.target.value })}
                className="text-xs p-2 rounded-lg border border-stone-200 bg-white"
              >
                <option value="">Any bedrooms</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+ beds</option>)}
              </select>

              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  placeholder="Min $"
                  value={filters.minPrice}
                  onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-stone-200 bg-white"
                />
                <span className="text-stone-400">–</span>
                <input
                  type="number"
                  placeholder="Max $"
                  value={filters.maxPrice}
                  onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-stone-200 bg-white"
                />
              </div>

              <div className="flex gap-3 items-center">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={filters.verified}
                    onChange={(e) => setFilters({ ...filters, verified: e.target.checked })} />
                  Verified
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={filters.superhost}
                    onChange={(e) => setFilters({ ...filters, superhost: e.target.checked })} />
                  Superhost
                </label>
              </div>

              <select
                value={filters.sort}
                onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
                className="text-xs p-2 rounded-lg border border-stone-200 bg-white"
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-[#6B645C]">
            <strong>{results.length}</strong> properties found
            {filters.region && <span> in <strong>{filters.region}</strong></span>}
            {filters.mode && <span> · <strong>{MODE_LABELS[filters.mode]}</strong></span>}
          </p>

          {/* Active filter chips */}
          <div className="flex flex-wrap gap-2">
            {filters.mode && (
              <button
                onClick={() => setFilters({ ...filters, mode: '' })}
                className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                style={{ backgroundColor: '#FFF8EE', color: 'var(--color-accent)', border: '1px solid var(--amber)' }}
              >
                {MODE_LABELS[filters.mode]} <X size={12} />
              </button>
            )}
            {filters.region && (
              <button
                onClick={() => setFilters({ ...filters, region: '' })}
                className="flex items-center gap-1 text-xs px-3 py-1 rounded-full"
                style={{ backgroundColor: '#F0FDF4', color: '#059669', border: '1px solid #86EFAC' }}
              >
                {filters.region} <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {results.map((listing) => {
            const { price, unit } = getDisplayPrice(listing)
            return (
              <Link key={listing.id} href={`/listings/${listing.id}`}
                className="listing-card group block bg-white rounded-2xl overflow-hidden border border-stone-100 shadow-sm">
                <div className="relative h-48 overflow-hidden">
                  <img src={listing.photo} alt={listing.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy" />
                  <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
                    {listing.modes.slice(0, 2).map((m) => (
                      <span key={m} className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: 'rgba(26,18,8,0.75)', color: 'var(--color-accent)', backdropFilter: 'blur(4px)' }}>
                        {MODE_LABELS[m]}
                      </span>
                    ))}
                  </div>
                  <button className="absolute top-2 right-2 w-7 h-7 bg-white/85 rounded-full flex items-center justify-center text-xs hover:bg-white transition-all">
                    ♡
                  </button>
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <h3 className="font-semibold text-sm leading-snug flex-1" style={{ color: 'var(--color-text-primary)' }}>
                      {listing.title}
                    </h3>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <Star size={11} className="fill-amber-400 text-amber-400" />
                      <span className="text-xs font-medium">{listing.rating}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[#6B645C] mb-2">
                    <MapPin size={11} />
                    {listing.neighbourhood}, {listing.city}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-stone-400 mb-3">
                    <span className="flex items-center gap-0.5"><Bed size={11} />{listing.bedrooms}</span>
                    <span className="flex items-center gap-0.5"><Bath size={11} />{listing.bathrooms}</span>
                  </div>
                  <div className="flex gap-1 mb-2">
                    {listing.verified && <VerifiedBadge />}
                    {listing.superhost && <SuperhostBadge />}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-stone-50">
                    <div>
                      <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                        ${price.toLocaleString()}<span className="text-xs font-normal text-[#6B645C]">{unit}</span>
                      </span>
                      <div className="text-xs text-stone-400">≈ GH₵ {(price * 15.5).toLocaleString()}</div>
                    </div>
                    <span className="text-xs px-3 py-1.5 rounded-full font-semibold"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                      View
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>

        {results.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🏠</div>
            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>No properties found</h3>
            <p className="text-[#6B645C] mb-6">Try adjusting your filters or search a different region.</p>
            <Button onClick={() => setFilters({ ...filters, mode: '', region: '', bedrooms: '', propertyType: '', verified: false, superhost: false })}>
              Clear all filters
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>
}

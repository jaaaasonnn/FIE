import Link from 'next/link'
import { Star, MapPin, Bed, Bath, Users } from 'lucide-react'
import { Badge, VerifiedBadge } from '@/components/ui/Badge'

const MOCK_LISTINGS = [
  {
    id: '1',
    title: 'Luxury 3BR Apartment in East Legon',
    type: 'Apartment',
    region: 'Greater Accra',
    city: 'Accra',
    neighbourhood: 'East Legon',
    bedrooms: 3, bathrooms: 2, maxGuests: 6,
    priceNightly: 120,
    rating: 4.9, reviews: 47,
    photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=75',
    modes: ['SHORT_STAY', 'TEMP_STAY'],
    verified: true, superhost: true,
    amenities: ['WiFi', 'Pool', 'AC', 'Generator'],
  },
  {
    id: '2',
    title: 'Modern Studio in Cantonments',
    type: 'Studio',
    region: 'Greater Accra',
    city: 'Accra',
    neighbourhood: 'Cantonments',
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    priceNightly: 65,
    rating: 4.8, reviews: 23,
    photo: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600&q=75',
    modes: ['SHORT_STAY'],
    verified: true, superhost: false,
    amenities: ['WiFi', 'AC', 'Security'],
  },
  {
    id: '3',
    title: 'Spacious 4BR House, Airport Hills',
    type: 'House',
    region: 'Greater Accra',
    city: 'Accra',
    neighbourhood: 'Airport Hills',
    bedrooms: 4, bathrooms: 3, maxGuests: 8,
    priceMonthly: 1800,
    rating: 4.7, reviews: 12,
    photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600&q=75',
    modes: ['TEMP_STAY', 'PERMANENT'],
    verified: true, superhost: false,
    amenities: ['WiFi', 'Generator', 'Parking', 'Boys Quarters'],
  },
  {
    id: '4',
    title: 'Cosy Villa in Kumasi (Nhyiaeso)',
    type: 'Villa',
    region: 'Ashanti',
    city: 'Kumasi',
    neighbourhood: 'Nhyiaeso',
    bedrooms: 5, bathrooms: 4, maxGuests: 10,
    priceNightly: 200,
    rating: 5.0, reviews: 8,
    photo: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=600&q=75',
    modes: ['SHORT_STAY', 'TEMP_STAY'],
    verified: true, superhost: true,
    amenities: ['Pool', 'WiFi', 'AC', 'Garden', 'Gym'],
  },
  {
    id: '5',
    title: 'Furnished 2BR Apartment, Labone',
    type: 'Apartment',
    region: 'Greater Accra',
    city: 'Accra',
    neighbourhood: 'Labone',
    bedrooms: 2, bathrooms: 2, maxGuests: 4,
    priceMonthly: 950,
    rating: 4.6, reviews: 31,
    photo: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=75',
    modes: ['TEMP_STAY', 'PERMANENT'],
    verified: true, superhost: false,
    amenities: ['WiFi', 'AC', 'CCTV', 'Parking'],
  },
  {
    id: '6',
    title: 'Private Guestroom, Osu',
    type: 'Guestroom',
    region: 'Greater Accra',
    city: 'Accra',
    neighbourhood: 'Osu',
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    priceNightly: 38,
    rating: 4.7, reviews: 55,
    photo: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=75',
    modes: ['SHORT_STAY'],
    verified: false, superhost: false,
    amenities: ['WiFi', 'AC'],
  },
]

const MODE_LABELS: Record<string, { label: string; color: 'gold' | 'blue' | 'green' }> = {
  SHORT_STAY: { label: '🌙 Short Stay', color: 'gold' },
  TEMP_STAY: { label: '📅 Monthly', color: 'blue' },
  PERMANENT: { label: '🏠 Long-Term', color: 'green' },
}

export function FeaturedListings() {
  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--amber)' }}>
              Hand-picked for you
            </p>
            <h2 className="text-4xl font-bold" style={{ color: 'var(--brown-dark)' }}>
              Featured Properties
            </h2>
          </div>
          <Link
            href="/search"
            className="hidden sm:flex items-center gap-1 text-sm font-semibold hover:gap-2 transition-all"
            style={{ color: 'var(--amber)' }}
          >
            View all <span>→</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {MOCK_LISTINGS.map((listing) => (
            <Link key={listing.id} href={`/listings/${listing.id}`} className="listing-card group block bg-white rounded-2xl overflow-hidden border border-stone-100 shadow-sm">
              {/* Photo */}
              <div className="relative h-52 overflow-hidden">
                <img
                  src={listing.photo}
                  alt={listing.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
                {/* Mode badges */}
                <div className="absolute top-3 left-3 flex gap-1">
                  {listing.modes.slice(0, 2).map((m) => (
                    <span
                      key={m}
                      className="text-xs px-2 py-1 rounded-full font-medium"
                      style={{ backgroundColor: 'rgba(26,18,8,0.75)', color: 'var(--gold)', backdropFilter: 'blur(4px)' }}
                    >
                      {MODE_LABELS[m]?.label}
                    </span>
                  ))}
                </div>
                {/* Heart */}
                <button className="absolute top-3 right-3 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center hover:bg-white transition-all">
                  <span className="text-sm">♡</span>
                </button>
              </div>

              {/* Body */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-sm leading-snug flex-1" style={{ color: 'var(--brown-dark)' }}>
                    {listing.title}
                  </h3>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Star size={12} className="fill-amber-400 text-amber-400" />
                    <span className="text-xs font-medium">{listing.rating}</span>
                    <span className="text-xs text-stone-400">({listing.reviews})</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs text-stone-500 mb-3">
                  <MapPin size={12} />
                  {listing.neighbourhood}, {listing.city}
                </div>

                <div className="flex items-center gap-3 text-xs text-stone-500 mb-4">
                  <span className="flex items-center gap-1"><Bed size={12} />{listing.bedrooms}bd</span>
                  <span className="flex items-center gap-1"><Bath size={12} />{listing.bathrooms}ba</span>
                  <span className="flex items-center gap-1"><Users size={12} />Up to {listing.maxGuests}</span>
                </div>

                <div className="flex items-center gap-2">
                  {listing.verified && <VerifiedBadge />}
                  {listing.superhost && <Badge variant="gold">⭐ Superhost</Badge>}
                </div>
              </div>

              {/* Footer */}
              <div className="px-4 pb-4 flex items-center justify-between">
                <div>
                  {listing.priceNightly && (
                    <span className="text-base font-bold" style={{ color: 'var(--brown-dark)' }}>
                      ${listing.priceNightly}
                      <span className="text-xs font-normal text-stone-500">/night</span>
                    </span>
                  )}
                  {listing.priceMonthly && !listing.priceNightly && (
                    <span className="text-base font-bold" style={{ color: 'var(--brown-dark)' }}>
                      ${listing.priceMonthly}
                      <span className="text-xs font-normal text-stone-500">/month</span>
                    </span>
                  )}
                  <div className="text-xs text-stone-400">
                    ≈ GH₵ {((listing.priceNightly || listing.priceMonthly || 0) * 15.5).toLocaleString()}
                  </div>
                </div>
                <button
                  className="text-xs px-4 py-2 rounded-full font-semibold transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--amber)', color: '#fff' }}
                >
                  View
                </button>
              </div>
            </Link>
          ))}
        </div>

        <div className="text-center mt-8 sm:hidden">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold"
            style={{ backgroundColor: 'var(--amber)', color: '#fff' }}
          >
            View All Properties →
          </Link>
        </div>
      </div>
    </section>
  )
}

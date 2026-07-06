'use client'

import Link from 'next/link'
import { Heart, MapPin, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'

const MOCK_WISHLIST = [
  { id: '1', title: 'Luxury 3BR Apartment in East Legon', city: 'Accra', neighbourhood: 'East Legon', priceNightly: 120, rating: 4.9, reviews: 47, photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400&q=70', modes: ['SHORT_STAY', 'TEMP_STAY'], superhost: true },
  { id: '4', title: 'Cosy Villa in Kumasi (Nhyiaeso)', city: 'Kumasi', neighbourhood: 'Nhyiaeso', priceNightly: 200, rating: 5.0, reviews: 8, photo: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=400&q=70', modes: ['SHORT_STAY'], superhost: true },
  { id: '7', title: 'Serviced Apartment, Ridge', city: 'Accra', neighbourhood: 'Ridge', priceNightly: 95, rating: 4.5, reviews: 19, photo: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&q=70', modes: ['SHORT_STAY', 'TEMP_STAY'], superhost: false },
]

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay', TEMP_STAY: '📅 Monthly', PERMANENT: '🏠 Long-Term'
}

export default function WishlistPage() {
  const [items, setItems] = useState(MOCK_WISHLIST)

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <Heart size={22} style={{ color: '#EF4444' }} className="fill-red-500" />
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                Your Wishlist
              </h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>
                {items.length} saved {items.length === 1 ? 'property' : 'properties'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Dashboard nav */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
          {[
            { href: '/dashboard/guest', label: '📋 Bookings' },
            { href: '/dashboard/guest/wishlist', label: '❤️ Wishlist', active: true },
            { href: '/dashboard/guest/messages', label: '💬 Messages' },
            { href: '/dashboard/guest/payments', label: '💳 Payments' },
          ].map(({ href, label, active }) => (
            <Link key={href} href={href}
              className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{ backgroundColor: active ? 'var(--brown-dark)' : '#fff', color: active ? 'var(--gold)' : '#374151', border: active ? 'none' : '1px solid #E5E7EB' }}>
              {label}
            </Link>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">💔</div>
            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>No saved properties yet</h3>
            <p className="text-[#6B645C] mb-6">Tap the ♡ on any listing to save it here.</p>
            <Link href="/search" className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
              Browse Properties
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((listing) => (
              <div key={listing.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden group relative">
                {/* Remove button */}
                <button
                  onClick={() => remove(listing.id)}
                  className="absolute top-3 right-3 z-10 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow hover:bg-red-50 transition-all"
                  title="Remove from wishlist"
                >
                  <Trash2 size={14} style={{ color: '#EF4444' }} />
                </button>

                <Link href={`/listings/${listing.id}`}>
                  <div className="relative h-48 overflow-hidden">
                    <img src={listing.photo} alt={listing.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                    <div className="absolute top-3 left-3 flex gap-1">
                      {listing.modes.slice(0, 1).map((m) => (
                        <span key={m} className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: 'rgba(26,18,8,0.75)', color: 'var(--color-accent)' }}>
                          {MODE_LABELS[m]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-sm leading-snug" style={{ color: 'var(--color-text-primary)' }}>{listing.title}</h3>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <Star size={12} className="fill-amber-400 text-amber-400" />
                        <span className="text-xs font-medium">{listing.rating}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-[#6B645C] mb-3">
                      <MapPin size={11} />{listing.neighbourhood}, {listing.city}
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                          ${listing.priceNightly}<span className="text-xs font-normal text-[#6B645C]">/night</span>
                        </span>
                        <div className="text-xs text-stone-400">≈ GH₵ {(listing.priceNightly * 15.5).toLocaleString()}</div>
                      </div>
                      {listing.superhost && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FBE8BB', color: '#92400E' }}>⭐ Superhost</span>
                      )}
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

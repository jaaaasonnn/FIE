'use client'

import Link from 'next/link'
import { Heart, MapPin, Star, Trash2, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { formatUsdCompact, getPrimaryPrice } from '@/lib/utils'
import { aboutCedis, cardPrice, type CardPrice } from '@/lib/exploreRows'
import { PhoneEmpty } from '@/components/ui/PhoneEmpty'

type WishlistItem = {
  id: string
  wishlistId: string
  title: string
  city: string
  neighbourhood: string | null
  price: number | null
  priceUnit: string
  /** The price as Explore's cards write it: per night for a home with short stays, otherwise per month */
  card: CardPrice | null
  rating: number
  reviews: number
  photo: string
  modes: string[]
  superhost: boolean
}

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: 'Short Stay', TEMP_STAY: 'Monthly', PERMANENT: 'Long-Term',
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value === 'string') {
    try { return JSON.parse(value) as string[] } catch { return [] }
  }
  return []
}

function firstPhoto(photos: unknown): string {
  const arr = parseJsonArray(photos)
  return arr[0] ?? ''
}

export default function WishlistPage() {
  const { user, loading: authLoading } = useAuth()
  const { rate: ghsRate } = useExchangeRate()
  const [loadedItems, setItems] = useState<WishlistItem[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  // Loading and the visible list are derived from which user the data was
  // loaded for, rather than reset/toggled inside the effect.
  const isCurrent = !!user && loadedFor === user.id
  const items     = isCurrent ? loadedItems : []
  const loading   = !!user && !isCurrent

  useEffect(() => {
    if (authLoading || !user) return
    const userId = user.id
    let active = true
    fetch(`/api/wishlists?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        const rows = Array.isArray(data.wishlists) ? data.wishlists : []
        setItems(rows.map((w: {
          id: string
          listing: {
            id: string
            title: string
            city: string
            neighbourhood: string | null
            priceNightly: number | null
            priceMonthly: number | null
            priceAnnual: number | null
            avgRating: number
            reviewCount: number
            photos: string
            rentalModes: string
            host: { isSuperhost: boolean }
          }
        }) => {
          const modes = parseJsonArray(w.listing.rentalModes)
          const { price, unit } = getPrimaryPrice({
            priceNightly: w.listing.priceNightly,
            priceMonthly: w.listing.priceMonthly,
            priceAnnual:  w.listing.priceAnnual,
            rentalModes:  modes,
          })
          return {
            id:            w.listing.id,
            wishlistId:    w.id,
            title:         w.listing.title,
            city:          w.listing.city,
            neighbourhood: w.listing.neighbourhood,
            price,
            priceUnit:     unit,
            card:          cardPrice({ rentalModes: modes, priceNightly: w.listing.priceNightly, priceMonthly: w.listing.priceMonthly, priceAnnual: w.listing.priceAnnual }),
            rating:        w.listing.avgRating ?? 0,
            reviews:       w.listing.reviewCount ?? 0,
            photo:         firstPhoto(w.listing.photos),
            modes,
            superhost:     w.listing.host?.isSuperhost ?? false,
          }
        }))
      })
      .catch(() => { if (active) setItems([]) })
      .finally(() => { if (active) setLoadedFor(userId) })
    return () => { active = false }
  }, [user, authLoading])

  async function remove(listingId: string) {
    if (!user) return
    setItems((prev) => prev.filter((i) => i.id !== listingId))
    try {
      await fetch('/api/wishlists', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: user.id, listingId }),
      })
    } catch {
      // Optimistic remove already applied; refetch would be overkill for this UI
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Desktop: the dark band; a phone has the plain title below (app shell, stage 2) */}
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4 max-md:hidden">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <Heart size={22} style={{ color: '#EF4444' }} className="fill-red-500" />
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                Your Wishlist
              </h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>
                {loading || authLoading
                  ? 'Loading…'
                  : `${items.length} saved ${items.length === 1 ? 'property' : 'properties'}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="phone-title md:hidden">
        <h1>Your Wishlist</h1>
        <p>{loading || authLoading ? '\u00a0' : `${items.length} saved ${items.length === 1 ? 'property' : 'properties'}`}</p>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 max-md:pt-4">
        {/* Dashboard nav */}
        {/* (phones: the bottom bar is the way between these pages) */}
        <div className="hidden md:flex gap-2 mb-8 overflow-x-auto pb-1">
          {[
            { href: '/dashboard/guest', label: 'Bookings' },
            { href: '/dashboard/guest/wishlist', label: 'Wishlist', active: true },
            { href: '/dashboard/guest/messages', label: 'Messages' },
            { href: '/dashboard/guest/payments', label: 'Payments' },
          ].map(({ href, label, active }) => (
            <Link key={href} href={href}
              className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{ backgroundColor: active ? 'var(--brown-dark)' : '#fff', color: active ? 'var(--gold)' : '#374151', border: active ? 'none' : '1px solid #E5E7EB' }}>
              {label}
            </Link>
          ))}
        </div>

        {/* Each state has its own key: what arrives is drawn fresh, not moved from where "Loading" was */}
        {loading || authLoading ? (
          <div key="loading">
            <div className="flex flex-col items-center justify-center py-20 gap-3 max-md:hidden">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading wishlist…</p>
            </div>
            {/* A phone: two cards' worth of placeholder, each the size of a saved home's card */}
            <div className="md:hidden grid grid-cols-1 gap-5" aria-busy="true" aria-label="Loading your wishlist">
              {[0, 1].map((n) => (
                <div key={n} className="bg-white rounded-2xl overflow-hidden">
                  <span className="ph-block h-48" style={{ borderRadius: 0 }} />
                  <div className="p-4">
                    <span className="ph-block h-5 w-3/4 mb-1" />
                    <span className="ph-block h-4 w-1/2 mb-3" />
                    <span className="ph-block h-9 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : items.length === 0 ? (
          <div key="empty">
          <PhoneEmpty title="Nothing saved yet." text="Tap the heart on any home to keep it here." action={{ label: 'Explore homes', href: '/' }} />
          <div className="text-center py-20 max-md:hidden">
            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Nothing saved yet</h3>
            <p className="text-[#6B645C] mb-6 max-w-sm mx-auto">
              Tap the heart on a home you love and it&apos;ll wait for you here.
            </p>
            <Link href="/search" className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              Explore homes
            </Link>
          </div>
          </div>
        ) : (
          <div key="saved" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((listing) => (
              <div
                key={listing.id}
                className="listing-card bg-white rounded-2xl overflow-hidden group relative"
              >
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
                    {listing.photo && (
                      <img src={listing.photo} alt={listing.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100" loading="lazy" />
                    )}
                    <div className="absolute top-3 left-3 flex gap-1">
                      {listing.modes.slice(0, 1).map((m) => (
                        <span key={m} className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: 'rgba(26,18,8,0.75)', color: 'var(--color-accent)' }}>
                          {MODE_LABELS[m] ?? m}
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
                      <MapPin size={11} />{listing.neighbourhood ? `${listing.neighbourhood}, ` : ''}{listing.city}
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        {/* As Explore's cards write a price (AS10): cedis first, "About GH₵ 19,577 /night", then "$1,250.50" */}
                        {listing.card ? (
                          <>
                            <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                              <strong>{aboutCedis(listing.card.usd, ghsRate)}</strong>{' '}
                              <span className="text-xs font-normal text-[#6B645C]">{listing.card.unit}</span>
                            </span>
                            <div className="text-xs text-[#736D62]">{formatUsdCompact(listing.card.usd)}</div>
                          </>
                        ) : (
                          <span className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>-</span>
                        )}
                      </div>
                      {listing.superhost && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FBE8BB', color: '#92400E' }}><Star size={10} className="fill-current" aria-hidden /> Superhost</span>
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

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Star, MapPin, Bed, Bath, Users, Heart, Moon, CalendarDays, Key, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { useReveal } from '@/hooks/useReveal'

// ── API listing shape (parsed by /api/listings) ──────────────────────────────
type ApiListing = {
  id:            string
  title:         string
  city:          string
  neighbourhood: string | null
  bedrooms:      number
  bathrooms:     number
  maxGuests:     number
  priceNightly:  number | null
  priceMonthly:  number | null
  avgRating:     number
  reviewCount:   number
  photos:        string[]   // already JSON-parsed by the API
  rentalModes:   string[]   // already JSON-parsed by the API
  host: {
    isVerified:  boolean
    isSuperhost: boolean
  }
}

const MODE_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  SHORT_STAY: { label: 'Short Stay', icon: Moon },
  TEMP_STAY:  { label: 'Monthly',    icon: CalendarDays },
  PERMANENT:  { label: 'Long-Term',  icon: Key },
}

const EMPTY_IDS = new Set<string>()

// ── Skeleton card ────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden animate-pulse"
      style={{
        backgroundColor: 'var(--color-bg-card)',
        boxShadow: '0 4px 18px rgba(31, 27, 22, 0.06)',
      }}
    >
      <div className="h-56" style={{ backgroundColor: '#E8E2D9' }} />
      <div className="p-5 space-y-3">
        <div className="h-3.5 rounded-full w-4/5" style={{ backgroundColor: '#E8E2D9' }} />
        <div className="h-3 rounded-full w-1/2"  style={{ backgroundColor: '#EDE8E1' }} />
        <div className="h-3 rounded-full w-1/3"  style={{ backgroundColor: '#EDE8E1' }} />
        <div className="pt-3 mt-1 flex justify-between items-center"
          style={{ borderTop: '1px solid rgba(232, 225, 214, 0.6)' }}>
          <div className="h-4 rounded-full w-20" style={{ backgroundColor: '#E8E2D9' }} />
          <div className="h-3 rounded-full w-12" style={{ backgroundColor: '#EDE8E1' }} />
        </div>
      </div>
    </div>
  )
}

export function FeaturedListings() {
  const router = useRouter()
  const { user } = useAuth()
  const { rate: ghsRate } = useExchangeRate()
  const sectionRef = useReveal<HTMLElement>()
  const [listings, setListings] = useState<ApiListing[]>([])
  const [loading,  setLoading]  = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Saved IDs are tagged with the user they were loaded for, so logging out
  // (or a late response for a previous user) derives an empty set instead of
  // needing a reset inside an effect.
  const [wishlist, setWishlist] = useState<{ userId: string; ids: Set<string> } | null>(null)
  const wishlistedIds = user && wishlist?.userId === user.id ? wishlist.ids : EMPTY_IDS

  function setWishlistedIds(update: (prev: Set<string>) => Set<string>) {
    if (!user) return
    const userId = user.id
    setWishlist((prev) => ({ userId, ids: update(prev?.userId === userId ? prev.ids : new Set()) }))
  }

  // ── Fetch featured listings from the real DB ─────────────────────────
  useEffect(() => {
    fetch('/api/listings?featured=true&limit=6')
      .then((r) => r.json())
      .then((d) => setListings(d.listings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Load which featured listings are already wishlisted ──────────────
  useEffect(() => {
    if (!user) return
    const userId = user.id
    fetch(`/api/wishlists?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        const ids = new Set<string>(
          (Array.isArray(data.wishlists) ? data.wishlists : []).map(
            (w: { listingId: string }) => w.listingId,
          ),
        )
        setWishlist({ userId, ids })
      })
      .catch(() => setWishlist({ userId, ids: new Set() }))
  }, [user])

  async function toggleWishlist(e: React.MouseEvent, listingId: string) {
    e.preventDefault()
    e.stopPropagation()
    if (!user) {
      router.push('/login?redirect=/')
      return
    }
    if (busyId) return
    setBusyId(listingId)
    const was = wishlistedIds.has(listingId)
    setWishlistedIds((prev) => {
      const next = new Set(prev)
      if (was) next.delete(listingId)
      else next.add(listingId)
      return next
    })
    try {
      const res  = await fetch('/api/wishlists', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: user.id, listingId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setWishlistedIds((prev) => {
          const next = new Set(prev)
          if (was) next.add(listingId)
          else next.delete(listingId)
          return next
        })
      } else {
        setWishlistedIds((prev) => {
          const next = new Set(prev)
          if (data.wishlisted) next.add(listingId)
          else next.delete(listingId)
          return next
        })
      }
    } catch {
      setWishlistedIds((prev) => {
        const next = new Set(prev)
        if (was) next.add(listingId)
        else next.delete(listingId)
        return next
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section ref={sectionRef} className="py-24 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-7xl mx-auto">

        {/* Heading row */}
        <div className="reveal-item flex items-end justify-between mb-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: 'var(--color-accent)', letterSpacing: '0.1em' }}>
              Hand-picked for you
            </p>
            <h2 className="text-4xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Featured Properties
            </h2>
          </div>
          <Link href="/search"
            className="hidden sm:flex items-center gap-1 text-sm font-semibold transition-all hover:gap-2"
            style={{ color: 'var(--color-accent)' }}>
            View all <span>→</span>
          </Link>
        </div>

        {/* Grid — skeleton while loading */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : listings.length === 0
            ? (
              <div className="col-span-full text-center py-16 px-4">
                <p className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  No featured homes just yet
                </p>
                <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>
                  Browse all available places. Something lovely is waiting.
                </p>
                <Link href="/search"
                  className="inline-flex px-6 py-3 rounded-full text-sm font-semibold"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                  Explore homes
                </Link>
              </div>
            )
            : listings.map((l, i) => {
                const price    = l.priceNightly ?? l.priceMonthly ?? 0
                const unit     = l.priceNightly ? '/night' : '/mo'
                const ghsPrice = Math.round(price * ghsRate).toLocaleString()
                const photo    = l.photos?.[0] ?? ''
                const mode     = MODE_LABELS[l.rentalModes?.[0]]

                return (
                  <div key={l.id} className="reveal-item" style={{ '--i': i } as React.CSSProperties}>
                    <Link
                      href={`/listings/${l.id}`}
                      className="listing-card group block h-full rounded-2xl overflow-hidden"
                      style={{
                        backgroundColor: 'var(--color-bg-card)',
                        textDecoration:  'none',
                      }}
                    >
                      {/* Image — taller, photo-forward */}
                      <div className="relative h-56 overflow-hidden bg-stone-100">
                        {photo && (
                          <img src={photo} alt={l.title}
                            className="listing-card-img w-full h-full object-cover transition-transform duration-500 ease-out"
                            loading="lazy" />
                        )}
                        {mode && (
                          <span className="absolute top-3 left-3 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', backdropFilter: 'blur(6px)' }}>
                            <mode.icon size={11} />
                            {mode.label}
                          </span>
                        )}
                        <button
                          onClick={(e) => toggleWishlist(e, l.id)}
                          disabled={busyId === l.id}
                          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-200 hover:scale-105"
                          style={{ backgroundColor: 'rgba(255,255,255,0.92)', boxShadow: '0 2px 8px rgba(31,27,22,0.1)' }}
                          aria-label={wishlistedIds.has(l.id) ? 'Remove from wishlist' : 'Save listing'}>
                          <Heart
                            size={14}
                            className={wishlistedIds.has(l.id) ? 'fill-red-500' : ''}
                            style={{ color: wishlistedIds.has(l.id) ? '#EF4444' : 'var(--color-text-secondary)' }}
                          />
                        </button>
                      </div>

                      {/* Body */}
                      <div className="p-5 pb-0">
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <h3 className="font-semibold text-sm leading-snug flex-1 line-clamp-2"
                            style={{ color: 'var(--color-text-primary)' }}>
                            {l.title}
                          </h3>
                          <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                            <Star size={11} className="fill-[#C9932E] text-[#C9932E]" />
                            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                              {l.avgRating.toFixed(1)}
                            </span>
                            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                              ({l.reviewCount})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 text-xs mb-3"
                          style={{ color: 'var(--color-text-secondary)' }}>
                          <MapPin size={11} className="flex-shrink-0" />
                          {l.neighbourhood}, {l.city}
                        </div>

                        <div className="flex items-center gap-3 text-xs mb-3"
                          style={{ color: 'var(--color-text-muted)' }}>
                          <span className="flex items-center gap-1"><Bed   size={11} />{l.bedrooms} bd</span>
                          <span className="flex items-center gap-1"><Bath  size={11} />{l.bathrooms} ba</span>
                          <span className="flex items-center gap-1"><Users size={11} />Up to {l.maxGuests}</span>
                        </div>

                        {(l.host?.isVerified || l.host?.isSuperhost) && (
                          <div className="flex items-center gap-1.5 mb-3">
                            {l.host.isVerified && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: '#EBF0F7', color: '#3A5A8A' }}>
                                Verified
                              </span>
                            )}
                            {l.host.isSuperhost && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: 'var(--color-accent-subtle)', color: '#8A5E10' }}>
                                Superhost
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Price footer */}
                      <div className="px-5 py-4 mt-1 flex items-end justify-between"
                        style={{ borderTop: '1px solid rgba(232, 225, 214, 0.55)' }}>
                        <div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                              ${price.toLocaleString()}
                            </span>
                            <span className="text-xs font-normal" style={{ color: 'var(--color-text-secondary)' }}>
                              {unit}
                            </span>
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                            ≈ GH₵ {ghsPrice}
                          </div>
                        </div>
                        <span className="text-xs font-semibold flex items-center gap-0.5 transition-all group-hover:gap-1.5"
                          style={{ color: 'var(--color-accent)' }}>
                          View <span className="text-sm">→</span>
                        </span>
                      </div>
                    </Link>
                  </div>
                )
              })}
        </div>

        {/* Mobile view-all CTA */}
        <div className="text-center mt-8 sm:hidden">
          <Link href="/search"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
            View All Properties →
          </Link>
        </div>
      </div>
    </section>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Star, Heart } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { RENTAL_MODES } from '@/lib/rentalModes'
import { formatUsdCompact } from '@/lib/utils'
import { CheckedBadge } from '@/components/listing/CheckedBadge'
import type { PublicCheck } from '@/lib/listingCheckRules'

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
  priceAnnual?:  number | null
  priceMonthly:  number | null
  avgRating:     number
  reviewCount:   number
  photos:        string[]   // already JSON-parsed by the API
  rentalModes:   string[]   // already JSON-parsed by the API
  /** Set while FieGH's check of the address and photos stands */
  check?:        PublicCheck | null
  host: {
    isVerified:  boolean
    isSuperhost: boolean
  }
}

const MODE_LABELS: Record<string, string> = Object.fromEntries(
  RENTAL_MODES.map(({ value, label }) => [value, label]),
)

const EMPTY_IDS = new Set<string>()

// ── Skeleton card: same frameless shape as a loaded card ────────────────────
function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[4/3] rounded-2xl" style={{ backgroundColor: '#E8E2D9' }} />
      <div className="pt-3 space-y-2">
        <div className="h-3.5 rounded-full w-3/5" style={{ backgroundColor: '#E8E2D9' }} />
        <div className="h-3 rounded-full w-4/5" style={{ backgroundColor: '#EDE8E1' }} />
        <div className="h-3 rounded-full w-2/5" style={{ backgroundColor: '#EDE8E1' }} />
        <div className="h-3.5 rounded-full w-1/3" style={{ backgroundColor: '#E8E2D9' }} />
      </div>
    </div>
  )
}

export function FeaturedListings() {
  const router = useRouter()
  const { user } = useAuth()
  const { rate: ghsRate } = useExchangeRate()
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
    <section className="pt-14 md:pt-20" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="flex items-baseline justify-between gap-4 mb-7">
          <h2 className="text-[1.75rem] md:text-[2rem]" style={{ color: 'var(--color-text-primary)' }}>
            Featured homes
          </h2>
          <Link
            href="/search"
            className="focus-ring rounded-sm text-sm font-semibold underline underline-offset-4 decoration-1 whitespace-nowrap"
            style={{ color: 'var(--color-accent-deep)' }}
          >
            View all homes
          </Link>
        </div>

        {/* Grid, with skeletons while loading */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
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
            : listings.map((l) => {
                // Long-term-only homes show the yearly price with its monthly equivalent
                const yearly   = l.rentalModes?.length === 1 && l.rentalModes[0] === 'PERMANENT' && l.priceAnnual ? l.priceAnnual : null
                const price    = yearly ?? l.priceNightly ?? l.priceMonthly ?? 0
                const unit     = yearly ? 'year' : l.priceNightly ? 'night' : 'month'
                const ghsPrice = Math.round(price * ghsRate).toLocaleString()
                const photo    = l.photos?.[0] ?? ''
                const mode     = MODE_LABELS[l.rentalModes?.[0]]
                const place    = [l.neighbourhood, l.city].filter(Boolean).join(', ')
                const saved    = wishlistedIds.has(l.id)

                return (
                  <article key={l.id} className="photo-zoom-host relative">
                    <Link
                      href={`/listings/${l.id}`}
                      className="focus-ring block rounded-2xl"
                      style={{ textDecoration: 'none' }}
                    >
                      <div
                        className="relative aspect-[4/3] rounded-2xl overflow-hidden"
                        style={{ backgroundColor: 'var(--color-border)' }}
                      >
                        {photo && (
                          <Image src={photo} alt={l.title}
                            fill
                            sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
                            className="photo-zoom object-cover" />
                        )}
                      </div>

                      <div className="pt-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="text-[15px] font-semibold truncate"
                            style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.011em' }}>
                            {place}
                          </h3>
                          <span className="flex items-center gap-1 flex-shrink-0 text-sm"
                            style={{ color: 'var(--color-text-primary)' }}>
                            {l.reviewCount > 0 ? (
                              <>
                                <Star size={12} className="fill-current" aria-hidden />
                                <span>
                                  {l.avgRating.toFixed(1)}
                                  <span className="sr-only"> out of 5, </span>
                                  <span style={{ color: 'var(--color-text-secondary)' }}> ({l.reviewCount})</span>
                                </span>
                              </>
                            ) : (
                              'New'
                            )}
                          </span>
                        </div>

                        <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>
                          {l.title}
                        </p>
                        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                          {[mode, `${l.bedrooms} bed`, `${l.bathrooms} bath`, `sleeps ${l.maxGuests}`]
                            .filter(Boolean).join(', ')}
                        </p>

                        <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-primary)' }}>
                          <span className="font-bold">{formatUsdCompact(price)}</span> per {unit}
                          <span style={{ color: 'var(--color-text-secondary)' }}>
                            {yearly ? ` (about ${formatUsdCompact(yearly / 12)} a month)` : ` (about GH₵ ${ghsPrice})`}
                          </span>
                        </p>
                        {l.check && <div className="mt-2"><CheckedBadge check={l.check} /></div>}
                      </div>
                    </Link>

                    <button
                      onClick={(e) => toggleWishlist(e, l.id)}
                      disabled={busyId === l.id}
                      aria-pressed={saved}
                      className="pressable focus-ring absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(255,255,255,0.94)', boxShadow: '0 2px 8px rgba(31,27,22,0.12)' }}
                      aria-label={saved ? 'Remove from wishlist' : 'Save listing'}>
                      <Heart
                        size={16}
                        className={saved ? 'fill-red-500' : ''}
                        style={{ color: saved ? '#EF4444' : 'var(--color-text-primary)' }}
                      />
                    </button>
                  </article>
                )
              })}
        </div>
      </div>
    </section>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import {
  Star, MapPin, Bed, Bath, Users, Wifi, Shield, Zap, Wind, Car, Camera,
  Share2, Heart, Flag, ChevronLeft, ChevronRight, CheckCircle, Loader2,
  AlertCircle,
} from 'lucide-react'
import Link from 'next/link'
import { VerifiedBadge, SuperhostBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'

// ── API types ────────────────────────────────────────────────────────────────
type ApiListing = {
  id:            string
  title:         string
  description:   string
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
  advanceMonthsRequired: number | null
  amenities:     string[]
  rentalModes:   string[]
  photos:        string[]
  rules:         string[]
  cancellationPolicy: string
  instantBook:   boolean
  minStayNights: number
  damageDeposit: number | null
  avgRating:     number
  reviewCount:   number
  host: {
    id:           string
    name:         string
    profilePhoto: string | null
    isVerified:   boolean
    isSuperhost:  boolean
    trustScore:   number
    createdAt:    string
  }
  reviews: Array<{
    id:       string
    rating:   number
    comment:  string
    createdAt: string
    reviewer: { id: string; name: string; profilePhoto: string | null }
  }>
}

// ── Static helpers ────────────────────────────────────────────────────────────
const AMENITY_ICONS: Record<string, React.ReactNode> = {
  'WiFi':               <Wifi   size={16} />,
  'Generator/Inverter': <Zap    size={16} />,
  'Air Conditioning':   <Wind   size={16} />,
  'CCTV':               <Camera size={16} />,
  'Security Guard':     <Shield size={16} />,
  'Parking':            <Car    size={16} />,
}

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  SHORT_STAY: { label: '🌙 Short Stay',        color: 'var(--color-accent)' },
  TEMP_STAY:  { label: '📅 Temporary Stay',    color: '#2563EB' },
  PERMANENT:  { label: '🏠 Permanent Rental',  color: '#059669' },
}

type BookedRange = { start: string; end: string; status: string }

const dpInputStyle: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '10px 12px', borderRadius: 12,
  border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text-primary)', outline: 'none', cursor: 'pointer',
  fontFamily: "'Plus Jakarta Sans', sans-serif",
}

// ── Page component ────────────────────────────────────────────────────────────
export default function ListingDetailPage() {
  const { id: listingId } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()

  // Listing data
  const [listing,    setListing]    = useState<ApiListing | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [notFound,    setNotFound]   = useState(false)

  // UI state
  const [photoIdx,     setPhotoIdx]     = useState(0)
  const [selectedMode, setSelectedMode] = useState('')
  const [wishlisted,   setWishlisted]   = useState(false)
  const [wishBusy,     setWishBusy]     = useState(false)
  const [months,       setMonths]       = useState(1)

  // Date state
  const [checkIn,  setCheckIn]  = useState<Date | null>(null)
  const [checkOut, setCheckOut] = useState<Date | null>(null)

  // Availability state
  const [availLoading, setAvailLoading] = useState(false)
  const [bookedRanges, setBookedRanges] = useState<BookedRange[]>([])
  const [blockedDates, setBlockedDates] = useState<Date[]>([])

  // Booking submit state
  const [bookLoading, setBookLoading] = useState(false)
  const [bookError,   setBookError]   = useState('')

  // ── Fetch listing data ────────────────────────────────────────────────
  useEffect(() => {
    setListLoading(true)
    fetch(`/api/listings/${listingId}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then((d) => {
        if (!d) return
        const l: ApiListing = d.listing
        setListing(l)
        setSelectedMode(l.rentalModes?.[0] ?? '')
      })
      .catch(() => setNotFound(true))
      .finally(() => setListLoading(false))
  }, [listingId])

  // ── Fetch availability ────────────────────────────────────────────────
  const fetchAvailability = useCallback(async () => {
    setAvailLoading(true)
    try {
      const res  = await fetch(`/api/listings/${listingId}/availability`)
      const data = await res.json()
      setBookedRanges(data.bookedRanges ?? [])
      setBlockedDates((data.blockedDates ?? []).map((d: string) => new Date(d)))
    } catch { /* non-fatal */ }
    finally  { setAvailLoading(false) }
  }, [listingId])

  useEffect(() => { fetchAvailability() }, [fetchAvailability])

  // ── Sync heart with real wishlist status ───────────────────────────────
  useEffect(() => {
    if (!user || !listingId) {
      setWishlisted(false)
      return
    }
    fetch(`/api/wishlists?userId=${user.id}`)
      .then((r) => r.json())
      .then((data) => {
        const rows = Array.isArray(data.wishlists) ? data.wishlists : []
        setWishlisted(rows.some((w: { listingId: string }) => w.listingId === listingId))
      })
      .catch(() => setWishlisted(false))
  }, [user, listingId])

  async function toggleWishlist() {
    if (!user) {
      router.push(`/login?redirect=/listings/${listingId}`)
      return
    }
    if (wishBusy) return
    setWishBusy(true)
    const prev = wishlisted
    setWishlisted(!prev)
    try {
      const res  = await fetch('/api/wishlists', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: user.id, listingId }),
      })
      const data = await res.json()
      if (!res.ok) setWishlisted(prev)
      else setWishlisted(!!data.wishlisted)
    } catch {
      setWishlisted(prev)
    } finally {
      setWishBusy(false)
    }
  }

  const excludeIntervals = bookedRanges.map((r) => ({ start: new Date(r.start), end: new Date(r.end) }))

  // ── Loading screen ────────────────────────────────────────────────────
  if (listLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading listing…</p>
        </div>
      </div>
    )
  }

  if (notFound || !listing) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-center">
          <div className="text-5xl mb-4">🏠</div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Listing not found</h2>
          <p className="mb-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>This listing may have been removed or is no longer active.</p>
          <Button onClick={() => router.push('/search')}>Browse all listings</Button>
        </div>
      </div>
    )
  }

  // ── Price calculations ────────────────────────────────────────────────
  const nightsCount = checkIn && checkOut
    ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000))
    : 0

  const basePrice =
    selectedMode === 'SHORT_STAY' ? (listing.priceNightly  ?? 0) * nightsCount
    : selectedMode === 'TEMP_STAY' ? (listing.priceMonthly ?? 0) * months
    : (listing.priceAnnual ?? 0)

  const serviceFee = basePrice * 0.12
  const total      = basePrice + serviceFee + (listing.damageDeposit ?? 0)

  // ── Book handler ──────────────────────────────────────────────────────
  async function handleBook() {
    setBookError('')
    if (!listing) return   // type guard (listing is always set by this point in the UI)

    if (selectedMode === 'SHORT_STAY') {
      if (!checkIn || !checkOut) { setBookError('Please select both check-in and check-out dates.'); return }
      if (nightsCount < listing.minStayNights) { setBookError(`Minimum stay is ${listing.minStayNights} nights.`); return }
    }
    if ((selectedMode === 'TEMP_STAY' || selectedMode === 'PERMANENT') && !checkIn) {
      setBookError('Please select your move-in date.'); return
    }

    setBookLoading(true)
    try {
      if (!listing) return
      let effectiveCheckOut = checkOut
      if (selectedMode === 'TEMP_STAY' && checkIn) {
        effectiveCheckOut = new Date(checkIn); effectiveCheckOut.setMonth(effectiveCheckOut.getMonth() + months)
      } else if (selectedMode === 'PERMANENT' && checkIn) {
        effectiveCheckOut = new Date(checkIn); effectiveCheckOut.setFullYear(effectiveCheckOut.getFullYear() + 1)
      }

      const res = await fetch('/api/bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          guestId:        user!.id,
          rentalMode:     selectedMode,
          checkIn:        checkIn!.toISOString(),
          checkOut:       effectiveCheckOut!.toISOString(),
          nightsOrMonths: selectedMode === 'SHORT_STAY' ? nightsCount : months,
        }),
      })
      const data = await res.json()

      if (res.status === 409) {
        await fetchAvailability()
        setBookError('Those dates just became unavailable. The calendar has been updated — please pick new dates.')
        setCheckIn(null); setCheckOut(null)
        return
      }
      if (!res.ok) { setBookError(data.error ?? 'Failed to create booking.'); return }

      router.push(`/checkout/${data.booking.id}`)
    } catch {
      setBookError('Network error. Please try again.')
    } finally {
      setBookLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const photos   = listing.photos ?? []
  const hostJoined = new Date(listing.host.createdAt)
    .toLocaleDateString('en-GH', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-2">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <Link href="/"       className="hover:text-[#C9932E]">Home</Link><span>/</span>
          <Link href="/search" className="hover:text-[#C9932E]">Search</Link><span>/</span>
          <Link href={`/search?region=${listing.region}`} className="hover:text-[#C9932E]">{listing.region}</Link><span>/</span>
          <span style={{ color: 'var(--color-text-primary)' }}>{listing.neighbourhood ?? listing.city}</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">

        {/* Title row */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {listing.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="flex items-center gap-1">
                <Star size={14} className="fill-amber-400 text-amber-400" />
                <strong>{listing.avgRating.toFixed(1)}</strong> ({listing.reviewCount} reviews)
              </span>
              <span>·</span>
              <span className="flex items-center gap-1"><MapPin size={14} />{listing.neighbourhood ?? listing.city}, {listing.city}</span>
              {listing.host.isSuperhost && <SuperhostBadge />}
              {listing.host.isVerified  && <VerifiedBadge />}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button className="p-2 rounded-full hover:bg-stone-100 transition-all" style={{ color: 'var(--color-text-secondary)' }}><Share2 size={18} /></button>
            <button onClick={toggleWishlist} disabled={wishBusy}
              className="p-2 rounded-full hover:bg-stone-100 transition-all"
              style={{ color: wishlisted ? '#EF4444' : '#6B7280' }}
              aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}>
              <Heart size={18} className={wishlisted ? 'fill-red-500' : ''} />
            </button>
            <button className="p-2 rounded-full hover:bg-stone-100 transition-all" style={{ color: 'var(--color-text-secondary)' }}><Flag size={16} /></button>
          </div>
        </div>

        {/* Photo gallery */}
        {photos.length > 0 && (
          <>
            <div className="relative rounded-2xl overflow-hidden mb-8 aspect-[16/9] sm:aspect-[16/7] bg-stone-200">
              <img src={photos[photoIdx]} alt={listing.title} className="w-full h-full object-cover" />
              {photos.length > 1 && (
                <>
                  <button onClick={() => setPhotoIdx((p) => (p - 1 + photos.length) % photos.length)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all">
                    <ChevronLeft size={20} />
                  </button>
                  <button onClick={() => setPhotoIdx((p) => (p + 1) % photos.length)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all">
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                {photos.map((_, i) => (
                  <button key={i} onClick={() => setPhotoIdx(i)}
                    className="w-2 h-2 rounded-full transition-all"
                    style={{ backgroundColor: i === photoIdx ? '#fff' : 'rgba(255,255,255,0.5)' }} />
                ))}
              </div>
              <div className="absolute top-4 right-4 px-3 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                {photoIdx + 1} / {photos.length}
              </div>
            </div>
            <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
              {photos.map((p, i) => (
                <button key={i} onClick={() => setPhotoIdx(i)}
                  className="flex-shrink-0 w-20 h-16 rounded-xl overflow-hidden border-2 transition-all"
                  style={{ borderColor: i === photoIdx ? 'var(--color-accent)' : 'transparent' }}>
                  <img src={p} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Left: listing details ──────────────────────────────── */}
          <div className="lg:col-span-2 space-y-8">

            {/* Quick facts */}
            <div className="grid grid-cols-3 gap-4 p-5 rounded-2xl border"
              style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
              {[
                { icon: <Bed   size={20} />, val: `${listing.bedrooms} Bedrooms` },
                { icon: <Bath  size={20} />, val: `${listing.bathrooms} Bathrooms` },
                { icon: <Users size={20} />, val: `Up to ${listing.maxGuests} guests` },
              ].map(({ icon, val }) => (
                <div key={val} className="text-center">
                  <div className="flex justify-center mb-1" style={{ color: 'var(--color-accent)' }}>{icon}</div>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{val}</p>
                </div>
              ))}
            </div>

            {/* Rental modes */}
            <div>
              <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Available Rental Options</h3>
              <div className="space-y-3">
                {listing.rentalModes.map((m) => (
                  <div key={m} className="p-4 rounded-xl border transition-colors"
                    style={{
                      borderColor:     selectedMode === m ? 'var(--color-accent)' : 'var(--color-border)',
                      backgroundColor: selectedMode === m ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)',
                    }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                          {MODE_LABELS[m]?.label ?? m}
                        </span>
                        {m === 'SHORT_STAY' && listing.priceNightly && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            From <strong>${listing.priceNightly}</strong>/night
                          </p>
                        )}
                        {m === 'TEMP_STAY' && listing.priceMonthly && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <strong>${listing.priceMonthly}</strong>/month · 1–11 months
                          </p>
                        )}
                        {m === 'PERMANENT' && (
                          <>
                            {listing.priceAnnual && (
                              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                                <strong>${listing.priceAnnual.toLocaleString()}</strong>/year · 12+ months
                              </p>
                            )}
                            {listing.advanceMonthsRequired && (
                              <p className="text-xs font-medium mt-1" style={{ color: '#DC2626' }}>
                                ⚠️ {listing.advanceMonthsRequired} months advance payment required upfront
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      <div className="text-xs px-3 py-1 rounded-full font-medium"
                        style={{ backgroundColor: `${MODE_LABELS[m]?.color ?? '#888'}18`, color: MODE_LABELS[m]?.color ?? '#888' }}>
                        Available
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>About this property</h3>
              <div className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--color-text-secondary)' }}>
                {listing.description}
              </div>
            </div>

            {/* Amenities */}
            <div>
              <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Amenities</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {listing.amenities.map((a) => (
                  <div key={a} className="flex items-center gap-2 text-sm p-3 rounded-xl"
                    style={{ color: '#4A4540', backgroundColor: 'var(--color-bg)' }}>
                    <span style={{ color: 'var(--color-accent)' }}>{AMENITY_ICONS[a] ?? <CheckCircle size={16} />}</span>
                    {a}
                  </div>
                ))}
              </div>
            </div>

            {/* House rules */}
            {listing.rules.length > 0 && (
              <div>
                <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>House Rules</h3>
                <div className="space-y-2">
                  {listing.rules.map((r) => (
                    <div key={r} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                        style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>✗</span>
                      {r}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Host card */}
            <div className="p-5 rounded-2xl border"
              style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
              <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Meet your Host</h3>
              <div className="flex items-start gap-4">
                {listing.host.profilePhoto
                  ? <img src={listing.host.profilePhoto} alt={listing.host.name} className="w-16 h-16 rounded-full object-cover flex-shrink-0" />
                  : <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                      {listing.host.name[0]}
                    </div>
                }
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{listing.host.name}</h4>
                    {listing.host.isVerified  && <VerifiedBadge />}
                    {listing.host.isSuperhost && <SuperhostBadge />}
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                    Hosting since {hostJoined}
                  </p>
                  <div className="flex gap-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    <span><strong>{listing.reviewCount}</strong> reviews on this listing</span>
                    <span>Trust score <strong>{listing.host.trustScore}</strong>/100</span>
                  </div>
                </div>
              </div>
              <Link href={`/messages/new?hostId=${listing.host.id}`}
                className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-xl border text-sm font-medium transition-all hover:bg-stone-50"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                💬 Message Host
              </Link>
            </div>

            {/* Reviews */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>Guest Reviews</h3>
                <div className="flex items-center gap-1">
                  <Star size={16} className="fill-amber-400 text-amber-400" />
                  <span className="font-bold">{listing.avgRating.toFixed(1)}</span>
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>({listing.reviewCount})</span>
                </div>
              </div>

              {listing.reviews.length > 0 ? (
                <div className="space-y-4">
                  {listing.reviews.map((r) => (
                    <div key={r.id} className="p-4 rounded-xl border"
                      style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                            style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                            {r.reviewer.name?.[0] ?? '?'}
                          </div>
                          <span className="text-sm font-medium">{r.reviewer.name}</span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: r.rating }).map((_, j) => (
                            <Star key={j} size={12} className="fill-amber-400 text-amber-400" />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.comment}</p>
                      <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                        {new Date(r.createdAt).toLocaleDateString('en-GH', { month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>
                  No reviews yet — be the first to stay here!
                </p>
              )}
            </div>
          </div>

          {/* ── Right: booking widget ─────────────────────────────── */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 p-5 rounded-2xl border shadow-lg"
              style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>

              {/* Mode selector */}
              <div className="flex gap-1 p-1 rounded-xl mb-5" style={{ backgroundColor: 'var(--color-bg)' }}>
                {listing.rentalModes.map((m) => (
                  <button key={m}
                    onClick={() => { setSelectedMode(m); setCheckIn(null); setCheckOut(null); setBookError('') }}
                    className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                    style={selectedMode === m
                      ? { backgroundColor: 'var(--color-accent)', color: '#fff' }
                      : { color: 'var(--color-text-secondary)' }}>
                    {MODE_LABELS[m]?.label ?? m}
                  </button>
                ))}
              </div>

              {/* Price */}
              <div className="mb-4">
                {selectedMode === 'SHORT_STAY' && listing.priceNightly && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>${listing.priceNightly}</span>
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>/night</span>
                  </div>
                )}
                {selectedMode === 'TEMP_STAY' && listing.priceMonthly && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>${listing.priceMonthly}</span>
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>/month</span>
                  </div>
                )}
                {selectedMode === 'PERMANENT' && listing.priceAnnual && (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>${listing.priceAnnual.toLocaleString()}</span>
                      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>/year</span>
                    </div>
                    {listing.advanceMonthsRequired && (
                      <p className="text-xs mt-1 font-medium" style={{ color: '#DC2626' }}>
                        ⚠️ {listing.advanceMonthsRequired} months advance required
                      </p>
                    )}
                  </>
                )}
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  ≈ GH₵ {(
                    (selectedMode === 'SHORT_STAY' ? listing.priceNightly ?? 0
                     : selectedMode === 'TEMP_STAY' ? listing.priceMonthly ?? 0
                     : listing.priceAnnual ?? 0) * 15.5
                  ).toLocaleString()}
                </p>
              </div>

              {/* Availability loading indicator */}
              {availLoading && (
                <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <Loader2 size={13} className="animate-spin" /> Checking availability…
                </div>
              )}

              {/* SHORT_STAY: check-in/out */}
              {selectedMode === 'SHORT_STAY' && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Check-in</label>
                    <DatePicker
                      selected={checkIn}
                      onChange={(d: Date | null) => { setCheckIn(d); if (checkOut && d && d >= checkOut) setCheckOut(null) }}
                      selectsStart startDate={checkIn ?? undefined} endDate={checkOut ?? undefined}
                      minDate={new Date()} excludeDateIntervals={excludeIntervals} excludeDates={blockedDates}
                      placeholderText="Add date" dateFormat="dd MMM yyyy"
                      customInput={<input style={dpInputStyle} readOnly />}
                      wrapperClassName="w-full" popperPlacement="bottom-start" />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Check-out</label>
                    <DatePicker
                      selected={checkOut}
                      onChange={(d: Date | null) => setCheckOut(d)}
                      selectsEnd startDate={checkIn ?? undefined} endDate={checkOut ?? undefined}
                      minDate={checkIn ? new Date(checkIn.getTime() + 86400000 * listing.minStayNights) : new Date()}
                      excludeDateIntervals={excludeIntervals} excludeDates={blockedDates}
                      placeholderText="Add date" dateFormat="dd MMM yyyy"
                      customInput={<input style={dpInputStyle} readOnly />}
                      wrapperClassName="w-full" popperPlacement="bottom-end" />
                  </div>
                </div>
              )}

              {/* TEMP_STAY: move-in + months */}
              {selectedMode === 'TEMP_STAY' && (
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Move-in date</label>
                    <DatePicker selected={checkIn} onChange={(d: Date | null) => setCheckIn(d)}
                      minDate={new Date()} excludeDateIntervals={excludeIntervals} excludeDates={blockedDates}
                      placeholderText="Select date" dateFormat="dd MMM yyyy"
                      customInput={<input style={dpInputStyle} readOnly />} wrapperClassName="w-full" />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Number of months (1–11)</label>
                    <input type="number" min={1} max={11} value={months}
                      onChange={(e) => setMonths(parseInt(e.target.value) || 1)}
                      className="w-full text-sm p-2.5 rounded-xl focus:outline-none"
                      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }} />
                  </div>
                </div>
              )}

              {/* PERMANENT: move-in date */}
              {selectedMode === 'PERMANENT' && (
                <div className="mb-4">
                  <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Preferred move-in date</label>
                  <DatePicker selected={checkIn} onChange={(d: Date | null) => setCheckIn(d)}
                    minDate={new Date()} excludeDateIntervals={excludeIntervals} excludeDates={blockedDates}
                    placeholderText="Select date" dateFormat="dd MMM yyyy"
                    customInput={<input style={dpInputStyle} readOnly />} wrapperClassName="w-full" />
                </div>
              )}

              {/* Fee breakdown */}
              {basePrice > 0 && (
                <div className="space-y-2 mb-4 text-sm">
                  <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}>
                    <span>
                      {selectedMode === 'SHORT_STAY'
                        ? `$${listing.priceNightly} × ${nightsCount} nights`
                        : selectedMode === 'TEMP_STAY'
                        ? `$${listing.priceMonthly} × ${months} months`
                        : 'Annual rate'}
                    </span>
                    <span>${basePrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}>
                    <span>Service fee (12%)</span><span>${serviceFee.toFixed(0)}</span>
                  </div>
                  {(listing.damageDeposit ?? 0) > 0 && (
                    <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}>
                      <span>Refundable damage deposit</span><span>${listing.damageDeposit}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-2 border-t"
                    style={{ color: 'var(--color-text-primary)', borderColor: 'var(--color-border)' }}>
                    <span>Total</span><span>${total.toFixed(0)}</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>≈ GH₵ {(total * 15.5).toLocaleString()}</p>
                </div>
              )}

              {/* Error banner */}
              {bookError && (
                <div className="mb-4 p-3 rounded-xl flex items-start gap-2 text-xs"
                  style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />{bookError}
                </div>
              )}

              {/* Book button — requires login */}
              {user ? (
                <button onClick={handleBook} disabled={bookLoading || availLoading}
                  className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 mb-3"
                  style={{
                    backgroundColor: bookLoading ? '#D4A94E' : 'var(--color-accent)',
                    color: '#fff', cursor: bookLoading ? 'not-allowed' : 'pointer', opacity: availLoading ? 0.7 : 1,
                  }}>
                  {bookLoading
                    ? <><Loader2 size={16} className="animate-spin" /> Creating booking…</>
                    : listing.instantBook ? '⚡ Instant Book' : 'Request to Book'}
                </button>
              ) : (
                <Link
                  href={`/login?redirect=/listings/${listingId}`}
                  className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center mb-3 transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                >
                  Log in to Book
                </Link>
              )}

              {selectedMode === 'PERMANENT' && (
                <Button variant="outline" size="lg" className="w-full mb-3">Submit Rental Application</Button>
              )}

              <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                {listing.instantBook ? 'No charge until booking confirmed' : 'Host must approve your request'}
              </p>

              {/* Trust badge */}
              <div className="mt-4 p-3 rounded-xl flex items-center gap-2"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                <Shield size={16} style={{ color: '#059669' }} />
                <p className="text-xs" style={{ color: '#065F46' }}>Payment held in escrow until check-in confirmed.</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import {
  Star, MapPin, Bed, Bath, Users, Wifi, Shield, Zap, Wind, Car, Camera,
  Share2, Heart, Flag, ChevronLeft, ChevronRight, CheckCircle, Loader2,
  AlertCircle, Home, X,
} from 'lucide-react'
import { MODE_ICONS } from '@/lib/rentalModes'
import { calculateFees, formatUsd } from '@/lib/utils'
import { dayKey, parseDay } from '@/lib/hostCalendar'
import { advanceSummary, buildSchedule, rentPlan, tenancyMonths } from '@/lib/rentRules'
import {
  addDays, addMonthsClamped, addYearClamped, daysBetween, fromDayKey, ghanaToday,
  lastCheckOut, nightsAreFree, takenNights, toDayKey,
} from '@/lib/stayDates'
import { PriceBreakdown } from '@/components/booking/PriceBreakdown'
import { OwnListingNote } from '@/components/booking/OwnListingNote'
import { CancellationPolicy, heldNote } from '@/components/booking/CancellationPolicy'
import Link from 'next/link'
import Image from 'next/image'
import { HostIdBadge, SuperhostBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { useAuth } from '@/context/AuthContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { CheckedBadge } from '@/components/listing/CheckedBadge'
import { DIGITAL_ADDRESS_PUBLIC, checkExplanation, type PublicCheck } from '@/lib/listingCheckRules'

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
  /** True when the host has given a Ghana Post digital address. The address itself is never public. */
  hasDigitalAddress?: boolean
  /** Set while FieGH's check of the address and photos stands */
  check?: PublicCheck | null
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
  SHORT_STAY: { label: 'Short Stay',        color: 'var(--color-accent)' },
  TEMP_STAY:  { label: 'Temporary Stay',    color: 'var(--color-accent)' },
  PERMANENT:  { label: 'Permanent Rental',  color: 'var(--color-accent)' },
}

type BookedRange = { start: string; end: string; status: string }

const dpInputStyle: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '10px 12px', borderRadius: 12,
  border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text-primary)', outline: 'none', cursor: 'pointer',
  fontFamily: "var(--font-sans)",
}

// ── Page component ────────────────────────────────────────────────────────────
// Booked ranges and blocked days arrive as calendar days ("2027-03-09")
async function getAvailability(listingId: string): Promise<{ bookedRanges: BookedRange[]; blockedDates: string[] }> {
  const res  = await fetch(`/api/listings/${listingId}/availability`)
  const data = await res.json()
  return {
    bookedRanges: data.bookedRanges ?? [],
    blockedDates: data.blockedDates ?? [],
  }
}

export default function ListingDetailPage() {
  const { id: listingId } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { rate: ghsRate } = useExchangeRate()

  // Listing data
  const [listing,    setListing]    = useState<ApiListing | null>(null)
  // Which listing the fetched data belongs to; loading is derived from it
  const [loadedId,    setLoadedId]    = useState<string | null>(null)
  const listLoading = loadedId !== listingId
  const [notFound,    setNotFound]   = useState(false)

  // UI state
  const [photoIdx,     setPhotoIdx]     = useState(0)
  const [selectedMode, setSelectedMode] = useState('')
  const [savedHeart,   setWishlisted]   = useState(false)
  const [hostPhotoOpen, setHostPhotoOpen] = useState(false)
  const [wishBusy,     setWishBusy]     = useState(false)
  const [months,       setMonths]       = useState(1)

  // Date state
  const [checkIn,  setCheckIn]  = useState<Date | null>(null)
  const [checkOut, setCheckOut] = useState<Date | null>(null)

  // Availability state
  const [availLoading, setAvailLoading] = useState(true)
  const [bookedRanges, setBookedRanges] = useState<BookedRange[]>([])
  const [blockedDates, setBlockedDates] = useState<string[]>([])

  // Booking submit state
  const [bookLoading, setBookLoading] = useState(false)
  const [bookError,   setBookError]   = useState('')

  // ── Fetch listing data ────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    fetch(`/api/listings/${listingId}`)
      .then((r) => {
        if (r.status === 404) { if (active) setNotFound(true); return null }
        return r.json()
      })
      .then((d) => {
        if (!d || !active) return
        const l: ApiListing = d.listing
        setListing(l)
        setSelectedMode(l.rentalModes?.[0] ?? '')

        // Arriving from a search by dates: pre-fill the booking box. Read
        // straight from the address so the page needs no Suspense boundary.
        const q = new URLSearchParams(window.location.search)
        const wantedMode = q.get('mode')
        if (wantedMode && l.rentalModes?.includes(wantedMode)) setSelectedMode(wantedMode)
        const from = fromDayKey(q.get('checkIn'))
        if (from) {
          setCheckIn(from)
          const to = fromDayKey(q.get('checkOut'))
          if (to && to > from) setCheckOut(to)
          const m = parseInt(q.get('months') ?? '', 10)
          if (m >= 1 && m <= 11) setMonths(m)
        }
      })
      .catch(() => { if (active) setNotFound(true) })
      .finally(() => { if (active) setLoadedId(listingId) })
    return () => { active = false }
  }, [listingId])

  // ── Fetch availability ────────────────────────────────────────────────
  // availLoading starts true, so the initial load sets nothing synchronously
  useEffect(() => {
    let active = true
    getAvailability(listingId)
      .then((a) => {
        if (!active) return
        setBookedRanges(a.bookedRanges)
        setBlockedDates(a.blockedDates)
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (active) setAvailLoading(false) })
    return () => { active = false }
  }, [listingId])

  // Manual refresh, e.g. after a booking hits a date conflict
  const fetchAvailability = useCallback(async () => {
    setAvailLoading(true)
    try {
      const a = await getAvailability(listingId)
      setBookedRanges(a.bookedRanges)
      setBlockedDates(a.blockedDates)
    } catch { /* non-fatal */ }
    finally  { setAvailLoading(false) }
  }, [listingId])

  // ── Sync heart with real wishlist status ───────────────────────────────
  // Signed out always shows an empty heart, derived rather than reset
  const wishlisted = !!user && savedHeart

  useEffect(() => {
    if (!user || !listingId) return
    let active = true
    fetch(`/api/wishlists?userId=${user.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        const rows = Array.isArray(data.wishlists) ? data.wishlists : []
        setWishlisted(rows.some((w: { listingId: string }) => w.listingId === listingId))
      })
      .catch(() => { if (active) setWishlisted(false) })
    return () => { active = false }
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

  // ── Date picker rules ─────────────────────────────────────────────────
  // The pickers work in calendar days. A stay takes the nights from check-in
  // up to the day before check-out, so a check-out day stays free: one guest
  // can leave and the next arrive on the same day.
  const taken = takenNights(bookedRanges, blockedDates)
  const pickerDays = (keys: string[]) => keys.flatMap((k) => fromDayKey(k) ?? [])
  // "Today" is today in Ghana, where the homes are
  const todayKey = ghanaToday()
  const today = fromDayKey(todayKey)!
  const checkInKey  = checkIn  ? toDayKey(checkIn)  : null
  const checkOutKey = checkOut ? toDayKey(checkOut) : null
  // Arriving: any night that is taken is off
  const takenDays = pickerDays([...taken])
  // Leaving: a day is off when the night before it is taken. Once a check-in
  // is chosen, the stay simply has to end by the next taken night.
  const noCheckOutDays = checkInKey ? [] : pickerDays([...taken].map((k) => addDays(k, 1)))
  const lastCheckOutKey = checkInKey ? lastCheckOut(checkInKey, taken) : null

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
<div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-deep)' }}>
            <Home size={26} strokeWidth={1.75} aria-hidden />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Listing not found</h2>
          <p className="mb-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>This listing may have been removed or is no longer active.</p>
          <Button onClick={() => router.push('/search')}>Browse all listings</Button>
        </div>
      </div>
    )
  }

  // Hosts cannot book their own home; they get a link to manage it instead
  const isOwner = !!user && user.id === listing.host.id

  // ── Price calculations ────────────────────────────────────────────────
  const nightsCount = checkInKey && checkOutKey
    ? Math.max(0, daysBetween(parseDay(checkInKey)!, parseDay(checkOutKey)!))
    : 0

  const basePrice =
    selectedMode === 'SHORT_STAY' ? (listing.priceNightly  ?? 0) * nightsCount
    : selectedMode === 'TEMP_STAY' ? (listing.priceMonthly ?? 0) * months
    : (listing.priceAnnual ?? 0)

  // The same sum the server stores on the booking, so the two cannot differ
  const serviceFee = calculateFees(basePrice).serviceFee

  // A monthly or long-term stay is paid in instalments. The schedule is built
  // by the same code the server uses when the booking is made, so the first
  // payment shown here is the one that will be charged.
  const units = selectedMode === 'SHORT_STAY' ? nightsCount : selectedMode === 'TEMP_STAY' ? months : 1
  const tenancy = tenancyMonths(selectedMode, units)
  // Before a move-in date is picked the amounts are already known; only the
  // date the monthly payments start from is not, so it is left out.
  const schedule = selectedMode !== 'SHORT_STAY' && basePrice > 0 && Number.isInteger(tenancy) && tenancy >= 1
    ? rentPlan(buildSchedule({
        rentalMode: selectedMode, checkIn: parseDay(checkInKey ?? todayKey)!, units, subtotal: basePrice,
        damageDeposit: listing.damageDeposit ?? 0, advanceMonthsRequired: listing.advanceMonthsRequired,
      }), tenancy)
    : null
  const plan = schedule && !checkInKey ? { ...schedule, firstLaterDue: null } : schedule
  const total      = plan ? plan.dueNow : basePrice + serviceFee + (listing.damageDeposit ?? 0)

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
      // Dates go to the server as calendar days, never as moments, so the
      // guest's time zone cannot shift them.
      let effectiveCheckOut = checkOutKey
      if (selectedMode === 'TEMP_STAY' && checkInKey) {
        effectiveCheckOut = dayKey(addMonthsClamped(parseDay(checkInKey)!, months))
      } else if (selectedMode === 'PERMANENT' && checkInKey) {
        effectiveCheckOut = dayKey(addYearClamped(parseDay(checkInKey)!))
      }

      const res = await fetch('/api/bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          guestId:        user!.id,
          rentalMode:     selectedMode,
          checkIn:        checkInKey,
          checkOut:       effectiveCheckOut,
          nightsOrMonths: selectedMode === 'SHORT_STAY' ? nightsCount : months,
        }),
      })
      const data = await res.json()

      if (res.status === 409) {
        await fetchAvailability()
        setBookError('Those dates just became unavailable. The calendar has been updated. Please pick new dates.')
        setCheckIn(null); setCheckOut(null)
        return
      }
      if (!res.ok) { setBookError(data.error ?? 'Failed to create booking.'); return }

      // A request waits for the host, so there is nothing to pay yet: the
      // guest sees it was sent. Only an instant booking goes straight to payment.
      router.push(data.booking.status === 'PENDING' ? `/bookings/${data.booking.id}?requested=1` : `/checkout/${data.booking.id}`)
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
              {listing.host.isVerified  && <HostIdBadge />}
              <CheckedBadge check={listing.check} />
            </div>
            {/* What the badge means, in full, wherever it is shown on this page */}
            {listing.check && (
              <p className="text-xs mt-2 max-w-2xl" style={{ color: 'var(--color-text-secondary)' }}>{checkExplanation(listing.check)}</p>
            )}
            {listing.hasDigitalAddress && (
              <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>Digital address:</span> {DIGITAL_ADDRESS_PUBLIC}
              </p>
            )}
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
            <div
              className="relative rounded-2xl overflow-hidden mb-8 aspect-[16/9] sm:aspect-[21/9] bg-stone-200"
              style={{ boxShadow: '0 8px 28px rgba(31, 27, 22, 0.1)' }}
            >
              <Image src={photos[photoIdx]} alt={listing.title} fill preload
                sizes="(min-width: 1280px) 1216px, 100vw" className="object-cover" />
              {photos.length > 1 && (
                <>
                  <button onClick={() => setPhotoIdx((p) => (p - 1 + photos.length) % photos.length)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-all"
                    style={{ boxShadow: '0 4px 14px rgba(31, 27, 22, 0.12)' }}>
                    <ChevronLeft size={20} />
                  </button>
                  <button onClick={() => setPhotoIdx((p) => (p + 1) % photos.length)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-all"
                    style={{ boxShadow: '0 4px 14px rgba(31, 27, 22, 0.12)' }}>
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
                  <Image src={p} alt="" width={80} height={64} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

          {/* ── Left: listing details ──────────────────────────────── */}
          <div className="lg:col-span-2 space-y-10">

            {/* Quick facts */}
            <div className="soft-panel grid grid-cols-3 gap-4 p-6">
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
                  <div key={m} className="p-4 rounded-xl transition-all duration-200"
                    style={{
                      border: selectedMode === m
                        ? '1.5px solid var(--color-accent)'
                        : '1px solid rgba(232, 225, 214, 0.55)',
                      backgroundColor: selectedMode === m ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)',
                      boxShadow: selectedMode === m ? '0 4px 14px rgba(201, 147, 46, 0.12)' : 'none',
                    }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                          {(() => { const Icon = MODE_ICONS[m]; return Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden /> : null })()}
                          {MODE_LABELS[m]?.label ?? m}
                        </span>
                        {m === 'SHORT_STAY' && listing.priceNightly && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            From <strong>{formatUsd(listing.priceNightly)}</strong>/night
                          </p>
                        )}
                        {m === 'TEMP_STAY' && listing.priceMonthly && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <strong>{formatUsd(listing.priceMonthly)}</strong>/month · 1 to 11 months. First month up front, then monthly
                          </p>
                        )}
                        {m === 'PERMANENT' && (
                          <>
                            {listing.priceAnnual && (
                              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                                <strong>{formatUsd(listing.priceAnnual)}</strong>/year, about {formatUsd(listing.priceAnnual / 12)} a month
                              </p>
                            )}
                            {listing.priceAnnual && (
                              <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                                {advanceSummary('PERMANENT', 12, listing.advanceMonthsRequired)}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      <div className="text-xs px-3 py-1 rounded-full font-medium"
                        style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-deep)' }}>
                        Available
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cancellation policy for the rental type being looked at */}
            <div>
              <CancellationPolicy policy={listing.cancellationPolicy} rentalMode={selectedMode} />
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
                        style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}><X size={11} strokeWidth={2.5} aria-hidden /></span>
                      {r}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Host card */}
            <div className="soft-panel p-6">
              <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Meet your Host</h3>
              <div className="flex items-start gap-4">
                {listing.host.profilePhoto
                  ? <>
                      <img src={listing.host.profilePhoto} alt={listing.host.name}
                        onClick={() => setHostPhotoOpen(true)}
                        className="w-16 h-16 rounded-full object-cover flex-shrink-0 cursor-pointer" />
                      <PhotoLightbox src={listing.host.profilePhoto} alt={listing.host.name}
                        open={hostPhotoOpen} onOpenChange={setHostPhotoOpen} />
                    </>
                  : <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                      {listing.host.name[0]}
                    </div>
                }
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{listing.host.name}</h4>
                    {listing.host.isVerified  && <HostIdBadge />}
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
              {user?.id === listing.host.id ? (
                <p className="mt-4 text-center text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  This is your listing
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const dest = `/dashboard/guest/messages?hostId=${encodeURIComponent(listing.host.id)}&listingId=${encodeURIComponent(listing.id)}`
                    if (!user) {
                      router.push(`/login?redirect=${encodeURIComponent(dest)}`)
                      return
                    }
                    router.push(dest)
                  }}
                  className="mt-5 flex items-center justify-center gap-2 w-full py-3 rounded-full text-sm font-semibold transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
                >
                  Message Host
                </button>
              )}
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
                    <div key={r.id} className="soft-panel p-5">
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
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  No reviews yet. Be the first guest to leave one after your stay.
                </p>
              )}
            </div>
          </div>

          {/* ── Right: booking widget ─────────────────────────────── */}
          <div className="lg:col-span-1">
            <div className="soft-panel-lg sticky top-20 p-6">
              {isOwner ? (
                <OwnListingNote listingId={listingId} />
              ) : (
              <>

              {/* Mode selector */}
              <div className="flex gap-1 p-1 rounded-xl mb-5" style={{ backgroundColor: 'var(--color-bg)' }}>
                {listing.rentalModes.map((m) => (
                  <button key={m}
                    onClick={() => { setSelectedMode(m); setCheckIn(null); setCheckOut(null); setBookError('') }}
                    className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                    style={selectedMode === m
                      ? { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }
                      : { color: 'var(--color-text-secondary)' }}>
                    {MODE_LABELS[m]?.label ?? m}
                  </button>
                ))}
              </div>

              {/* Price */}
              <div className="mb-4">
                {selectedMode === 'SHORT_STAY' && listing.priceNightly && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{formatUsd(listing.priceNightly)}</span>
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>/night</span>
                  </div>
                )}
                {selectedMode === 'TEMP_STAY' && listing.priceMonthly && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{formatUsd(listing.priceMonthly)}</span>
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>/month</span>
                  </div>
                )}
                {selectedMode === 'PERMANENT' && listing.priceAnnual && (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{formatUsd(listing.priceAnnual / 12)}</span>
                      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>/month</span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatUsd(listing.priceAnnual)} a year. {advanceSummary('PERMANENT', 12, listing.advanceMonthsRequired)}
                    </p>
                  </>
                )}
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  About GH₵ {(
                    (selectedMode === 'SHORT_STAY' ? listing.priceNightly ?? 0
                     : selectedMode === 'TEMP_STAY' ? listing.priceMonthly ?? 0
                     : (listing.priceAnnual ?? 0) / 12) * ghsRate
                  ).toLocaleString('en-US', { maximumFractionDigits: 0 })}
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
                      onChange={(d: Date | null) => {
                        setCheckIn(d)
                        // Keep the check-out only if every night up to it is still free
                        const from = d ? toDayKey(d) : null
                        if (checkOutKey && from && (from >= checkOutKey || !nightsAreFree(from, checkOutKey, taken))) setCheckOut(null)
                      }}
                      selectsStart startDate={checkIn ?? undefined} endDate={checkOut ?? undefined}
                      minDate={today} excludeDates={takenDays}
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
                      minDate={fromDayKey(addDays(checkInKey ?? todayKey, Math.max(1, listing.minStayNights)))!}
                      maxDate={fromDayKey(lastCheckOutKey) ?? undefined}
                      excludeDates={noCheckOutDays}
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
                      minDate={today} excludeDates={takenDays}
                      placeholderText="Select date" dateFormat="dd MMM yyyy"
                      customInput={<input style={dpInputStyle} readOnly />} wrapperClassName="w-full" />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Number of months (1 to 11)</label>
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
                    minDate={today} excludeDates={takenDays}
                    placeholderText="Select date" dateFormat="dd MMM yyyy"
                    customInput={<input style={dpInputStyle} readOnly />} wrapperClassName="w-full" />
                </div>
              )}

              {/* Live estimate once dates are picked. Same layout as checkout. */}
              {basePrice > 0 && (
                <PriceBreakdown
                  className="mb-4"
                  rentalMode={selectedMode}
                  pricePerUnit={selectedMode === 'SHORT_STAY' ? (listing.priceNightly ?? 0) : selectedMode === 'TEMP_STAY' ? (listing.priceMonthly ?? 0) : (listing.priceAnnual ?? 0)}
                  units={units}
                  plan={plan}
                  subtotal={basePrice}
                  serviceFee={serviceFee}
                  deposit={listing.damageDeposit ?? 0}
                  total={total}
                  ghsRate={ghsRate}
                />
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
                    color: 'var(--color-text-primary)', cursor: bookLoading ? 'not-allowed' : 'pointer', opacity: availLoading ? 0.7 : 1,
                  }}>
                  {bookLoading
                    ? <><Loader2 size={16} className="animate-spin" /> Creating booking…</>
                    : listing.instantBook ? <><Zap size={15} aria-hidden /> Instant Book</> : 'Request to Book'}
                </button>
              ) : (
                <Link
                  href={`/login?redirect=/listings/${listingId}`}
                  className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center mb-3 transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
                >
                  Log in to Book
                </Link>
              )}

              <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                {listing.instantBook ? 'No charge until booking confirmed' : 'Host must approve your request'}
              </p>

              {/* Trust badge */}
              <div className="mt-4 p-3 rounded-xl flex items-center gap-2"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                <Shield size={16} style={{ color: '#059669' }} />
                <p className="text-xs" style={{ color: '#065F46' }}>{heldNote(selectedMode)}</p>
              </div>
              </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

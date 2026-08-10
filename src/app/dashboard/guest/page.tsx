'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Calendar, Heart, MessageSquare, Star, CreditCard, Shield, TrendingUp, Loader2 } from 'lucide-react'
import { StatCard } from '@/components/ui/Card'
import { useAuth } from '@/context/AuthContext'

type Booking = {
  id:         string
  checkIn:    string
  checkOut:   string
  status:     string
  totalPrice: number
  rentalMode: string
  listing: {
    id:     string
    title:  string
    photos: string
  }
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  CONFIRMED: { bg: '#D1FAE5', color: '#065F46', label: 'Confirmed ✓' },
  COMPLETED: { bg: '#DBEAFE', color: '#1E40AF', label: 'Completed' },
  PENDING:   { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  CANCELLED: { bg: '#FEE2E2', color: '#991B1B', label: 'Cancelled' },
}

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay',
  TEMP_STAY:  '📅 Monthly',
  PERMANENT:  '🏠 Long-Term',
}

function getFirstPhoto(photosJson: string): string {
  try {
    const arr = JSON.parse(photosJson)
    return Array.isArray(arr) ? arr[0] : photosJson
  } catch { return photosJson }
}

export default function GuestDashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?redirect=/dashboard/guest')
  }, [authLoading, user, router])

  const [bookings,     setBookings]     = useState<Booking[]>([])
  const [wishlistCount, setWishlistCount] = useState(0)
  const [reviewCount,   setReviewCount]   = useState(0)
  const [dataLoading,  setDataLoading]  = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function load() {
      try {
        const [bookingsRes, wishlistRes, reviewsRes] = await Promise.all([
          fetch(`/api/bookings?guestId=${user!.id}`),
          fetch(`/api/wishlists?userId=${user!.id}`),
          fetch(`/api/reviews?reviewerId=${user!.id}`),
        ])
        const [bookingsData, wishlistData, reviewsData] = await Promise.all([
          bookingsRes.json(), wishlistRes.json(), reviewsRes.json(),
        ])
        if (cancelled) return
        setBookings(bookingsData.bookings ?? [])
        setWishlistCount(wishlistData.wishlists?.length ?? 0)
        setReviewCount(reviewsData.total ?? 0)
      } catch {
        // Keep whatever we already have on error
      } finally {
        if (!cancelled) setDataLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [user])

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    )
  }

  const firstName      = user.name?.split(' ')[0] ?? 'there'
  const avatarInitial  = user.name?.[0]?.toUpperCase() ?? '?'
  const completedCount = bookings.filter((b) => b.status === 'COMPLETED').length

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              {avatarInitial}
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                Welcome back, {firstName} 👋
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm" style={{ color: 'rgba(250,247,242,0.6)' }}>Guest Account</span>
                {!user.isVerified && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                    ⏳ Verification Pending
                  </span>
                )}
              </div>
            </div>
            {!user.isVerified && (
              <div className="ml-auto hidden sm:block">
                <Link href="/auth/verify-id"
                  className="px-4 py-2 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                  Verify ID →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Calendar size={18} style={{ color: 'var(--color-accent)' }} />} label="Total Bookings" value={String(bookings.length)} sub={`${completedCount} completed`} />
          <StatCard icon={<Heart size={18} style={{ color: '#EF4444' }} />} label="Saved Properties" value={String(wishlistCount)} />
          <StatCard icon={<Star size={18} style={{ color: '#F59E0B' }} />} label="Reviews Given" value={String(reviewCount)} />
          <StatCard icon={<TrendingUp size={18} style={{ color: '#059669' }} />} label="Trust Score" value={`${user.trustScore ?? 0}/100`} sub={user.isVerified ? undefined : 'ID verify to boost'} />
        </div>

        {/* Nav links */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { href: '/dashboard/guest', icon: Calendar, label: 'Bookings', active: true },
            { href: '/dashboard/guest/wishlist', icon: Heart, label: 'Wishlist' },
            { href: '/dashboard/guest/messages', icon: MessageSquare, label: 'Messages' },
            { href: '/dashboard/guest/payments', icon: CreditCard, label: 'Payments' },
          ].map(({ href, icon: Icon, label, active }) => (
            <Link key={href} href={href}
              className="flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all"
              style={{
                borderColor: active ? 'var(--amber)' : '#E5E7EB',
                backgroundColor: active ? '#FFF8EE' : '#fff',
                color: active ? 'var(--amber)' : '#374151',
              }}>
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </div>

        {/* Verify ID banner */}
        {!user.isVerified && (
          <div className="p-5 rounded-2xl mb-8 flex items-center justify-between gap-4"
            style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
            <div className="flex items-center gap-3">
              <Shield size={20} style={{ color: '#2563EB' }} />
              <div>
                <p className="font-semibold text-sm" style={{ color: '#1E40AF' }}>Verify your identity to unlock full access</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Submit your Ghana Card, Passport, or Voter ID to get the ✅ Verified badge.
                </p>
              </div>
            </div>
            <Link href="/auth/verify-id"
              className="px-4 py-2 rounded-full text-sm font-semibold flex-shrink-0"
              style={{ backgroundColor: '#2563EB', color: '#fff' }}>
              Verify Now
            </Link>
          </div>
        )}

        {/* Bookings */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Your Bookings</h2>

          {dataLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-stone-100">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>You haven&apos;t made any bookings yet.</p>
              <Link href="/search" className="inline-block mt-3 text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
                Start exploring →
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {bookings.map((b) => {
                const s = STATUS_STYLES[b.status] ?? STATUS_STYLES.PENDING
                return (
                  <div key={b.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
                    <div className="flex gap-4 p-4">
                      <img src={getFirstPhoto(b.listing.photos)} alt={b.listing.title}
                        className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-sm leading-snug" style={{ color: 'var(--color-text-primary)' }}>{b.listing.title}</h3>
                          <span className="px-2 py-1 rounded-full text-xs font-medium flex-shrink-0"
                            style={{ backgroundColor: s.bg, color: s.color }}>
                            {s.label}
                          </span>
                        </div>
                        <p className="text-xs text-[#6B645C] mt-1">{MODE_LABELS[b.rentalMode] ?? b.rentalMode}</p>
                        <p className="text-xs text-[#6B645C]">
                          {new Date(b.checkIn).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                          {' – '}
                          {new Date(b.checkOut).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        <p className="text-sm font-bold mt-2" style={{ color: 'var(--color-text-primary)' }}>
                          ${b.totalPrice.toLocaleString()}
                          <span className="font-normal text-xs text-stone-400 ml-1">≈ GH₵ {(b.totalPrice * 15.5).toLocaleString()}</span>
                        </p>
                      </div>
                    </div>
                    <div className="px-4 pb-4 flex gap-2">
                      <Link href={`/listings/${b.listing.id}`}
                        className="text-xs px-4 py-2 rounded-full border font-medium transition-all hover:bg-stone-50"
                        style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                        View Listing
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

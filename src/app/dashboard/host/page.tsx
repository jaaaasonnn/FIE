'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Home, Calendar, DollarSign, Star, Users, Eye, Loader2 } from 'lucide-react'
import { StatCard } from '@/components/ui/Card'
import { VerifiedBadge, SuperhostBadge } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'

type ApiListing = {
  id: string
  title: string
  isActive: boolean
  avgRating: number
  reviewCount: number
  priceNightly: number | null
  priceMonthly: number | null
  photos: string[]
  rentalModes: string[]
  _count?: { bookings: number }
}

type ApiBooking = {
  id: string
  checkIn: string
  checkOut: string
  status: string
  totalPrice: number
  rentalMode: string
  guest: { id: string; name: string | null; profilePhoto: string | null }
  listing: { id: string; title: string }
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  CONFIRMED: { bg: '#D1FAE5', color: '#065F46' },
  PENDING:   { bg: '#FEF3C7', color: '#92400E' },
  CANCELLED: { bg: '#FEE2E2', color: '#991B1B' },
  COMPLETED: { bg: '#DBEAFE', color: '#1E40AF' },
}

function firstPhoto(photos: unknown): string {
  if (Array.isArray(photos) && photos[0]) return photos[0] as string
  if (typeof photos === 'string') {
    try {
      const arr = JSON.parse(photos)
      return Array.isArray(arr) ? arr[0] ?? '' : ''
    } catch { return '' }
  }
  return ''
}

export default function HostDashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const [listings, setListings] = useState<ApiListing[]>([])
  const [bookings, setBookings] = useState<ApiBooking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setListings([])
      setBookings([])
      setLoading(false)
      return
    }
    setLoading(true)
    Promise.all([
      fetch(`/api/listings?hostId=${user.id}&limit=50`).then((r) => r.json()),
      fetch(`/api/bookings?hostId=${user.id}`).then((r) => r.json()),
    ])
      .then(([lData, bData]) => {
        setListings(Array.isArray(lData.listings) ? lData.listings : [])
        setBookings(Array.isArray(bData.bookings) ? bData.bookings : [])
      })
      .catch(() => {
        setListings([])
        setBookings([])
      })
      .finally(() => setLoading(false))
  }, [user, authLoading])

  const activeListings = listings.filter((l) => l.isActive)
  const activeBookings = bookings.filter((b) => b.status === 'CONFIRMED' || b.status === 'PENDING')
  const recentBookings = bookings.slice(0, 5)
  const avgRating = listings.length
    ? listings.reduce((s, l) => s + (l.avgRating || 0), 0) / listings.length
    : 0
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthEarnings = bookings
    .filter((b) => b.status !== 'CANCELLED' && new Date(b.checkIn) >= monthStart)
    .reduce((s, b) => s + b.totalPrice * 0.92, 0)

  const firstName = user?.name?.split(' ')[0] ?? 'Host'

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{ backgroundColor: 'var(--gold-light)' }}>
                {user?.profilePhoto ? (
                  <img src={user.profilePhoto} alt={user.name ?? 'Host'} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {(user?.name ?? 'H')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                  {firstName}&apos;s Dashboard 🏡
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  {user?.isVerified && <VerifiedBadge />}
                  {user?.isSuperhost && <SuperhostBadge />}
                  <span className="text-xs" style={{ color: 'rgba(250,247,242,0.5)' }}>
                    {user?.role === 'HOST' ? 'Host account' : 'Guest account'}
                  </span>
                </div>
              </div>
            </div>
            <Link href="/dashboard/host/listings/new"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              <Plus size={16} />
              List Property
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {loading || authLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading dashboard…</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={<DollarSign size={18} style={{ color: 'var(--color-accent)' }} />}
                label="This Month"
                value={`$${monthEarnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                sub="After 8% commission"
              />
              <StatCard
                icon={<Calendar size={18} style={{ color: '#2563EB' }} />}
                label="Active Bookings"
                value={String(activeBookings.length)}
                sub={`${bookings.filter((b) => b.status === 'PENDING').length} pending`}
              />
              <StatCard
                icon={<Home size={18} style={{ color: '#059669' }} />}
                label="Active Listings"
                value={String(activeListings.length)}
              />
              <StatCard
                icon={<Star size={18} style={{ color: '#F59E0B' }} />}
                label="Avg Rating"
                value={listings.length ? `${avgRating.toFixed(1)}★` : '—'}
                sub={listings.length ? `${listings.reduce((s, l) => s + (l.reviewCount || 0), 0)} reviews` : 'No listings yet'}
              />
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              {[
                { href: '/dashboard/host/listings/new', icon: Plus, label: 'Add Listing', primary: true },
                { href: '/dashboard/host/bookings', icon: Calendar, label: 'All Bookings' },
                { href: '/dashboard/host/payouts', icon: DollarSign, label: 'Payouts' },
                { href: '/dashboard/host/messages', icon: Users, label: 'Messages' },
              ].map(({ href, icon: Icon, label, primary }) => (
                <Link key={href} href={href}
                  className="flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all"
                  style={{
                    borderColor: primary ? 'var(--amber)' : '#E5E7EB',
                    backgroundColor: primary ? 'var(--amber)' : '#fff',
                    color: primary ? '#fff' : '#374151',
                  }}>
                  <Icon size={16} />
                  {label}
                </Link>
              ))}
            </div>

            {/* Pending bookings */}
            <div className="mb-8">
              <h2 className="text-xl font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Recent Booking Requests</h2>
              {recentBookings.length === 0 ? (
                <div className="bg-white rounded-2xl border border-stone-100 p-10 text-center">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>No booking requests yet</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    When guests book your listings, they&apos;ll show up here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentBookings.map((b) => {
                    const s = STATUS_COLORS[b.status] ?? STATUS_COLORS.PENDING
                    const guestName = b.guest?.name ?? 'Guest'
                    return (
                      <div key={b.id} className="bg-white rounded-2xl border border-stone-100 p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                              style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                              {guestName[0]}
                            </div>
                            <div>
                              <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{guestName}</p>
                              <p className="text-xs text-[#6B645C]">{b.listing?.title}</p>
                              <p className="text-xs text-stone-400">
                                {new Date(b.checkIn).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                                {' → '}
                                {new Date(b.checkOut).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                                ${b.totalPrice.toLocaleString()}
                              </p>
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                                style={{ backgroundColor: s.bg, color: s.color }}>
                                {b.status}
                              </span>
                            </div>
                            {b.status === 'PENDING' && (
                              <div className="flex gap-2">
                                <button className="px-3 py-1.5 rounded-full text-xs font-semibold"
                                  style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                                  Accept
                                </button>
                                <button className="px-3 py-1.5 rounded-full text-xs font-semibold"
                                  style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                                  Decline
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Active listings */}
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Your Listings</h2>
                <Link href="/dashboard/host/listings/new"
                  className="flex items-center gap-1 text-sm font-semibold"
                  style={{ color: 'var(--color-accent)' }}>
                  <Plus size={14} /> Add New
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {listings.map((l) => {
                  const photo = firstPhoto(l.photos)
                  return (
                    <div key={l.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
                      <div className="flex">
                        {photo ? (
                          <img src={photo} alt={l.title} className="w-28 h-full min-h-[120px] object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-28 min-h-[120px] flex-shrink-0 bg-stone-100" />
                        )}
                        <div className="p-4 flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h4 className="font-semibold text-sm leading-snug" style={{ color: 'var(--color-text-primary)' }}>{l.title}</h4>
                            <span className="px-2 py-0.5 text-xs rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: l.isActive ? '#D1FAE5' : '#F3F4F6',
                                color: l.isActive ? '#065F46' : '#6B7280',
                              }}>
                              {l.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </div>
                          <div className="flex gap-2 text-xs text-[#6B645C] mb-3">
                            <span>⭐ {l.avgRating?.toFixed(1) ?? '0.0'}</span>
                            <span>·</span>
                            <span>{l.reviewCount ?? 0} reviews</span>
                          </div>
                          <div className="flex gap-2">
                            <Link href={`/listings/${l.id}`}
                              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-all hover:bg-stone-50"
                              style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                              <Eye size={12} /> Preview
                            </Link>
                            <Link href={`/dashboard/host/listings/${l.id}/edit`}
                              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full"
                              style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                              Edit
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Add listing CTA */}
                <Link href="/dashboard/host/listings/new"
                  className="border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all hover:border-amber-400 hover:bg-[#FAF5EC]"
                  style={{ borderColor: '#D1D5DB' }}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                    style={{ backgroundColor: 'var(--gold-light)' }}>
                    <Plus size={20} style={{ color: 'var(--color-accent)' }} />
                  </div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Add a New Property</p>
                  <p className="text-xs text-[#6B645C] mt-1">List your apartment, house, or villa</p>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

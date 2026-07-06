'use client'

import Link from 'next/link'
import { Plus, Home, Calendar, DollarSign, Star, TrendingUp, Users, CheckCircle, Clock, Eye } from 'lucide-react'
import { StatCard } from '@/components/ui/Card'
import { VerifiedBadge, SuperhostBadge } from '@/components/ui/Badge'

const MOCK_LISTINGS_HOST = [
  { id: '1', title: 'Luxury 3BR Apartment, East Legon', status: 'ACTIVE', bookings: 12, rating: 4.9, priceNightly: 120, photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&q=60', modes: ['SHORT_STAY', 'TEMP_STAY'] },
  { id: '5', title: 'Furnished 2BR, Labone', status: 'ACTIVE', bookings: 7, rating: 4.6, priceMonthly: 950, photo: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=200&q=60', modes: ['TEMP_STAY', 'PERMANENT'] },
]

const MOCK_BOOKINGS_HOST = [
  { id: 'hb1', guest: 'Kofi A.', listing: 'Luxury 3BR, East Legon', checkIn: '2025-12-20', checkOut: '2025-12-28', status: 'CONFIRMED', amount: 1210, mode: 'SHORT_STAY' },
  { id: 'hb2', guest: 'Ama B.', listing: 'Furnished 2BR, Labone', checkIn: '2026-01-01', checkOut: '2026-04-01', status: 'PENDING', amount: 2850, mode: 'TEMP_STAY' },
]

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  CONFIRMED: { bg: '#D1FAE5', color: '#065F46' },
  PENDING: { bg: '#FEF3C7', color: '#92400E' },
  CANCELLED: { bg: '#FEE2E2', color: '#991B1B' },
  COMPLETED: { bg: '#DBEAFE', color: '#1E40AF' }
}

export default function HostDashboardPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0">
                <img src="https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=100&q=70"
                  alt="Host" className="w-full h-full object-cover" />
              </div>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                  Abena's Dashboard 🏡
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <VerifiedBadge />
                  <SuperhostBadge />
                  <span className="text-xs" style={{ color: 'rgba(250,247,242,0.5)' }}>Host since Jan 2021</span>
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
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<DollarSign size={18} style={{ color: 'var(--color-accent)' }} />} label="This Month" value="$3,210" sub="After 8% commission" />
          <StatCard icon={<Calendar size={18} style={{ color: '#2563EB' }} />} label="Active Bookings" value="4" sub="2 arriving this week" />
          <StatCard icon={<Home size={18} style={{ color: '#059669' }} />} label="Active Listings" value="2" />
          <StatCard icon={<Star size={18} style={{ color: '#F59E0B' }} />} label="Avg Rating" value="4.8★" sub="Superhost threshold" />
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
                color: primary ? '#fff' : '#374151'
              }}>
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </div>

        {/* Pending bookings */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Recent Booking Requests</h2>
          <div className="space-y-3">
            {MOCK_BOOKINGS_HOST.map((b) => {
              const s = STATUS_COLORS[b.status]
              return (
                <div key={b.id} className="bg-white rounded-2xl border border-stone-100 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                        style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                        {b.guest[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{b.guest}</p>
                        <p className="text-xs text-[#6B645C]">{b.listing}</p>
                        <p className="text-xs text-stone-400">
                          {new Date(b.checkIn).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                          {' → '}
                          {new Date(b.checkOut).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>${b.amount.toLocaleString()}</p>
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
            {MOCK_LISTINGS_HOST.map((l) => (
              <div key={l.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
                <div className="flex">
                  <img src={l.photo} alt={l.title} className="w-28 h-full object-cover flex-shrink-0" />
                  <div className="p-4 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="font-semibold text-sm leading-snug" style={{ color: 'var(--color-text-primary)' }}>{l.title}</h4>
                      <span className="px-2 py-0.5 text-xs rounded-full flex-shrink-0"
                        style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                        {l.status}
                      </span>
                    </div>
                    <div className="flex gap-2 text-xs text-[#6B645C] mb-3">
                      <span>⭐ {l.rating}</span>
                      <span>·</span>
                      <span>{l.bookings} bookings</span>
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
            ))}

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
      </div>
    </div>
  )
}

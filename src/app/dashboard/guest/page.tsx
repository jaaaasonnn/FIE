'use client'

import Link from 'next/link'
import { Calendar, Heart, MessageSquare, Star, CreditCard, Bell, Shield, TrendingUp } from 'lucide-react'
import { StatCard } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

const MOCK_BOOKINGS = [
  { id: 'b1', title: 'Luxury 3BR Apt, East Legon', checkIn: '2025-12-20', checkOut: '2025-12-28', status: 'CONFIRMED', total: 1210, mode: 'SHORT_STAY', photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&q=60' },
  { id: 'b2', title: 'Furnished 2BR, Labone', checkIn: '2025-11-01', checkOut: '2026-02-01', status: 'COMPLETED', total: 2850, mode: 'TEMP_STAY', photo: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=200&q=60' },
]

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  CONFIRMED: { bg: '#D1FAE5', color: '#065F46', label: 'Confirmed ✓' },
  COMPLETED: { bg: '#DBEAFE', color: '#1E40AF', label: 'Completed' },
  PENDING: { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  CANCELLED: { bg: '#FEE2E2', color: '#991B1B', label: 'Cancelled' }
}

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay',
  TEMP_STAY: '📅 Monthly',
  PERMANENT: '🏠 Long-Term'
}

export default function GuestDashboardPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              K
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                Welcome back, Kwame 👋
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm" style={{ color: 'rgba(250,247,242,0.6)' }}>Guest Account</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                  ⏳ Verification Pending
                </span>
              </div>
            </div>
            <div className="ml-auto hidden sm:block">
              <Link href="/auth/verify-id"
                className="px-4 py-2 rounded-full text-xs font-semibold"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                Verify ID →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Calendar size={18} style={{ color: 'var(--color-accent)' }} />} label="Total Bookings" value="3" sub="2 completed" />
          <StatCard icon={<Heart size={18} style={{ color: '#EF4444' }} />} label="Saved Properties" value="7" />
          <StatCard icon={<Star size={18} style={{ color: '#F59E0B' }} />} label="Reviews Given" value="2" />
          <StatCard icon={<TrendingUp size={18} style={{ color: '#059669' }} />} label="Trust Score" value="65/100" sub="ID verify to boost" />
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
                color: active ? 'var(--amber)' : '#374151'
              }}>
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </div>

        {/* Verify ID banner */}
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

        {/* Bookings */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Your Bookings</h2>
          <div className="space-y-4">
            {MOCK_BOOKINGS.map((b) => {
              const s = STATUS_STYLES[b.status]
              return (
                <div key={b.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
                  <div className="flex gap-4 p-4">
                    <img src={b.photo} alt={b.title}
                      className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-sm leading-snug" style={{ color: 'var(--color-text-primary)' }}>{b.title}</h3>
                        <span className="px-2 py-1 rounded-full text-xs font-medium flex-shrink-0"
                          style={{ backgroundColor: s.bg, color: s.color }}>
                          {s.label}
                        </span>
                      </div>
                      <p className="text-xs text-[#6B645C] mt-1">{MODE_LABELS[b.mode]}</p>
                      <p className="text-xs text-[#6B645C]">
                        {new Date(b.checkIn).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                        {' – '}
                        {new Date(b.checkOut).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-sm font-bold mt-2" style={{ color: 'var(--color-text-primary)' }}>
                        ${b.total.toLocaleString()}
                        <span className="font-normal text-xs text-stone-400 ml-1">≈ GH₵ {(b.total * 15.5).toLocaleString()}</span>
                      </p>
                    </div>
                  </div>
                  <div className="px-4 pb-4 flex gap-2">
                    <Link href={`/listings/${b.id}`}
                      className="text-xs px-4 py-2 rounded-full border font-medium transition-all hover:bg-stone-50"
                      style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                      View Listing
                    </Link>
                    {b.status === 'CONFIRMED' && (
                      <button className="text-xs px-4 py-2 rounded-full font-medium"
                        style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                        Cancel
                      </button>
                    )}
                    {b.status === 'COMPLETED' && (
                      <button className="text-xs px-4 py-2 rounded-full font-medium"
                        style={{ backgroundColor: '#FFF8EE', color: 'var(--color-accent)' }}>
                        Leave Review
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bell size={18} style={{ color: 'var(--color-accent)' }} />
            <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Recent Notifications</h3>
          </div>
          <div className="space-y-3">
            {[
              { msg: 'Your booking at East Legon is confirmed ✓', time: '2 hours ago', read: false },
              { msg: 'Host Abena sent you a message', time: '1 day ago', read: true },
              { msg: 'Reminder: Check-in at East Legon in 3 days', time: '2 days ago', read: true },
            ].map(({ msg, time, read }) => (
              <div key={msg} className="flex items-start gap-3 p-3 rounded-xl"
                style={{ backgroundColor: read ? 'transparent' : '#FFF8EE' }}>
                {!read && <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: 'var(--color-accent)' }} />}
                {read && <div className="w-2 h-2 flex-shrink-0" />}
                <div>
                  <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{msg}</p>
                  <p className="text-xs text-stone-400 mt-0.5">{time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Calendar, CheckCircle, Clock, XCircle, MessageSquare } from 'lucide-react'

// TODO: Replace TEMP_HOST_ID with the real auth session user ID once authentication is wired in.
// Temporary host: Abena Mensah (Superhost, East Legon & Cantonments listings)
const TEMP_HOST_ID = 'seed_7ed5b7598978d3383867'

type ApiBooking = {
  id: string
  rentalMode: string
  checkIn: string
  checkOut: string
  nightsOrMonths: number
  totalPrice: number
  status: string
  guest: {
    id: string
    name: string
    profilePhoto: string | null
    trustScore: number | null
    isVerified: boolean
  }
  listing: {
    id: string
    title: string
  }
}

const STATUS_UI: Record<string, { bg: string; color: string; label: string }> = {
  CONFIRMED: { bg: '#D1FAE5', color: '#065F46', label: 'Confirmed ✓' },
  PENDING:   { bg: '#FEF3C7', color: '#92400E', label: 'Awaiting Approval' },
  COMPLETED: { bg: '#DBEAFE', color: '#1E40AF', label: 'Completed' },
  CANCELLED: { bg: '#FEE2E2', color: '#991B1B', label: 'Cancelled' },
}

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay', TEMP_STAY: '📅 Monthly', PERMANENT: '🏠 Long-Term',
}

const FILTERS = ['All', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']

export default function HostBookingsPage() {
  const [allBookings, setAllBookings] = useState<ApiBooking[]>([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('All')

  useEffect(() => {
    fetch(`/api/bookings?hostId=${TEMP_HOST_ID}`)
      .then((r) => r.json())
      .then((data) => setAllBookings(Array.isArray(data.bookings) ? data.bookings : []))
      .catch(() => setAllBookings([]))
      .finally(() => setLoading(false))
  }, [])

  const bookings = filter === 'All' ? allBookings : allBookings.filter((b) => b.status === filter)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Calendar size={22} style={{ color: 'var(--color-accent)' }} />
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>All Bookings</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>Manage guest reservations</p>
            </div>
          </div>
          <Link href="/dashboard/host" className="text-sm px-4 py-2 rounded-full"
            style={{ backgroundColor: 'rgba(245,192,106,0.2)', color: 'var(--color-accent)', border: '1px solid rgba(245,192,106,0.3)' }}>
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Status filter tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{
                backgroundColor: filter === f ? 'var(--brown-dark)' : '#fff',
                color: filter === f ? 'var(--gold)' : '#374151',
                border: filter === f ? 'none' : '1px solid #E5E7EB',
              }}>
              {f === 'All'
                ? `All (${allBookings.length})`
                : `${f.charAt(0) + f.slice(1).toLowerCase()} (${allBookings.filter((b) => b.status === f).length})`}
            </button>
          ))}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-stone-100 rounded w-1/3" />
                    <div className="h-3 bg-stone-100 rounded w-1/2" />
                    <div className="h-3 bg-stone-100 rounded w-2/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bookings */}
        {!loading && (
          <div className="space-y-4">
            {bookings.map((b) => {
              const s         = STATUS_UI[b.status] ?? STATUS_UI['PENDING']
              const trustScore = b.guest.trustScore ?? 0
              return (
                <div key={b.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      {/* Guest avatar */}
                      <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                        style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                        {b.guest.name[0]}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>{b.guest.name}</h3>
                          {b.guest.isVerified && (
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>✅ Verified</span>
                          )}
                          <span className="text-xs px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: trustScore >= 80 ? '#D1FAE5' : '#FEF3C7', color: trustScore >= 80 ? '#065F46' : '#92400E' }}>
                            Trust: {trustScore}/100
                          </span>
                        </div>
                        <p className="text-xs text-[#6B645C] mb-1">{b.listing.title} · {MODE_LABELS[b.rentalMode] ?? b.rentalMode}</p>
                        <p className="text-xs text-stone-400">
                          {new Date(b.checkIn).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                          {' → '}
                          {new Date(b.checkOut).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {b.rentalMode === 'SHORT_STAY' && ` · ${b.nightsOrMonths} night${b.nightsOrMonths !== 1 ? 's' : ''}`}
                          {b.rentalMode === 'TEMP_STAY'  && ` · ${b.nightsOrMonths} month${b.nightsOrMonths !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-row sm:flex-col items-start sm:items-end gap-3 sm:gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{ backgroundColor: s.bg, color: s.color }}>
                        {s.label}
                      </span>
                      <p className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                        ${b.totalPrice.toLocaleString()}
                        <span className="text-xs font-normal text-stone-400 block">
                          Net: ${(b.totalPrice * 0.92).toFixed(0)} after commission
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-4 pt-4 border-t border-stone-50 flex-wrap">
                    {b.status === 'PENDING' && (
                      <>
                        <button className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                          <CheckCircle size={13} /> Accept Booking
                        </button>
                        <button className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                          <XCircle size={13} /> Decline
                        </button>
                      </>
                    )}
                    {b.status === 'CONFIRMED' && (
                      <button className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                        Cancel Booking
                      </button>
                    )}
                    <Link href="/dashboard/host/messages"
                      className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border border-stone-200 text-[#6B645C] hover:bg-stone-50">
                      <MessageSquare size={13} /> Message Guest
                    </Link>
                    {b.status === 'COMPLETED' && (
                      <button className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: '#FBE8BB', color: '#92400E' }}>
                        Leave Review
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {bookings.length === 0 && (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">📋</div>
                <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {filter === 'All' ? 'No bookings yet' : `No ${filter.toLowerCase()} bookings`}
                </p>
                {filter === 'All' && (
                  <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    When guests book your listings, they'll appear here.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

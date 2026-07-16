'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Clock, Calendar, MapPin, MessageSquare, Download, Shield } from 'lucide-react'

type BookingData = {
  id: string
  paymentReference: string | null
  rentalMode: string
  nightsOrMonths: number
  totalPrice: number
  status: string
  paymentStatus: string
  checkIn: string
  checkOut: string
  listing: {
    id: string
    title: string
    photos: string
    city: string
    neighbourhood: string | null
    welcomeMessage: string | null
  }
  host: {
    id: string
    name: string
    profilePhoto: string | null
    phone: string | null
  }
}

export default function BookingConfirmationPage() {
  const { id } = useParams<{ id: string }>()
  const [booking, setBooking] = useState<BookingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    fetch(`/api/bookings?id=${id}`)
      .then((r) => r.json())
      .then((data) => setBooking(data.booking ?? null))
      .catch(() => setBooking(null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin mx-auto mb-4"
            style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading your booking…</p>
        </div>
      </div>
    )
  }

  if (!booking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-5xl">🔍</div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Booking not found</h1>
        <p className="text-sm text-center" style={{ color: 'var(--color-text-secondary)' }}>
          We couldn't find this booking. It may have been cancelled or the link is incorrect.
        </p>
        <Link href="/dashboard/guest"
          className="mt-2 px-6 py-3 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
          Go to My Bookings
        </Link>
      </div>
    )
  }

  const photos = (() => { try { return JSON.parse(booking.listing.photos) as string[] } catch { return [] } })()
  const photo  = photos[0] ?? null
  const ref    = booking.paymentReference ?? booking.id.slice(-8).toUpperCase()
  const address = [booking.listing.neighbourhood, booking.listing.city].filter(Boolean).join(', ')
  const confirmed = booking.status === 'CONFIRMED'

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: confirmed ? '#D1FAE5' : '#FEF3C7' }}>
            {confirmed
              ? <CheckCircle size={32} style={{ color: '#059669' }} />
              : <Clock size={32} style={{ color: '#92400E' }} />}
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--cream)' }}>
            {confirmed ? 'Booking Confirmed! 🎉' : 'Booking Pending'}
          </h1>
          <p style={{ color: 'rgba(250,247,242,0.7)' }}>Ref: {ref}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        {/* Property */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {photo && <img src={photo} alt="" className="w-full h-48 object-cover" />}
          <div className="p-5">
            <h2 className="font-bold text-lg mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {booking.listing.title}
            </h2>
            <div className="flex items-center gap-2 text-sm text-[#6B645C] mb-4">
              <MapPin size={14} />
              <span>{address}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#F9FAFB' }}>
                <p className="text-xs text-[#6B645C] mb-1">Check-in</p>
                <p className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {new Date(booking.checkIn).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-[#6B645C]">From 2:00 PM</p>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#F9FAFB' }}>
                <p className="text-xs text-[#6B645C] mb-1">Check-out</p>
                <p className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {new Date(booking.checkOut).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-[#6B645C]">By 12:00 PM</p>
              </div>
            </div>
          </div>
        </div>

        {/* Welcome message */}
        {booking.listing.welcomeMessage && (
          <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <h3 className="font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>💌 Welcome Message from Host</h3>
            <p className="text-sm text-[#4A4540] leading-relaxed p-4 rounded-xl"
              style={{ backgroundColor: '#FFF8EE', border: '1px solid var(--gold)' }}>
              {booking.listing.welcomeMessage}
            </p>
          </div>
        )}

        {/* Host info */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
          <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Your Host</h3>
          <div className="flex items-center gap-4 mb-4">
            {booking.host.profilePhoto
              ? <img src={booking.host.profilePhoto} alt={booking.host.name} className="w-14 h-14 rounded-full object-cover" />
              : <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0"
                  style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                  {booking.host.name[0]}
                </div>}
            <div>
              <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{booking.host.name}</p>
              {booking.host.phone && (
                <p className="text-sm text-[#6B645C]">📱 {booking.host.phone}</p>
              )}
            </div>
          </div>
          <Link href="/dashboard/guest/messages"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border text-sm font-medium transition-all hover:bg-stone-50"
            style={{ borderColor: '#E5E7EB', color: 'var(--color-text-primary)' }}>
            <MessageSquare size={16} /> Message Host
          </Link>
        </div>

        {/* Payment summary */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
          <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Payment Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-[#6B645C]">
              <span>Booking total</span>
              <span>${booking.totalPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[#6B645C]">
              <span>Approx. in GHS</span>
              <span>GH₵ {(booking.totalPrice * 15.5).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-stone-100">
              <span className="text-[#6B645C]">Payment status</span>
              <span className="px-2 py-1 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: booking.paymentStatus === 'PAID' ? '#D1FAE5' : '#FEF3C7',
                  color:           booking.paymentStatus === 'PAID' ? '#065F46' : '#92400E',
                }}>
                {booking.paymentStatus === 'PAID' ? 'Paid ✓' : booking.paymentStatus}
              </span>
            </div>
          </div>
        </div>

        {/* Escrow notice */}
        <div className="p-4 rounded-2xl flex items-start gap-3"
          style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <Shield size={18} style={{ color: '#2563EB', flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="font-semibold text-sm" style={{ color: '#1E40AF' }}>Escrow Active</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Your payment is held securely. If the property doesn't match the listing, raise a dispute within 24 hours of check-in for a full refund.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/dashboard/guest"
            className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
            <Calendar size={16} /> My Bookings
          </Link>
          <button
            className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border border-stone-200 text-[#4A4540] hover:bg-stone-50">
            <Download size={16} /> Download Receipt
          </button>
        </div>
      </div>
    </div>
  )
}

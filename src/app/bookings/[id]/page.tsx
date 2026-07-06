import Link from 'next/link'
import { CheckCircle, Calendar, MapPin, User, Shield, MessageSquare, Download } from 'lucide-react'

const MOCK_BOOKING = {
  id: 'b1',
  listing: { title: 'Luxury 3BR Apartment, East Legon', address: '14 Boundary Road, East Legon, Accra, Greater Accra', photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=70' },
  host: { name: 'Abena Mensah', phone: '+233 55 123 4567', photo: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=100&q=70' },
  checkIn: '2025-12-20',
  checkOut: '2025-12-28',
  mode: 'SHORT_STAY',
  nights: 8,
  total: 1275.2,
  status: 'CONFIRMED',
  ref: 'FIE-2024-B001',
  welcomeMessage: 'Welcome! The gate code is 2024#. Your room is on the 3rd floor. WiFi: FieGH_EastLegon / Password: Welcome2024!'
}

export default function BookingConfirmationPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#D1FAE5' }}>
            <CheckCircle size={32} style={{ color: '#059669' }} />
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--cream)' }}>
            Booking Confirmed! 🎉
          </h1>
          <p style={{ color: 'rgba(250,247,242,0.7)' }}>Ref: {MOCK_BOOKING.ref}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        {/* Property */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          <img src={MOCK_BOOKING.listing.photo} alt="" className="w-full h-48 object-cover" />
          <div className="p-5">
            <h2 className="font-bold text-lg mb-2" style={{ color: 'var(--color-text-primary)' }}>{MOCK_BOOKING.listing.title}</h2>
            <div className="flex items-center gap-2 text-sm text-[#6B645C] mb-4">
              <MapPin size={14} />
              <span>{MOCK_BOOKING.listing.address}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#F9FAFB' }}>
                <p className="text-xs text-[#6B645C] mb-1">Check-in</p>
                <p className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {new Date(MOCK_BOOKING.checkIn).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-[#6B645C]">From 2:00 PM</p>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#F9FAFB' }}>
                <p className="text-xs text-[#6B645C] mb-1">Check-out</p>
                <p className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {new Date(MOCK_BOOKING.checkOut).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-[#6B645C]">By 12:00 PM</p>
              </div>
            </div>
          </div>
        </div>

        {/* Welcome message */}
        {MOCK_BOOKING.welcomeMessage && (
          <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <h3 className="font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>💌 Welcome Message from Host</h3>
            <p className="text-sm text-[#4A4540] leading-relaxed p-4 rounded-xl" style={{ backgroundColor: '#FFF8EE', border: '1px solid var(--gold)' }}>
              {MOCK_BOOKING.welcomeMessage}
            </p>
          </div>
        )}

        {/* Host info */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
          <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Your Host</h3>
          <div className="flex items-center gap-4 mb-4">
            <img src={MOCK_BOOKING.host.photo} alt={MOCK_BOOKING.host.name} className="w-14 h-14 rounded-full object-cover" />
            <div>
              <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{MOCK_BOOKING.host.name}</p>
              <p className="text-sm text-[#6B645C]">📱 {MOCK_BOOKING.host.phone}</p>
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
              <span>${MOCK_BOOKING.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[#6B645C]">
              <span>Approx. in GHS</span>
              <span>GH₵ {(MOCK_BOOKING.total * 15.5).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-stone-100">
              <span className="text-[#6B645C]">Payment status</span>
              <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>Paid ✓</span>
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

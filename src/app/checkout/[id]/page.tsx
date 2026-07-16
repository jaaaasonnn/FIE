'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Shield, CheckCircle, Phone, CreditCard, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { validateGhanaPhone } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────
type BookingData = {
  id:            string
  rentalMode:    string
  checkIn:       string
  checkOut:      string
  nightsOrMonths: number
  pricePerUnit:  number
  subtotal:      number
  serviceFee:    number
  damageDeposit: number
  totalPrice:    number
  status:        string
  listing: {
    id:            string
    title:         string
    photos:        string
    city:          string
    neighbourhood: string
  }
  host: { name: string }
}

const MOMO_NETWORKS = [
  { id: 'MTN',       label: 'MTN Mobile Money',  logo: '🟡' },
  { id: 'VODAFONE',  label: 'Vodafone Cash',      logo: '🔴' },
  { id: 'AIRTELTIGO', label: 'AirtelTigo Money',  logo: '🔴' },
]

const MODE_UNIT: Record<string, string> = {
  SHORT_STAY: 'nights',
  TEMP_STAY:  'months',
  PERMANENT:  'year',
}

export default function CheckoutPage() {
  const { id: bookingId } = useParams<{ id: string }>()
  const router = useRouter()

  // Booking data
  const [booking,      setBooking]      = useState<BookingData | null>(null)
  const [bookingError, setBookingError] = useState('')
  const [dataLoading,  setDataLoading]  = useState(true)

  // Payment form
  const [payMethod,   setPayMethod]   = useState<'MOMO' | 'CARD'>('MOMO')
  const [momoNetwork, setMomoNetwork] = useState('MTN')
  const [momoNumber,  setMomoNumber]  = useState('')
  const [cardNumber,  setCardNumber]  = useState('')
  const [cardExpiry,  setCardExpiry]  = useState('')
  const [cardCvv,     setCardCvv]     = useState('')
  const [cardName,    setCardName]    = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState(false)

  // ── Fetch booking from API ────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setDataLoading(true)
      try {
        const res  = await fetch(`/api/bookings?id=${bookingId}`)
        const data = await res.json()

        if (!res.ok) {
          setBookingError(data.error ?? 'Booking not found.')
          return
        }

        // Guard: booking was cancelled (dates taken by someone else)
        if (data.booking.status === 'CANCELLED') {
          setBookingError(
            'This booking has been cancelled because the dates became unavailable. Please go back and pick new dates.',
          )
          return
        }

        setBooking(data.booking)
      } catch {
        setBookingError('Failed to load booking details. Please try again.')
      } finally {
        setDataLoading(false)
      }
    }
    load()
  }, [bookingId])

  // ── Handle payment submission ─────────────────────────────────────────
  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (payMethod === 'MOMO' && !validateGhanaPhone(momoNumber)) {
      setError('Enter a valid Ghana MoMo number (e.g. 0241234567)')
      return
    }

    if (!booking) return
    setLoading(true)

    try {
      const res  = await fetch('/api/payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          method:    payMethod,
          momoNetwork: payMethod === 'MOMO' ? momoNetwork : undefined,
          momoNumber:  payMethod === 'MOMO' ? momoNumber  : undefined,
          email:    'guest@fiegh.com', // replace with auth session email
          amount:   booking.totalPrice,
        }),
      })
      const data = await res.json()

      if (res.status === 409) {
        // Booking was cancelled between page load and payment submit
        setError(
          'This booking has been cancelled because the selected dates are no longer available. Please start a new booking.',
        )
        return
      }

      if (!res.ok) {
        setError(data.error ?? 'Payment failed. Please try again.')
        return
      }

      // In production: redirect to Paystack checkout
      // window.location.href = data.authorizationUrl
      // For now, simulate success
      setSuccess(true)
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function getFirstPhoto(photosJson: string): string {
    try {
      const arr = JSON.parse(photosJson)
      return Array.isArray(arr) ? arr[0] : photosJson
    } catch { return photosJson }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading booking details…</p>
        </div>
      </div>
    )
  }

  // ── Booking error (not found / cancelled) ────────────────────────────
  if (bookingError || !booking) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ backgroundColor: '#FEE2E2' }}>
            <AlertCircle size={36} style={{ color: '#DC2626' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Booking unavailable
          </h2>
          <p className="mb-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {bookingError || 'This booking could not be loaded.'}
          </p>
          <Button onClick={() => router.back()}>← Go back and pick new dates</Button>
        </div>
      </div>
    )
  }

  // ── Success screen ────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="max-w-md w-full text-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: '#D1FAE5' }}>
            <CheckCircle size={48} style={{ color: '#059669' }} />
          </div>
          <h2 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Booking Confirmed! 🎉
          </h2>
          <p className="mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Your payment of <strong>${booking.totalPrice.toFixed(2)}</strong> has been received.
          </p>
          <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>
            Funds are held in escrow and will be released to the host when you check in.
          </p>

          <div className="p-5 rounded-2xl text-left mb-6 space-y-2"
            style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{booking.listing.title}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Check-in: {new Date(booking.checkIn).toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Check-out: {new Date(booking.checkOut).toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <p className="text-xs font-medium mt-2" style={{ color: 'var(--color-accent)' }}>
              📱 SMS confirmation sent to your phone
            </p>
          </div>

          <div className="p-4 rounded-2xl mb-6 text-sm flex items-start gap-2"
            style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              If anything is wrong at check-in, you have <strong>24 hours</strong> to raise a dispute and get a full refund.
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <Button size="lg" className="w-full" onClick={() => router.push('/dashboard/guest')}>
              View My Bookings
            </Button>
            <Button variant="outline" size="lg" className="w-full" onClick={() => router.push('/dashboard/guest/messages')}>
              💬 Message Host
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Checkout form ─────────────────────────────────────────────────────
  const photo      = getFirstPhoto(booking.listing.photos)
  const unit       = MODE_UNIT[booking.rentalMode] ?? ''
  const nightLabel = `${booking.nightsOrMonths} ${unit}`

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header bar */}
      <div style={{ backgroundColor: 'var(--color-accent)' }} className="py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold text-white">Complete Your Booking</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Payment held in escrow until check-in 🔒
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* ── Left: payment form ──────────────────────────────── */}
          <div>
            <form onSubmit={handlePay} className="space-y-6">
              {/* Payment method toggle */}
              <div>
                <p className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Payment Method</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { val: 'MOMO', icon: <Phone      size={16} />, label: 'Mobile Money' },
                    { val: 'CARD', icon: <CreditCard size={16} />, label: 'Debit / Credit Card' },
                  ].map(({ val, icon, label }) => (
                    <button key={val} type="button"
                      onClick={() => setPayMethod(val as 'MOMO' | 'CARD')}
                      className="flex items-center gap-2 p-4 rounded-2xl border-2 text-sm font-medium transition-all"
                      style={{
                        borderColor:     payMethod === val ? 'var(--color-accent)' : 'var(--color-border)',
                        backgroundColor: payMethod === val ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)',
                        color:           payMethod === val ? 'var(--color-accent)' : 'var(--color-text-primary)',
                      }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* MoMo form */}
              {payMethod === 'MOMO' && (
                <div className="space-y-4 p-5 rounded-2xl border"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Mobile Money Details</h3>
                  <div className="space-y-2">
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Select your network</p>
                    {MOMO_NETWORKS.map(({ id, label, logo }) => (
                      <button key={id} type="button"
                        onClick={() => setMomoNetwork(id)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                        style={{
                          borderColor:     momoNetwork === id ? 'var(--color-accent)' : 'var(--color-border)',
                          backgroundColor: momoNetwork === id ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)',
                        }}>
                        <span className="text-xl">{logo}</span>
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
                        {momoNetwork === id && <span className="ml-auto" style={{ color: 'var(--color-accent)' }}>✓</span>}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Your MoMo Number</label>
                    <input
                      type="tel"
                      placeholder="0241 234 567"
                      value={momoNumber}
                      onChange={(e) => setMomoNumber(e.target.value)}
                      className="w-full p-3 rounded-xl text-sm focus:outline-none"
                      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      A payment prompt will be sent to this number
                    </p>
                  </div>
                </div>
              )}

              {/* Card form */}
              {payMethod === 'CARD' && (
                <div className="space-y-4 p-5 rounded-2xl border"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Card Details</h3>
                  {[
                    { label: 'Name on Card',   ph: 'Kwame Asante',     val: cardName,   set: setCardName,   type: 'text',     max: 50, fmt: (v: string) => v },
                    { label: 'Card Number',    ph: '4111 1111 1111 1111', val: cardNumber, set: setCardNumber, type: 'text',   max: 19, fmt: (v: string) => v.replace(/\D/g,'').replace(/(\d{4})/g,'$1 ').trim().slice(0,19) },
                    { label: 'Expiry (MM/YY)', ph: '12/27',            val: cardExpiry, set: setCardExpiry, type: 'text',     max: 5,  fmt: (v: string) => v },
                    { label: 'CVV',            ph: '123',              val: cardCvv,    set: setCardCvv,    type: 'password', max: 4,  fmt: (v: string) => v.replace(/\D/g,'') },
                  ].map(({ label, ph, val, set, type, max, fmt }) => (
                    <div key={label}>
                      <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
                      <input
                        placeholder={ph}
                        value={val}
                        onChange={(e) => set(fmt(e.target.value))}
                        type={type}
                        maxLength={max}
                        className="w-full p-3 rounded-xl text-sm focus:outline-none"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                      />
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-xs p-3 rounded-xl"
                    style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)' }}>
                    <Shield size={14} style={{ color: '#059669' }} />
                    Secured by Paystack — Visa & Mastercard accepted
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="p-4 rounded-xl text-sm flex items-start gap-2"
                  style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Security reminder */}
              <div className="p-4 rounded-xl flex items-start gap-2"
                style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid #E5D0A8' }}>
                <span className="text-lg">⚠️</span>
                <p className="text-xs" style={{ color: 'var(--color-text-primary)' }}>
                  <strong>Safety reminder:</strong> Never pay a host directly outside FieGH. Your funds are protected in escrow until check-in.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all"
                style={{
                  backgroundColor: loading ? '#D4A94E' : 'var(--color-accent)',
                  color: '#fff',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading
                  ? <><Loader2 size={18} className="animate-spin" /> Processing…</>
                  : `🔒 Pay $${booking.totalPrice.toFixed(2)} Securely`}
              </button>
            </form>
          </div>

          {/* ── Right: order summary ────────────────────────────── */}
          <div>
            <div className="sticky top-24 space-y-4">
              <div className="p-5 rounded-2xl border shadow-sm"
                style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
                <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Booking Summary</h3>

                <div className="flex gap-3 mb-5">
                  <img src={photo} alt="" className="w-20 h-16 rounded-xl object-cover flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{booking.listing.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Host: {booking.host.name}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {new Date(booking.checkIn).toLocaleDateString('en-GH',  { day: 'numeric', month: 'short' })}
                      {' → '}
                      {new Date(booking.checkOut).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}>
                    <span>${booking.pricePerUnit} × {nightLabel}</span>
                    <span>${booking.subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}>
                    <span>Service fee (12%)</span>
                    <span>${booking.serviceFee.toFixed(2)}</span>
                  </div>
                  {booking.damageDeposit > 0 && (
                    <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}>
                      <span>Damage deposit (refundable)</span>
                      <span>${booking.damageDeposit}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-2 border-t" style={{ color: 'var(--color-text-primary)', borderColor: 'var(--color-border)' }}>
                    <span>Total</span>
                    <span>${booking.totalPrice.toFixed(2)}</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    ≈ GH₵ {(booking.totalPrice * 15.5).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Escrow info */}
              <div className="p-4 rounded-2xl" style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={16} style={{ color: '#059669' }} />
                  <p className="font-semibold text-sm" style={{ color: '#065F46' }}>Escrow Protection</p>
                </div>
                <ul className="space-y-1 text-xs" style={{ color: '#15803D' }}>
                  <li>✓ Payment held until you check in</li>
                  <li>✓ 24-hour dispute window after check-in</li>
                  <li>✓ Damage deposit returned within 48hrs of check-out</li>
                </ul>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

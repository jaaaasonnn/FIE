'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Shield, CheckCircle, Phone, CreditCard, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { validateGhanaPhone } from '@/lib/utils'

const MOCK_BOOKING = {
  id: 'b1',
  listing: 'Luxury 3BR Apartment, East Legon',
  host: 'Abena Mensah',
  checkIn: '2025-12-20',
  checkOut: '2025-12-28',
  mode: 'SHORT_STAY',
  nights: 8,
  pricePerNight: 120,
  subtotal: 960,
  serviceFee: 115.2,
  damageDeposit: 200,
  total: 1275.2,
  photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=300&q=70',
}

const MOMO_NETWORKS = [
  { id: 'MTN', label: 'MTN Mobile Money', color: '#FFC107', logo: '🟡' },
  { id: 'VODAFONE', label: 'Vodafone Cash', color: '#E60000', logo: '🔴' },
  { id: 'AIRTELTIGO', label: 'AirtelTigo Money', color: '#E63946', logo: '🔴' },
]

export default function CheckoutPage() {
  const params = useParams()
  const router = useRouter()
  const [payMethod, setPayMethod] = useState<'MOMO' | 'CARD'>('MOMO')
  const [momoNetwork, setMomoNetwork] = useState('MTN')
  const [momoNumber, setMomoNumber] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardName, setCardName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (payMethod === 'MOMO' && !validateGhanaPhone(momoNumber)) {
      setError('Enter a valid Ghana MoMo number (e.g. 0241234567)')
      return
    }

    setLoading(true)
    await new Promise((r) => setTimeout(r, 2000))
    setLoading(false)
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--cream)' }}>
        <div className="max-w-md w-full text-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: '#D1FAE5' }}>
            <CheckCircle size={48} style={{ color: '#059669' }} />
          </div>
          <h2 className="text-3xl font-bold mb-2" style={{ color: 'var(--brown-dark)', fontFamily: 'Playfair Display, serif' }}>
            Booking Confirmed! 🎉
          </h2>
          <p className="text-stone-600 mb-2">
            Your payment of <strong>${MOCK_BOOKING.total.toFixed(2)}</strong> has been received.
          </p>
          <p className="text-stone-500 text-sm mb-6">
            Funds are held in escrow and will be released to the host when you check in.
          </p>

          <div className="p-5 rounded-2xl text-left mb-6 space-y-2"
            style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
            <p className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>{MOCK_BOOKING.listing}</p>
            <p className="text-xs text-stone-500">
              Check-in: {new Date(MOCK_BOOKING.checkIn).toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <p className="text-xs text-stone-500">
              Check-out: {new Date(MOCK_BOOKING.checkOut).toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <p className="text-xs font-medium mt-2" style={{ color: 'var(--amber)' }}>
              📱 SMS confirmation sent to your phone
            </p>
          </div>

          <div className="p-4 rounded-2xl mb-6 text-sm flex items-start gap-2"
            style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>If anything is wrong at check-in, you have <strong>24 hours</strong> to raise a dispute and get a full refund.</span>
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--cream)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'Playfair Display, serif' }}>
            Complete Your Booking
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(250,247,242,0.6)' }}>
            Payment held in escrow until check-in 🔒
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: payment form */}
          <div>
            <form onSubmit={handlePay} className="space-y-6">
              {/* Payment method toggle */}
              <div>
                <p className="text-sm font-semibold mb-3" style={{ color: 'var(--brown-dark)' }}>Payment Method</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { val: 'MOMO', icon: <Phone size={16} />, label: 'Mobile Money' },
                    { val: 'CARD', icon: <CreditCard size={16} />, label: 'Debit / Credit Card' },
                  ].map(({ val, icon, label }) => (
                    <button key={val} type="button"
                      onClick={() => setPayMethod(val as 'MOMO' | 'CARD')}
                      className="flex items-center gap-2 p-4 rounded-2xl border-2 text-sm font-medium transition-all"
                      style={{
                        borderColor: payMethod === val ? 'var(--amber)' : '#E5E7EB',
                        backgroundColor: payMethod === val ? '#FFF8EE' : '#fff',
                        color: payMethod === val ? 'var(--amber)' : '#374151',
                      }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* MoMo form */}
              {payMethod === 'MOMO' && (
                <div className="space-y-4 p-5 rounded-2xl border border-stone-200 bg-white">
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>Mobile Money Details</h3>
                  <div className="space-y-2">
                    <p className="text-xs text-stone-500">Select your network</p>
                    <div className="space-y-2">
                      {MOMO_NETWORKS.map(({ id, label, logo }) => (
                        <button key={id} type="button"
                          onClick={() => setMomoNetwork(id)}
                          className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                          style={{
                            borderColor: momoNetwork === id ? 'var(--amber)' : '#E5E7EB',
                            backgroundColor: momoNetwork === id ? '#FFF8EE' : '#fff',
                          }}>
                          <span className="text-xl">{logo}</span>
                          <span className="text-sm font-medium" style={{ color: 'var(--brown-dark)' }}>{label}</span>
                          {momoNetwork === id && <span className="ml-auto text-amber-500">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">Your MoMo Number</label>
                    <input
                      type="tel"
                      placeholder="0241 234 567"
                      value={momoNumber}
                      onChange={(e) => setMomoNumber(e.target.value)}
                      className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                      style={{ fontFamily: 'DM Sans, sans-serif' }}
                    />
                    <p className="text-xs text-stone-400 mt-1">A payment prompt will be sent to this number</p>
                  </div>
                </div>
              )}

              {/* Card form */}
              {payMethod === 'CARD' && (
                <div className="space-y-4 p-5 rounded-2xl border border-stone-200 bg-white">
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>Card Details</h3>
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">Name on Card</label>
                    <input placeholder="Kwame Asante" value={cardName} onChange={(e) => setCardName(e.target.value)}
                      className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">Card Number</label>
                    <input placeholder="4111 1111 1111 1111" value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, '').replace(/(\d{4})/g, '$1 ').trim().slice(0, 19))}
                      className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                      maxLength={19} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">Expiry (MM/YY)</label>
                      <input placeholder="12/27" value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" maxLength={5} />
                    </div>
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">CVV</label>
                      <input placeholder="123" value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ''))}
                        className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" maxLength={4} type="password" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-stone-500 p-3 rounded-xl bg-stone-50">
                    <Shield size={14} style={{ color: '#059669' }} />
                    Secured by Paystack — Visa & Mastercard accepted
                  </div>
                </div>
              )}

              {error && (
                <div className="p-4 rounded-xl text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                  {error}
                </div>
              )}

              {/* Security reminder */}
              <div className="p-4 rounded-xl flex items-start gap-2"
                style={{ backgroundColor: '#FFF8EE', border: '1px solid var(--gold)' }}>
                <span className="text-lg">⚠️</span>
                <p className="text-xs" style={{ color: 'var(--brown-dark)' }}>
                  <strong>Safety reminder:</strong> Never pay a host directly outside FieGH. Your funds are protected in escrow until check-in.
                </p>
              </div>

              <Button type="submit" size="lg" className="w-full" loading={loading}>
                🔒 Pay ${MOCK_BOOKING.total.toFixed(2)} Securely
              </Button>
            </form>
          </div>

          {/* Right: order summary */}
          <div>
            <div className="sticky top-24 space-y-4">
              <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm">
                <h3 className="font-bold mb-4" style={{ color: 'var(--brown-dark)' }}>Booking Summary</h3>
                <div className="flex gap-3 mb-5">
                  <img src={MOCK_BOOKING.photo} alt="" className="w-20 h-16 rounded-xl object-cover flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>{MOCK_BOOKING.listing}</p>
                    <p className="text-xs text-stone-500">Host: {MOCK_BOOKING.host}</p>
                    <p className="text-xs text-stone-500">
                      {new Date(MOCK_BOOKING.checkIn).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                      {' → '}
                      {new Date(MOCK_BOOKING.checkOut).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm border-t border-stone-100 pt-4">
                  <div className="flex justify-between text-stone-600">
                    <span>${MOCK_BOOKING.pricePerNight} × {MOCK_BOOKING.nights} nights</span>
                    <span>${MOCK_BOOKING.subtotal}</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>Service fee (12%)</span>
                    <span>${MOCK_BOOKING.serviceFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>Damage deposit (refundable)</span>
                    <span>${MOCK_BOOKING.damageDeposit}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-2 border-t border-stone-100" style={{ color: 'var(--brown-dark)' }}>
                    <span>Total</span>
                    <span>${MOCK_BOOKING.total.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-stone-400">≈ GH₵ {(MOCK_BOOKING.total * 15.5).toLocaleString()}</p>
                </div>
              </div>

              {/* Escrow info */}
              <div className="p-4 rounded-2xl"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC' }}>
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

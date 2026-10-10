'use client'

import { Suspense, useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Shield, CheckCircle, Phone, CreditCard, AlertCircle, Loader2, MessageSquare, Lock, Check, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { validateGhanaPhone, formatUsd } from '@/lib/utils'
import { PriceBreakdown, depositIncludedNote } from '@/components/booking/PriceBreakdown'
import { OwnListingNote } from '@/components/booking/OwnListingNote'
import { useAuth } from '@/context/AuthContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { formatStayDate } from '@/lib/stayDates'
import { CancellationPolicy, SUPPORT_NOTE, heldNote } from '@/components/booking/CancellationPolicy'
import {
  EXPIRED_UNANSWERED, EXPIRED_UNPAID, EXPIRED_UNPAID_REFUNDED, HOST_MUST_ACCEPT, PAYMENT_STILL_PROCESSING, PAY_WINDOW_PASSED,
  formatPayBy, payState,
} from '@/lib/payDeadline'
import { isSettled, laterInstalmentRefusal, outstanding, rentPlan, tenancyMonths } from '@/lib/rentRules'
import type { ScheduleInstalment } from '@/components/booking/RentSchedule'

// ── Types ────────────────────────────────────────────────────────────────────
type BookingData = {
  id:            string
  hostId:        string
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
  paymentStatus: string
  payBy:         string | null
  cancelledBy:   string | null
  cancelReason:  string | null
  cancellationPolicy: string | null
  listing: {
    id:            string
    title:         string
    photos:        string
    city:          string
    neighbourhood: string
    cancellationPolicy: string
  }
  host: { name: string }
  /** Rent instalments, on a monthly or long-term booking. Empty on any other. */
  instalments?: ScheduleInstalment[]
}

const MOMO_NETWORKS = [
  { id: 'MTN',       label: 'MTN Mobile Money' },
  { id: 'VODAFONE',  label: 'Vodafone Cash' },
  { id: 'AIRTELTIGO', label: 'AirtelTigo Money' },
]

function paymentReturnError(paymentResult: string | null): string {
  if (paymentResult === 'failed') return 'Payment was not completed. Please try again.'
  if (paymentResult === 'error')  return 'We could not confirm your payment. If you were charged, contact support.'
  return ''
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutPageInner />
    </Suspense>
  )
}

function CheckoutPageInner() {
  const { id: bookingId } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const { rate: ghsRate } = useExchangeRate()

  // Client-side auth guard (belt-and-suspenders — middleware also redirects)
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?redirect=/checkout/${bookingId}`)
    }
  }, [authLoading, user, bookingId, router])

  // Booking data
  const [booking,      setBooking]      = useState<BookingData | null>(null)
  const [bookingError, setBookingError] = useState('')
  // A booking that cannot be paid for right now, for a reason that is not an error
  const [notice,       setNotice]       = useState<{ title: string; body: string; retry?: boolean } | null>(null)
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
  // Paystack's verify step redirects back here with ?payment=…, a full page
  // load, so the result is read once when the state is created.
  const [error,       setError]       = useState(() => paymentReturnError(searchParams.get('payment')))
  const [success,     setSuccess]     = useState(() => searchParams.get('payment') === 'success')
  // ?instalment=… is a rent payment after the first: the page then pays that
  // one instalment instead of the booking's first payment
  const instalmentId = searchParams.get('instalment')

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

        const state = payState(data.booking)
        const returned = new URLSearchParams(window.location.search).get('payment')

        // A rent payment after the first. The server decides whether it can
        // be paid; this only says why not before the tenant tries.
        const rent = ((data.booking.instalments ?? []) as ScheduleInstalment[]).find((i) => i.id === instalmentId && i.sequence > 1)
        if (instalmentId && !rent) {
          setBookingError('That rent payment could not be found on this booking.')
          return
        }
        if (rent) {
          if (isSettled(rent)) {
            setSuccess(true)
          } else if (returned === 'refunded') {
            setBookingError('This tenancy has ended, so that rent is no longer owed and your payment is being refunded in full. Refunds can take up to 10 working days to arrive.')
            return
          } else if (returned === 'pending') {
            setNotice({ title: 'Payment still processing', body: PAYMENT_STILL_PROCESSING, retry: true })
            return
          } else {
            const refusal = laterInstalmentRefusal({ instalment: rent, instalments: data.booking.instalments, booking: data.booking })
            if (refusal) {
              setNotice({ title: 'This rent cannot be paid right now', body: refusal })
              return
            }
          }
          setBooking(data.booking)
          return
        }

        // Not paid, or not answered, in time: the dates have been released
        if (state === 'EXPIRED_UNPAID') {
          setNotice({ title: 'This booking has expired', body: returned === 'refunded' ? EXPIRED_UNPAID_REFUNDED : EXPIRED_UNPAID })
          return
        }
        if (state === 'EXPIRED_UNANSWERED') {
          setNotice({ title: 'This request has expired', body: EXPIRED_UNANSWERED })
          return
        }

        // A cancelled or declined booking cannot be paid for
        if (data.booking.status === 'CANCELLED') {
          setBookingError(
            new URLSearchParams(window.location.search).get('payment') === 'refunded'
              ? 'This booking was cancelled before your payment arrived, so the payment is being refunded in full. Refunds can take up to 10 working days to arrive.'
              : 'This booking has been cancelled, so it cannot be paid for. Please go back and pick new dates.',
          )
          return
        }
        if (data.booking.status === 'DECLINED') {
          setBookingError(
            new URLSearchParams(window.location.search).get('payment') === 'refunded'
              ? 'The host declined this request before your payment arrived, so the payment is being refunded in full. Refunds can take up to 10 working days to arrive.'
              : 'The host declined this request, so it cannot be paid for. Please choose another home or other dates.',
          )
          return
        }

        // Paid already (the guest came back to this page, or Paystack's
        // confirmation reached us before their browser did)
        if (data.booking.paymentStatus === 'PAID') setSuccess(true)
        else if (state === 'AWAITING_HOST') {
          // A request is paid for only after the host accepts it
          setNotice({
            title: 'Waiting for the host',
            body: returned === 'refunded'
              ? 'The host has not accepted this request yet, so your payment is being refunded in full. Refunds can take up to 10 working days to arrive.'
              : `${HOST_MUST_ACCEPT} Once they do, you will find a Pay now button on your bookings page.`,
          })
          return
        } else if (returned === 'pending') {
          setNotice({ title: 'Payment still processing', body: PAYMENT_STILL_PROCESSING, retry: true })
          return
        } else if (state === 'PAY_WINDOW_PASSED') {
          setNotice({ title: 'The time to pay has passed', body: PAY_WINDOW_PASSED })
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
  }, [bookingId, instalmentId])

  // What this page pays: a later rent instalment, the first payment of a
  // booking paid in instalments, or the whole booking
  const instalments = booking?.instalments ?? []
  const rent = instalments.find((i) => i.id === instalmentId && i.sequence > 1) ?? null
  const plan = booking && !rent ? rentPlan(instalments, tenancyMonths(booking.rentalMode, booking.nightsOrMonths)) : null
  const paidRent = rent ? rent.amount - (isSettled(rent) ? rent.coveredFromDeposit : 0) : 0
  const payAmount = rent ? (isSettled(rent) ? paidRent : outstanding(rent)) : plan ? plan.dueNow : booking?.totalPrice ?? 0
  const dayText = (value: string | Date) => formatStayDate(value, { day: 'numeric', month: 'short', year: 'numeric' })

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
          ...(rent ? { instalmentId: rent.id } : {}),
          method:    payMethod,
          momoNetwork: payMethod === 'MOMO' ? momoNetwork : undefined,
          momoNumber:  payMethod === 'MOMO' ? momoNumber  : undefined,
          email:    'guest@fiegh.com', // replace with auth session email
          amount:   payAmount,
        }),
      })
      const data = await res.json()

      if (res.status === 409) {
        // Cancelled or declined between page load and payment submit
        setError(data.error ?? 'This booking can no longer be paid for. Please start a new booking.')
        return
      }

      if (!res.ok) {
        setError(data.error ?? 'Payment failed. Please try again.')
        return
      }

      if (!data.authorizationUrl) {
        setError('Payment could not be started. Please try again.')
        return
      }

      // Send the guest to Paystack's hosted checkout to actually pay.
      window.location.assign(data.authorizationUrl)
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

  // ── Not payable right now: waiting for the host, still processing, expired ──
  if (notice) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ backgroundColor: '#FEF3C7' }}>
            <Clock size={36} aria-hidden style={{ color: '#92400E' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>{notice.title}</h2>
          <p className="mb-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{notice.body}</p>
          <div className="flex flex-col gap-3">
            {notice.retry && (
              <Button size="lg" className="w-full" onClick={() => window.location.reload()}>Check again</Button>
            )}
            <Button variant={notice.retry ? 'outline' : undefined} size="lg" className="w-full"
              onClick={() => router.push('/dashboard/guest')}>
              View my bookings
            </Button>
          </div>
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

  // ── The host of this listing cannot pay for a booking on it ────────────
  if (user && booking.hostId === user.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="max-w-md w-full soft-panel-lg p-6">
          <OwnListingNote listingId={booking.listing.id} />
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
            {rent ? 'Rent received' : 'Booking Confirmed!'}
          </h2>
          <p className="mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {rent
              ? <>Your rent from {dayText(rent.periodStart)} to {dayText(rent.periodEnd)} is paid.</>
              : <>Your payment of <strong>{formatUsd(payAmount)}</strong> has been received.</>}
          </p>
          {!rent && booking.damageDeposit > 0 && (
            <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>{depositIncludedNote(booking.damageDeposit)}.</p>
          )}
          {!rent && plan && plan.laterCount > 0 && plan.firstLaterDue && (
            <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Your next rent payment of {formatUsd(plan.laterAmount)} is due on {dayText(plan.firstLaterDue)}. We will remind you.
            </p>
          )}
          <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>
            {heldNote(booking.rentalMode, instalments.length > 0)}
          </p>

          <div className="p-5 rounded-2xl text-left mb-6 space-y-2"
            style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{booking.listing.title}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Check-in: {formatStayDate(booking.checkIn, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Check-out: {formatStayDate(booking.checkOut, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>

          {!rent && (
            <div className="p-4 rounded-2xl mb-6 text-sm flex items-start gap-2"
              style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                {SUPPORT_NOTE}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button size="lg" className="w-full" onClick={() => router.push('/dashboard/guest')}>
              View My Bookings
            </Button>
            <Button variant="outline" size="lg" className="w-full" onClick={() => router.push('/dashboard/guest/messages')}>
              <MessageSquare size={16} aria-hidden /> Message Host
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Checkout form ─────────────────────────────────────────────────────
  const photo      = getFirstPhoto(booking.listing.photos)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header bar */}
      <div style={{ backgroundColor: 'var(--color-accent)' }} className="py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold text-white">{rent ? 'Pay Your Rent' : 'Complete Your Booking'}</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {rent ? 'Your rent is held by FieGH and paid to your host once it is due' : 'Your payment is held by FieGH until after check-in'}
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* ── Left: payment form ──────────────────────────────── */}
          <div>
            <form onSubmit={handlePay} className="space-y-6">
              {/* How long these dates are held for */}
              {!rent && booking.payBy && (
                <div className="p-4 rounded-2xl flex items-start gap-3"
                  style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
                  <Clock size={17} aria-hidden className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent-deep)' }} />
                  <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                    <strong>Pay by {formatPayBy(booking.payBy)}</strong> to keep these dates. After that they are released for other guests.
                  </p>
                </div>
              )}
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
                    {MOMO_NETWORKS.map(({ id, label }) => (
                      <button key={id} type="button"
                        onClick={() => setMomoNetwork(id)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                        style={{
                          borderColor:     momoNetwork === id ? 'var(--color-accent)' : 'var(--color-border)',
                          backgroundColor: momoNetwork === id ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)',
                        }}>
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
                        {momoNetwork === id && <Check size={16} strokeWidth={2.5} aria-hidden className="ml-auto" style={{ color: 'var(--color-accent-deep)' }} />}
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
                    Secured by Paystack. Visa & Mastercard accepted
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
                <AlertTriangle size={18} aria-hidden className="flex-shrink-0" style={{ color: 'var(--color-accent-deep)' }} />
                <p className="text-xs" style={{ color: 'var(--color-text-primary)' }}>
                  <strong>Safety reminder:</strong> Never pay a host directly outside FieGH. {rent ? 'Rent paid here is held by FieGH and paid to your host once it is due.' : 'Payments made here are held by FieGH until after check-in.'}
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all"
                style={{
                  backgroundColor: loading ? '#D4A94E' : 'var(--color-accent)',
                  color: 'var(--color-text-primary)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading
                  ? <><Loader2 size={18} className="animate-spin" /> Processing…</>
                  : <><Lock size={16} aria-hidden /> {`Pay ${formatUsd(payAmount)} Securely`}</>}
              </button>
            </form>
          </div>

          {/* ── Right: order summary ────────────────────────────── */}
          <div>
            <div className="sticky top-24 space-y-4">
              <div className="p-5 rounded-2xl border shadow-sm"
                style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
                <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>{rent ? 'Rent Payment' : 'Booking Summary'}</h3>

                <div className="flex gap-3 mb-5">
                  <img src={photo} alt="" className="w-20 h-16 rounded-xl object-cover flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{booking.listing.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Host: {booking.host.name}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatStayDate(booking.checkIn, { day: 'numeric', month: 'short' })}
                      {' → '}
                      {formatStayDate(booking.checkOut, { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </div>

                {rent ? (
                  <div className="border-t pt-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex justify-between gap-4" style={{ color: 'var(--color-text-secondary)' }}>
                      <span>Rent from {dayText(rent.periodStart)} to {dayText(rent.periodEnd)}</span>
                      <span>{formatUsd(rent.amount)}</span>
                    </div>
                    {rent.coveredFromDeposit > 0 && (
                      <div className="flex justify-between gap-4 mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                        <span>Already taken from your deposit</span>
                        <span>-{formatUsd(rent.coveredFromDeposit)}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4 font-semibold mt-4 pt-3 border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                      <span>Total due now</span><span>{formatUsd(payAmount)}</span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                      About GH₵ {(payAmount * ghsRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}. Charged in cedis at today&apos;s rate. Due {dayText(rent.dueDate)}.
                    </p>
                  </div>
                ) : (
                <PriceBreakdown
                  className="border-t pt-4"
                  rentalMode={booking.rentalMode}
                  pricePerUnit={booking.pricePerUnit}
                  units={booking.nightsOrMonths}
                  subtotal={booking.subtotal}
                  serviceFee={booking.serviceFee}
                  deposit={booking.damageDeposit}
                  total={payAmount}
                  plan={plan}
                  ghsRate={ghsRate}
                />
                )}
              </div>

              {/* The policy this booking was made under */}
              {!rent && <div className="p-4 rounded-2xl" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                <CancellationPolicy compact rentalMode={booking.rentalMode} serviceFee={booking.serviceFee}
                  policy={booking.cancellationPolicy ?? booking.listing.cancellationPolicy} />
              </div>}

              {/* How the money is held */}
              <div className="p-4 rounded-2xl" style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={16} style={{ color: '#059669' }} />
                  <p className="font-semibold text-sm" style={{ color: '#065F46' }}>How your payment is held</p>
                </div>
                <ul className="space-y-1 text-xs" style={{ color: '#15803D' }}>
                  <li className="flex items-start gap-1.5"><Check size={12} aria-hidden className="flex-shrink-0 mt-0.5" />{heldNote(booking.rentalMode, instalments.length > 0)}</li>
                  {!rent && <li className="flex items-start gap-1.5"><Check size={12} aria-hidden className="flex-shrink-0 mt-0.5" />{SUPPORT_NOTE}</li>}
                  {!rent && booking.damageDeposit > 0 && (
                    <li className="flex items-start gap-1.5"><Check size={12} aria-hidden className="flex-shrink-0 mt-0.5" />The deposit is returned by our team after check-out.</li>
                  )}
                </ul>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

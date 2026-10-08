'use client'

import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Clock, Calendar, MapPin, MessageSquare, Download, Shield, SearchX, Phone } from 'lucide-react'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { PriceBreakdown } from '@/components/booking/PriceBreakdown'
import { formatStayDate } from '@/lib/stayDates'
import { CancellationPolicy, SUPPORT_NOTE, heldNote } from '@/components/booking/CancellationPolicy'
import { refundStatusText, type RefundSummary } from '@/lib/refundWording'
import { problemLinkLabel } from '@/lib/disputes'
import { EXPIRED_UNANSWERED, EXPIRED_UNPAID, HOST_MUST_ACCEPT, PAY_WINDOW_PASSED, formatPayBy, payState } from '@/lib/payDeadline'

type BookingData = {
  id: string
  paymentReference: string | null
  rentalMode: string
  nightsOrMonths: number
  pricePerUnit: number
  subtotal: number
  serviceFee: number
  damageDeposit: number
  totalPrice: number
  status: string
  paymentStatus: string
  payBy: string | null
  cancelledBy: string | null
  cancelReason: string | null
  checkIn: string
  checkOut: string
  cancellationPolicy: string | null
  refund: RefundSummary | null
  disputes?: { raisedByRole: string; status: string }[]
  listing: {
    id: string
    title: string
    photos: string
    city: string
    neighbourhood: string | null
    welcomeMessage: string | null
    cancellationPolicy: string
  }
  host: {
    id: string
    name: string
    profilePhoto: string | null
    phone: string | null
  }
}

export default function BookingConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <BookingPageInner />
    </Suspense>
  )
}

function BookingPageInner() {
  const { id } = useParams<{ id: string }>()
  // Set by the listing page when a request has just been sent
  const justRequested = useSearchParams().get('requested') === '1'
  const { rate: ghsRate } = useExchangeRate()
  const [booking, setBooking] = useState<BookingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hostPhotoOpen, setHostPhotoOpen] = useState(false)

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
        <SearchX size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--color-text-muted)' }} />
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Booking not found</h1>
        <p className="text-sm text-center" style={{ color: 'var(--color-text-secondary)' }}>
          We couldn&apos;t find this booking. It may have been cancelled or the link is incorrect.
        </p>
        <Link href="/dashboard/guest"
          className="mt-2 px-6 py-3 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
          Go to My Bookings
        </Link>
      </div>
    )
  }

  const photos = (() => { try { return JSON.parse(booking.listing.photos) as string[] } catch { return [] } })()
  const photo  = photos[0] ?? null
  const ref    = booking.paymentReference ?? booking.id.slice(-8).toUpperCase()
  const address = [booking.listing.neighbourhood, booking.listing.city].filter(Boolean).join(', ')
  const pay = payState(booking)
  // Confirmed means paid for: an accepted or instant booking that is still
  // unpaid is not yet the guest's
  const confirmed = booking.status === 'CONFIRMED' && pay === null
  const heading = confirmed ? 'Booking Confirmed!'
    : pay === 'AWAITING_HOST' ? (justRequested ? 'Request sent' : 'Waiting for the host')
    : pay === 'AWAITING_PAYMENT' ? 'Pay to confirm your booking'
    : pay === 'PAY_WINDOW_PASSED' ? 'The time to pay has passed'
    : pay === 'EXPIRED_UNPAID' ? 'Booking expired'
    : pay === 'EXPIRED_UNANSWERED' ? 'Request expired'
    : booking.status === 'CANCELLED' ? 'Booking cancelled'
    : booking.status === 'DECLINED' ? 'Request declined'
    : booking.status === 'COMPLETED' ? 'Stay completed'
    : 'Booking Pending'
  const payNote = pay === 'AWAITING_HOST' ? `${HOST_MUST_ACCEPT} Nothing has been charged. Once they accept, a Pay now button will appear here and on your bookings page.`
    : pay === 'AWAITING_PAYMENT' ? (booking.payBy
        ? `Pay by ${formatPayBy(booking.payBy)} to keep these dates. After that they are released for other guests.`
        : 'This booking is not paid for yet. Pay to confirm it.')
    : pay === 'PAY_WINDOW_PASSED' ? PAY_WINDOW_PASSED
    : pay === 'EXPIRED_UNPAID' ? (booking.refund ? 'This booking was not paid in time, so the dates were released.' : EXPIRED_UNPAID)
    : pay === 'EXPIRED_UNANSWERED' ? EXPIRED_UNANSWERED
    : null

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
            {heading}
          </h1>
          <p style={{ color: 'rgba(250,247,242,0.7)' }}>Ref: {ref}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        {/* Where an unpaid booking stands, and the way to pay for it */}
        {payNote && (
          <div className="p-5 rounded-2xl" style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
            <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{payNote}</p>
            {pay === 'AWAITING_PAYMENT' && (
              <Link href={`/checkout/${booking.id}`}
                className="focus-ring mt-4 inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 rounded-full text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                Pay now
              </Link>
            )}
          </div>
        )}

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
                  {formatStayDate(booking.checkIn, { weekday: 'short', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-[#6B645C]">From 2:00 PM</p>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#F9FAFB' }}>
                <p className="text-xs text-[#6B645C] mb-1">Check-out</p>
                <p className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {formatStayDate(booking.checkOut, { weekday: 'short', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-[#6B645C]">By 12:00 PM</p>
              </div>
            </div>
          </div>
        </div>

        {/* Welcome message */}
        {booking.listing.welcomeMessage && (
          <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <h3 className="font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>Welcome Message from Host</h3>
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
              ? <>
                  <img src={booking.host.profilePhoto} alt={booking.host.name}
                    onClick={() => setHostPhotoOpen(true)}
                    className="w-14 h-14 rounded-full object-cover cursor-pointer" />
                  <PhotoLightbox src={booking.host.profilePhoto} alt={booking.host.name}
                    open={hostPhotoOpen} onOpenChange={setHostPhotoOpen} />
                </>
              : <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0"
                  style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                  {booking.host.name[0]}
                </div>}
            <div>
              <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{booking.host.name}</p>
              {booking.host.phone && (
                <p className="flex items-center gap-1.5 text-sm text-[#6B645C]"><Phone size={13} aria-hidden /> {booking.host.phone}</p>
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
          <PriceBreakdown
            rentalMode={booking.rentalMode}
            pricePerUnit={booking.pricePerUnit}
            units={booking.nightsOrMonths}
            subtotal={booking.subtotal}
            serviceFee={booking.serviceFee}
            deposit={booking.damageDeposit}
            total={booking.totalPrice}
            ghsRate={ghsRate}
            totalLabel={booking.paymentStatus === 'PAID' ? 'Total paid' : 'Total due now'}
          />
          <div className="mt-4 text-sm">
            <div className="flex justify-between items-center pt-2 border-t border-stone-100">
              <span className="text-[#6B645C]">Payment status</span>
              <span className="px-2 py-1 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: booking.paymentStatus === 'PAID' ? '#D1FAE5' : '#FEF3C7',
                  color:           booking.paymentStatus === 'PAID' ? '#065F46' : '#92400E',
                }}>
                {booking.paymentStatus === 'PAID' ? 'Paid'
                  : booking.paymentStatus === 'UNPAID' ? 'Not paid yet'
                  : booking.paymentStatus === 'REFUNDED' ? 'Refunded'
                  : booking.paymentStatus === 'PARTIALLY_REFUNDED' ? 'Partly refunded'
                  : booking.paymentStatus}
              </span>
            </div>
          </div>
        </div>

        {/* Refund, once the booking has been cancelled */}
        {booking.refund && (
          <div className="p-4 rounded-2xl" style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
            <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Refund</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{refundStatusText(booking.refund)}</p>
          </div>
        )}

        {/* Reporting a problem with the stay, or seeing one that was reported */}
        {problemLinkLabel('GUEST', booking) && (
          <div className="p-4 rounded-2xl" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {booking.disputes?.length ? 'A problem has been reported on this booking.' : 'Is something wrong with the home? You can report it until the end of the day after check-in.'}
            </p>
            <Link href={`/bookings/${booking.id}/problem`} className="focus-ring inline-block mt-2 text-sm font-semibold underline underline-offset-4"
              style={{ color: 'var(--color-accent-deep)' }}>
              {problemLinkLabel('GUEST', booking)}
            </Link>
          </div>
        )}

        {/* How the money is held, while the booking stands */}
        {(booking.status === 'CONFIRMED' || booking.status === 'PENDING') && (
          <div className="p-4 rounded-2xl flex items-start gap-3"
            style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
            <Shield size={18} style={{ color: '#2563EB', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: '#1E40AF' }}>How your payment is held</p>
              <p className="text-xs text-blue-600 mt-0.5">{heldNote(booking.rentalMode)} {SUPPORT_NOTE}</p>
            </div>
          </div>
        )}

        {/* The policy this booking was made under */}
        {(booking.status === 'CONFIRMED' || booking.status === 'PENDING') && (
          <div className="p-5 rounded-2xl" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <CancellationPolicy rentalMode={booking.rentalMode}
              policy={booking.cancellationPolicy ?? booking.listing.cancellationPolicy} />
            <p className="text-sm mt-3" style={{ color: 'var(--color-text-secondary)' }}>
              You can cancel from your bookings page, where you will see the exact refund before you confirm.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/dashboard/guest"
            className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
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

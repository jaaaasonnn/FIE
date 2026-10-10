'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatUsd } from '@/lib/utils'
import { depositIncludedNote } from '@/components/booking/PriceBreakdown'
import { Calendar, Heart, MessageSquare, Star, CreditCard, Bell, Shield, TrendingUp, Loader2, Clock } from 'lucide-react'
import { StatCard } from '@/components/ui/Card'
import { VerifiedBadge } from '@/components/ui/Badge'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { ReviewModal } from '@/components/reviews/ReviewModal'
import { useAuth } from '@/context/AuthContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { groupConversations, formatRelativeTime, type ApiMessage } from '@/lib/messages'
import { formatStayDate } from '@/lib/stayDates'
import { CancelDialog } from '@/components/booking/CancelDialog'
import { refundStatusText, type RefundSummary } from '@/lib/refundWording'
import { HOST_MUST_ACCEPT, formatPayBy, payState } from '@/lib/payDeadline'
import { NotificationsList } from '@/components/NotificationsList'
import { VerifyEmailNotice } from '@/components/account/VerifyEmailNotice'
import { problemLinkLabel } from '@/lib/disputes'
import { rentStatus } from '@/lib/rentRules'
import type { ScheduleInstalment } from '@/components/booking/RentSchedule'

type ApiBooking = {
  id: string
  checkIn: string
  checkOut: string
  createdAt: string
  updatedAt: string
  status: string
  totalPrice: number
  damageDeposit: number
  paymentStatus: string
  payBy?: string | null
  cancelledBy?: string | null
  cancelReason?: string | null
  rentalMode: string
  listing: { id: string; title: string; photos: string; city: string; neighbourhood: string | null }
  host: { id: string; name: string | null; profilePhoto: string | null }
  refund?: RefundSummary | null
  disputes?: { raisedByRole: string; status: string }[]
  /** Rent instalments, on a monthly or long-term booking. Empty on any other. */
  instalments?: ScheduleInstalment[]
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  CONFIRMED: { bg: '#D1FAE5', color: '#065F46', label: 'Confirmed' },
  COMPLETED: { bg: '#DBEAFE', color: '#1E40AF', label: 'Completed' },
  PENDING: { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  CANCELLED: { bg: '#FEE2E2', color: '#991B1B', label: 'Cancelled' },
  DECLINED: { bg: '#FEE2E2', color: '#991B1B', label: 'Declined' },
}
// Where an unpaid booking stands (lib/payDeadline.ts), shown in place of the plain status
const PAY_STATE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  AWAITING_HOST: { bg: '#FEF3C7', color: '#92400E', label: 'Waiting for host' },
  AWAITING_PAYMENT: { bg: '#FEF3C7', color: '#92400E', label: 'Awaiting payment' },
  PAY_WINDOW_PASSED: { bg: '#FEE2E2', color: '#991B1B', label: 'Not paid in time' },
  EXPIRED_UNPAID: { bg: '#FEE2E2', color: '#991B1B', label: 'Expired' },
  EXPIRED_UNANSWERED: { bg: '#FEE2E2', color: '#991B1B', label: 'Expired' },
}

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: 'Short Stay',
  TEMP_STAY:  'Monthly',
  PERMANENT:  'Long-Term',
}

function firstPhoto(photos: string): string {
  try {
    const arr = JSON.parse(photos)
    return Array.isArray(arr) ? arr[0] ?? '' : ''
  } catch { return '' }
}

type ActivityItem = { id: string; message: string; time: string; read: boolean; at: number }

// Synthesized from real bookings + real unread message counts — no dedicated
// notifications table exists (or is needed) for this simple a feed.
function buildActivityFeed(bookings: ApiBooking[], messages: ApiMessage[], userId: string): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const b of bookings) {
    const title = b.listing?.title ?? 'your listing'
    let message: string | null = null
    const pay = payState(b)
    if (pay === 'AWAITING_PAYMENT') message = `Your booking at ${title} is waiting for payment`
    else if (pay === 'EXPIRED_UNPAID' || pay === 'PAY_WINDOW_PASSED') message = `Your booking at ${title} was not paid in time`
    else if (pay === 'EXPIRED_UNANSWERED') message = `Your request at ${title} expired without an answer`
    else if (b.status === 'CONFIRMED') message = `Your booking at ${title} is confirmed`
    else if (b.status === 'CANCELLED') message = `Your booking at ${title} was cancelled`
    else if (b.status === 'DECLINED') message = `Your booking request at ${title} was declined`
    else if (b.status === 'COMPLETED') message = `Your stay at ${title} is complete. Leave a review!`
    if (!message) continue
    items.push({
      id: `booking-${b.id}`,
      message,
      time: formatRelativeTime(b.updatedAt),
      read: true, // booking status changes have no read/unread tracking
      at: new Date(b.updatedAt).getTime(),
    })
  }

  const conversations = groupConversations(messages, userId)
  for (const c of conversations) {
    if (c.unread === 0) continue
    items.push({
      id: `message-${c.id}`,
      message: `New message from ${c.otherName}`,
      time: c.time,
      read: false,
      at: c.lastAt,
    })
  }

  return items.sort((a, b) => b.at - a.at).slice(0, 5)
}

export default function GuestDashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const { rate: ghsRate } = useExchangeRate()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?redirect=/dashboard/guest')
  }, [authLoading, user, router])

  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [bookings, setBookings] = useState<ApiBooking[]>([])
  const [wishlistCount, setWishlistCount] = useState(0)
  const [reviewsGivenCount, setReviewsGivenCount] = useState(0)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  // Derived from which user the data was loaded for, not toggled in the effect
  const dataLoading = !!user && loadedFor !== user.id
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [reviewModalBookingId, setReviewModalBookingId] = useState<string | null>(null)
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) return
    const userId = user.id
    let active = true
    Promise.all([
      fetch(`/api/bookings?guestId=${user.id}`).then((r) => r.json()),
      fetch(`/api/wishlists?userId=${user.id}`).then((r) => r.json()),
      fetch(`/api/reviews?reviewerId=${user.id}`).then((r) => r.json()),
      fetch('/api/messages').then((r) => r.json()),
      fetch('/api/reviews?mine=true').then((r) => r.json()),
    ])
      .then(([bData, wData, rData, mData, mineData]) => {
        if (!active) return
        const bookingRows: ApiBooking[] = Array.isArray(bData.bookings) ? bData.bookings : []
        const messageRows: ApiMessage[] = Array.isArray(mData.messages) ? mData.messages : []
        const myReviews: Array<{ bookingId: string }> = Array.isArray(mineData.reviews) ? mineData.reviews : []
        setBookings(bookingRows)
        setWishlistCount(Array.isArray(wData.wishlists) ? wData.wishlists.length : 0)
        setReviewsGivenCount(typeof rData.total === 'number' ? rData.total : 0)
        setActivity(buildActivityFeed(bookingRows, messageRows, user.id))
        setReviewedBookingIds(new Set(myReviews.map((r) => r.bookingId)))
      })
      .catch(() => {
        if (!active) return
        setBookings([])
        setWishlistCount(0)
        setReviewsGivenCount(0)
        setActivity([])
      })
      .finally(() => { if (active) setLoadedFor(userId) })
    return () => { active = false }
  }, [user])

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    )
  }

  const firstName      = user.name?.split(' ')[0] ?? 'there'
  const completedCount = bookings.filter((b) => b.status === 'COMPLETED').length

  // After a cancellation, load the bookings again so the status and any
  // refund shown come from the server
  async function reloadBookings() {
    try {
      const res = await fetch(`/api/bookings?guestId=${user!.id}`)
      const data = await res.json()
      if (res.ok && Array.isArray(data.bookings)) setBookings(data.bookings)
    } catch { /* the list refreshes on the next visit */ }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-xl font-bold flex-shrink-0"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              {user.profilePhoto ? (
                <>
                  <img src={user.profilePhoto} alt={user.name ?? 'Guest'}
                    onClick={() => setLightboxOpen(true)}
                    className="w-full h-full object-cover cursor-pointer" />
                  <PhotoLightbox src={user.profilePhoto} alt={user.name ?? 'Guest'}
                    open={lightboxOpen} onOpenChange={setLightboxOpen} />
                </>
              ) : (
                (user.name ?? 'G')[0].toUpperCase()
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                Welcome back, {firstName}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm" style={{ color: 'rgba(250,247,242,0.6)' }}>Guest Account</span>
                {user.isVerified ? (
                  <VerifiedBadge />
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                    <Clock size={11} aria-hidden /> Verification Pending
                  </span>
                )}
              </div>
            </div>
            {!user.isVerified && (
              <div className="ml-auto hidden sm:block">
                <Link href="/auth/verify-id"
                  className="px-4 py-2 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                  Verify ID
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <VerifyEmailNotice className="mb-6" />
        <NotificationsList className="mb-6" />
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Calendar size={18} style={{ color: 'var(--color-accent)' }} />}
            label="Total Bookings" value={dataLoading ? '-' : bookings.length}
            sub={dataLoading ? undefined : `${completedCount} completed`} />
          <StatCard icon={<Heart size={18} style={{ color: '#EF4444' }} />}
            label="Saved Properties" value={dataLoading ? '-' : wishlistCount} />
          <StatCard icon={<Star size={18} style={{ color: '#F59E0B' }} />}
            label="Reviews Given" value={dataLoading ? '-' : reviewsGivenCount} />
          <StatCard icon={<TrendingUp size={18} style={{ color: '#059669' }} />}
            label="Trust Score" value={`${user.trustScore ?? 0}/100`}
            sub={user.isVerified ? undefined : 'ID verify to boost'} />
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
                color: active ? 'var(--amber)' : '#374151',
              }}>
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </div>

        {/* Verify ID banner */}
        {!user.isVerified && (
          <div className="p-5 rounded-2xl mb-8 flex items-center justify-between gap-4"
            style={{ backgroundColor: 'var(--color-border)', border: '1px solid var(--color-text-primary)' }}>
            <div className="flex items-center gap-3">
              <Shield size={20} aria-hidden className="flex-shrink-0" style={{ color: 'var(--color-text-primary)' }} />
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Verify your identity to unlock full access</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
                  Submit your Ghana Card, Passport, or Voter ID to get the Verified badge.
                </p>
              </div>
            </div>
            <Link href="/auth/verify-id"
              className="px-4 py-2 rounded-full text-sm font-semibold flex-shrink-0"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              Verify Now
            </Link>
          </div>
        )}

        {/* Bookings */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Your Bookings</h2>

          {dataLoading ? (
            <div className="space-y-4">
              {[1, 2].map((n) => (
                <div key={n} className="soft-panel p-4 animate-pulse flex gap-4">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-stone-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-stone-100 rounded w-2/3" />
                    <div className="h-3 bg-stone-100 rounded w-1/3" />
                    <div className="h-3 bg-stone-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : bookings.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow: '0 4px 18px rgba(31, 27, 22, 0.06)' }}>
              <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>No bookings yet</p>
              <p className="text-sm mt-1 max-w-sm mx-auto" style={{ color: 'var(--color-text-secondary)' }}>
                When you book a stay, it&apos;ll show up here.
              </p>
              <Link href="/search" className="inline-block mt-4 px-5 py-2.5 rounded-full text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                Browse listings
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {bookings.map((b) => {
                const pay = payState(b)
                const s = (pay && PAY_STATE_STYLES[pay]) ?? STATUS_STYLES[b.status] ?? STATUS_STYLES.PENDING
                const photo = firstPhoto(b.listing?.photos ?? '[]')
                // Paid in instalments: what is due now, or next, in place of the whole tenancy's rent
                const rent = rentStatus(b.instalments, b)
                return (
                  <div key={b.id} className="soft-panel overflow-hidden">
                    <div className="flex gap-4 p-4">
                      {photo ? (
                        <img src={photo} alt={b.listing?.title}
                          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-stone-100 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-sm leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                            {b.listing?.title}
                          </h3>
                          <span className="px-2 py-1 rounded-full text-xs font-medium flex-shrink-0"
                            style={{ backgroundColor: s.bg, color: s.color }}>
                            {s.label}
                          </span>
                        </div>
                        <p className="text-xs text-[#6B645C] mt-1">{MODE_LABELS[b.rentalMode] ?? b.rentalMode}</p>
                        <p className="text-xs text-[#6B645C]">
                          {formatStayDate(b.checkIn, { day: 'numeric', month: 'short' })}
                          {' to '}
                          {formatStayDate(b.checkOut, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        {rent ? (
                          rent.kind === 'DONE' ? (
                            <p className="text-xs mt-2 text-[#6B645C]">All rent is paid.</p>
                          ) : (
                            <p className="text-sm font-bold mt-2" style={{ color: rent.kind === 'NEXT' && rent.overdue ? '#991B1B' : 'var(--color-text-primary)' }}>
                              <span className="font-normal text-xs text-[#6B645C] mr-1.5">
                                {rent.kind === 'FIRST' ? 'First payment, due now'
                                  : `${rent.overdue ? 'Rent late, was due' : 'Next rent, due'} ${formatStayDate(rent.instalment.dueDate, { day: 'numeric', month: 'short' })}`}
                              </span>
                              {formatUsd(rent.amount)}
                              <span className="font-normal text-xs text-stone-400 ml-1">About GH₵ {(rent.amount * ghsRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                            </p>
                          )
                        ) : (
                          <p className="text-sm font-bold mt-2" style={{ color: 'var(--color-text-primary)' }}>
                            <span className="font-normal text-xs text-[#6B645C] mr-1.5">{b.paymentStatus === 'PAID' ? 'Total paid' : 'Total due now'}</span>
                            {formatUsd(b.totalPrice)}
                            <span className="font-normal text-xs text-stone-400 ml-1">About GH₵ {(b.totalPrice * ghsRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                          </p>
                        )}
                        {b.damageDeposit > 0 && (!rent || rent.kind === 'FIRST') && (
                          <p className="text-xs text-[#6B645C] mt-0.5">{depositIncludedNote(b.damageDeposit)}</p>
                        )}
                        {pay === 'AWAITING_PAYMENT' && b.payBy && (
                          <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-primary)' }}>Pay by {formatPayBy(b.payBy)} to keep these dates.</p>
                        )}
                        {pay === 'AWAITING_HOST' && (
                          <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-primary)' }}>{HOST_MUST_ACCEPT} Nothing has been charged.</p>
                        )}
                        {b.refund && (
                          <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-primary)' }}>{refundStatusText(b.refund)}</p>
                        )}
                      </div>
                    </div>
                    <div className="px-4 pb-4 flex gap-2 flex-wrap">
                      {pay === 'AWAITING_PAYMENT' && (
                        <Link href={`/checkout/${b.id}`}
                          className="focus-ring text-xs px-4 py-2 rounded-full font-semibold"
                          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                          Pay now
                        </Link>
                      )}
                      {rent?.kind === 'NEXT' && rent.payable && (
                        <Link href={`/checkout/${b.id}?instalment=${rent.instalment.id}`}
                          className="focus-ring text-xs px-4 py-2 rounded-full font-semibold"
                          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                          Pay rent
                        </Link>
                      )}
                      {rent && (
                        <Link href={`/bookings/${b.id}`}
                          className="text-xs px-4 py-2 rounded-full border font-medium transition-all hover:bg-stone-50"
                          style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                          Rent payments
                        </Link>
                      )}
                      <Link href={`/listings/${b.listing?.id}`}
                        className="text-xs px-4 py-2 rounded-full border font-medium transition-all hover:bg-stone-50"
                        style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                        View Listing
                      </Link>
                      {problemLinkLabel('GUEST', b) && (
                        <Link href={`/bookings/${b.id}/problem`}
                          className="text-xs px-4 py-2 rounded-full border font-medium transition-all hover:bg-stone-50"
                          style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                          {problemLinkLabel('GUEST', b)}
                        </Link>
                      )}
                      {(b.status === 'CONFIRMED' || b.status === 'PENDING') && (
                        <button onClick={() => setCancellingId(b.id)}
                          className="text-xs px-4 py-2 rounded-full font-medium"
                          style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                          {b.status === 'PENDING' ? 'Withdraw request' : 'Cancel'}
                        </button>
                      )}
                      {b.status === 'COMPLETED' && (
                        reviewedBookingIds.has(b.id) ? (
                          <span className="text-xs px-4 py-2 rounded-full font-medium"
                            style={{ backgroundColor: '#F3F4F6', color: '#6B645C' }}>
                            You&apos;ve already reviewed this stay
                          </span>
                        ) : (
                          <button onClick={() => setReviewModalBookingId(b.id)}
                            className="text-xs px-4 py-2 rounded-full font-medium"
                            style={{ backgroundColor: '#FFF8EE', color: 'var(--color-accent)' }}>
                            Leave Review
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="soft-panel p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bell size={18} style={{ color: 'var(--color-accent)' }} />
            <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Recent Notifications</h3>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nothing new right now.</p>
          ) : (
            <div className="space-y-3">
              {activity.map(({ id, message, time, read }) => (
                <div key={id} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ backgroundColor: read ? 'transparent' : '#FFF8EE' }}>
                  {!read && <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: 'var(--color-accent)' }} />}
                  {read && <div className="w-2 h-2 flex-shrink-0" />}
                  <div>
                    <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{message}</p>
                    <p className="text-xs text-stone-400 mt-0.5">{time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {reviewModalBookingId && (() => {
        const b = bookings.find((bk) => bk.id === reviewModalBookingId)
        if (!b) return null
        return (
          <ReviewModal
            open={!!reviewModalBookingId}
            onOpenChange={(o) => { if (!o) setReviewModalBookingId(null) }}
            bookingId={b.id}
            type="GUEST_TO_HOST"
            revieweeName={b.host?.name ?? 'your host'}
            onSubmitted={(id) => setReviewedBookingIds((prev) => new Set(prev).add(id))}
            onAlreadyReviewed={(id) => setReviewedBookingIds((prev) => new Set(prev).add(id))}
          />
        )
      })()}

      {(() => {
        const b = bookings.find((x) => x.id === cancellingId)
        if (!b) return null
        return (
          <CancelDialog
            bookingId={b.id}
            listingTitle={b.listing?.title ?? 'Your booking'}
            role="GUEST"
            onClose={() => setCancellingId(null)}
            onDone={() => { setCancellingId(null); reloadBookings() }}
          />
        )
      })()}
    </div>
  )
}

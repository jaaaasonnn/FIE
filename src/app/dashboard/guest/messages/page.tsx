'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { MessagesInbox } from '@/components/messages/MessagesInbox'
import { Loader2 } from 'lucide-react'

export default function GuestMessagesPage() {
  const { user, loading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  const hostId = searchParams.get('hostId')
  const listingId = searchParams.get('listingId')
  const bookingId = searchParams.get('bookingId')

  const seed =
    hostId && user && hostId !== user.id
      ? {
          otherUserId: hostId,
          listingId,
          bookingId,
        }
      : null

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>Messages</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(250,247,242,0.6)' }}>Chat with your hosts</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {authLoading ? (
          <div className="soft-panel flex items-center justify-center" style={{ height: '600px' }}>
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          </div>
        ) : !user ? (
          <div className="soft-panel flex flex-col items-center justify-center gap-4" style={{ height: '600px' }}>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Sign in to view your messages.</p>
            <Link
              href="/login?redirect=/dashboard/guest/messages"
              className="px-5 py-2.5 rounded-full text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
            >
              Sign in
            </Link>
          </div>
        ) : (
          <MessagesInbox
            userId={user.id}
            role="guest"
            seed={seed}
            nav={
              <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
                {[
                  { href: '/dashboard/guest', label: 'Bookings' },
                  { href: '/dashboard/guest/wishlist', label: 'Wishlist' },
                  { href: '/dashboard/guest/messages', label: 'Messages', active: true },
                  { href: '/dashboard/guest/payments', label: 'Payments' },
                ].map(({ href, label, active }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all"
                    style={{
                      backgroundColor: active ? 'var(--brown-dark)' : '#fff',
                      color: active ? 'var(--gold)' : '#374151',
                      border: active ? 'none' : '1px solid #E5E7EB',
                    }}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}

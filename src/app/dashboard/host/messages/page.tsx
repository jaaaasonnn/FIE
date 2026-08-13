'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { MessagesInbox } from '@/components/messages/MessagesInbox'

export default function HostMessagesPage() {
  const { user, loading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  const guestId = searchParams.get('guestId')
  const listingId = searchParams.get('listingId')
  const bookingId = searchParams.get('bookingId')

  const seed =
    guestId && user && guestId !== user.id
      ? {
          otherUserId: guestId,
          listingId,
          bookingId,
        }
      : null

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-8 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>Messages</h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>Chat with your guests</p>
          </div>
          <Link
            href="/dashboard/host"
            className="text-sm px-4 py-2 rounded-full"
            style={{
              backgroundColor: 'rgba(245,192,106,0.2)',
              color: 'var(--color-accent)',
              border: '1px solid rgba(245,192,106,0.3)',
            }}
          >
            ← Dashboard
          </Link>
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
              href="/login?redirect=/dashboard/host/messages"
              className="px-5 py-2.5 rounded-full text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
            >
              Sign in
            </Link>
          </div>
        ) : (
          <MessagesInbox userId={user.id} role="host" seed={seed} />
        )}
      </div>
    </div>
  )
}

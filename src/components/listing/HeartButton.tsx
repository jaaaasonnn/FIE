'use client'

import { useRouter } from 'next/navigation'
import { Heart } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useHydrated } from '@/lib/useHydrated'
import { toggleSaved, useWishlist } from '@/components/listing/wishlistStore'

/**
 * The heart on a card's photo: saves the home to the signed-in person's wishlist, or sends someone signed out
 * to log in and back. Drawn unfilled on the server; filled once the browser knows what the person has saved
 * (components/listing/wishlistStore.ts). The same size either way, so nothing moves.
 */
export function HeartButton({ listingId, title, className = '' }: { listingId: string; title: string; className?: string }) {
  const router = useRouter()
  const { user, loading } = useAuth()
  const userId = user?.id ?? null
  const { ids, busy } = useWishlist(userId)
  const saved = ids.has(listingId)
  // Drawn by the server: disabled until the page is running and knows who is signed in, so a tap is never
  // lost without a word (or sends someone signed in to log in)
  const ready = useHydrated() && !loading

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!userId) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)
      return
    }
    void toggleSaved(userId, listingId)
  }

  return (
    <button type="button" onClick={onClick} disabled={!ready} aria-pressed={saved} aria-busy={busy.has(listingId) || undefined}
      aria-label={`Save ${title} to your wishlist`} data-heart={listingId}
      className={`heart-button focus-ring ${className}`}>
      <span className="heart-button-face" aria-hidden>
        <Heart size={18} strokeWidth={2} className={saved ? 'heart-on' : ''} />
      </span>
    </button>
  )
}

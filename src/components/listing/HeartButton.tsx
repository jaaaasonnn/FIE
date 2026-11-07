'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useHydrated } from '@/lib/useHydrated'
import { rememberSave, takeSave, toggleSaved, useWishlist } from '@/components/listing/wishlistStore'

/**
 * A home's heart: saves it to the signed-in person's wishlist, or sends someone signed out to log in and back,
 * where it is saved once (components/listing/wishlistStore.ts, rememberSave). Drawn unfilled on the server; filled
 * once the browser knows what the person has saved. The same size either way, so nothing moves. On a card's photo
 * it is the round heart (globals.css .heart-button); given `children`, it draws them instead (the listing page's
 * row of actions), with the saved state.
 */
export function HeartButton({ listingId, title, className = '', children }: {
  listingId: string
  title: string
  className?: string
  children?: (saved: boolean) => React.ReactNode
}) {
  const router = useRouter()
  const { user, loading } = useAuth()
  const userId = user?.id ?? null
  const { ids, busy, loaded } = useWishlist(userId)
  const saved = ids.has(listingId)
  // Drawn by the server: disabled until the page is running and knows who is signed in, so a tap is never
  // lost without a word (or sends someone signed in to log in)
  const ready = useHydrated() && !loading

  // Back from logging in: the save they asked for, once, and only if the home is not saved already (a press
  // toggles, so it must never take a saved home off)
  useEffect(() => {
    if (!userId || !loaded) return
    if (takeSave(listingId) && !ids.has(listingId)) void toggleSaved(userId, listingId)
  }, [userId, loaded, listingId, ids])

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!userId) {
      rememberSave(listingId)
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)
      return
    }
    void toggleSaved(userId, listingId)
  }

  return (
    <button type="button" onClick={onClick} disabled={!ready} aria-pressed={saved} aria-busy={busy.has(listingId) || undefined}
      aria-label={`Save ${title} to your wishlist`} data-heart={listingId}
      className={`${children ? '' : 'heart-button '}focus-ring ${className}`}>
      {children
        ? children(saved)
        // The heart is drawn by CSS (globals.css .heart-button-face), filled when saved
        : <span className="heart-button-face" data-on={saved || undefined} aria-hidden />}
    </button>
  )
}

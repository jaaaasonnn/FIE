'use client'

import { useRouter } from 'next/navigation'
import { Home } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/** "Listing not found": drawn by the listing page when the listing cannot be shown to this person, and by
 *  not-found.tsx (a real 404) when there is no such listing at all (AS22) */
export function ListingNotFound() {
  const router = useRouter()
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="text-center">
<div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-deep)' }}>
          <Home size={26} strokeWidth={1.75} aria-hidden />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Listing not found</h2>
        <p className="mb-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>This listing may have been removed or is no longer active.</p>
        <Button onClick={() => router.push('/search')}>Browse all listings</Button>
      </div>
    </div>
  )
}

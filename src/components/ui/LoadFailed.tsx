'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LOAD_FAILED } from '@/lib/clientFetch'

/** In place of a page's content when its data could not be loaded, even after its tries (lib/clientFetch.ts). */
export function LoadFailed({ onRetry, className = 'min-h-[60vh]' }: { onRetry: () => void; className?: string }) {
  return (
    <div className={`flex items-center justify-center px-4 py-16 ${className}`} role="alert">
      <div className="max-w-md text-center">
        <AlertCircle className="w-10 h-10 text-[#C9932E] mx-auto mb-4" aria-hidden="true" />
        <p className="text-[#1F1B16] mb-6">{LOAD_FAILED}</p>
        <Button onClick={onRetry}>
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  )
}

/** Along the bottom of every page when the sign-in check got no answer: nothing is assumed until it does. */
export function LoadFailedBar({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-[#E8E1D6] bg-white px-4 py-3 shadow-lg" role="alert">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#1F1B16]">{LOAD_FAILED}</p>
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  )
}

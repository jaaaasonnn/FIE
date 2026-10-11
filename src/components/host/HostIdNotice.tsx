'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { IdCard } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { HOST_ID_BANNER, LISTING_ID_NOTICE, VERIFY_ID_PATH, waitingForIdLine, type HostIdState } from '@/lib/hostId'

type Loaded = { idState: HostIdState; waitingForId: { count: number; amount: number } | null }

/**
 * Tells a host, on their own pages, that FieGH pays them only once their ID
 * is approved, and where that stands. Nothing is drawn for an approved host,
 * for anyone who is not a host, or until the answer has loaded. The state
 * comes from the host-only payouts route (lib/hostId.ts decides it).
 *
 * `variant="listing"` is the short notice on the last step of creating a
 * listing. `showWaiting` adds the money that has fallen due and is waiting.
 */
export function HostIdNotice({ variant = 'banner', showWaiting = false, className = '' }: {
  variant?: 'banner' | 'listing'
  showWaiting?: boolean
  className?: string
}) {
  const { user } = useAuth()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const hostId = user?.role === 'HOST' ? user.id : null

  useEffect(() => {
    if (!hostId) return
    let active = true
    fetch(`/api/payouts?hostId=${hostId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.idState) setLoaded({ idState: data.idState, waitingForId: data.waitingForId ?? null })
      })
      .catch(() => {})
    return () => { active = false }
  }, [hostId])

  if (!hostId || !loaded || loaded.idState === 'APPROVED') return null
  const words = HOST_ID_BANNER[loaded.idState]
  const link = words.action && (
    <Link href={VERIFY_ID_PATH} className="px-4 py-2 rounded-full text-sm font-semibold flex-shrink-0"
      style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
      {words.action}
    </Link>
  )

  if (variant === 'listing') {
    return (
      <div className={`p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 ${className}`} data-host-id-notice={loaded.idState}
        style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
        <p className="text-sm flex-1 min-w-[12rem]" style={{ color: 'var(--color-text-primary)' }}>
          {loaded.idState === 'IN_REVIEW' ? `${words.title}. ${words.body}` : LISTING_ID_NOTICE}
        </p>
        {link}
      </div>
    )
  }

  return (
    <div className={`p-5 rounded-2xl flex flex-wrap items-center justify-between gap-4 ${className}`} data-host-id-notice={loaded.idState} role="status"
      style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
      <div className="flex items-start gap-3 flex-1 min-w-[14rem]">
        <IdCard size={18} aria-hidden style={{ color: 'var(--color-accent-deep)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{words.title}</p>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{words.body}</p>
          {showWaiting && loaded.waitingForId && (
            <p className="text-sm mt-1 font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {waitingForIdLine(loaded.waitingForId.amount, loaded.waitingForId.count)}
            </p>
          )}
        </div>
      </div>
      {link}
    </div>
  )
}

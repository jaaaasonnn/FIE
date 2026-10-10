'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

/**
 * Shown on the dashboards to someone who cannot yet book, list a home or pay
 * because their email address is not confirmed. Nothing is shown while that
 * rule is switched off, or once the address is confirmed.
 */
export function VerifyEmailNotice({ className = '' }: { className?: string }) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!user?.mustVerifyEmail) return null

  async function resend() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' })
      const data = await res.json()
      setMessage(data.message ?? data.error ?? '')
    } catch {
      setMessage('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`p-4 rounded-2xl flex items-start gap-3 ${className}`} role="status"
      style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
      <Mail size={18} aria-hidden className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent-deep)' }} />
      <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
        {user.email ? (
          <>
            <p className="font-semibold">Confirm your email address</p>
            <p className="mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              We sent a link to {user.email}. You can look around freely, but you need to follow that link before you can book, list a home or pay.
            </p>
            <button type="button" onClick={resend} disabled={busy}
              className="mt-2 text-sm font-semibold underline underline-offset-4 disabled:opacity-50">
              {busy ? 'Sending…' : 'Send the link again'}
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold">Add an email address</p>
            <p className="mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              You can look around freely, but you need a confirmed email address before you can book, list a home or pay.
            </p>
            <Link href="/profile/edit" className="inline-block mt-2 text-sm font-semibold underline underline-offset-4">Add it on your profile</Link>
          </>
        )}
        {message && <p className="mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>}
      </div>
    </div>
  )
}

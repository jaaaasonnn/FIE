'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle, Loader2 } from 'lucide-react'
import { AuthCard, authButton, authButtonStyle } from '@/components/account/AuthCard'

// Where the link in a confirmation email lands. Nothing happens until the
// button is pressed: a mail scanner that opens the link does not use it up.
export default function ConfirmEmailPage() {
  return <Suspense fallback={null}><ConfirmEmail /></Suspense>
}

function ConfirmEmail() {
  const token = useSearchParams().get('token') ?? ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ message: string; kind: string } | null>(null)

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/confirm-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'The link could not be followed.'); return }
      setDone(data)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthCard title="Thank you">
        <p className="flex items-start gap-2 text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }} role="status">
          <CheckCircle size={18} aria-hidden className="flex-shrink-0 mt-0.5" style={{ color: '#059669' }} /> {done.message}
        </p>
        {/* A full page load, so the signed-in state is read afresh */}
        <button type="button" onClick={() => window.location.assign('/')} className={authButton} style={authButtonStyle}>Continue to FieGH</button>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Confirm your email address">
      <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
        Press the button to confirm that this email address is yours.
      </p>
      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert">
          {error} You can send a new link from <Link href="/profile/edit" className="underline underline-offset-4">your profile</Link>.
        </p>
      )}
      <button type="button" onClick={confirm} disabled={busy || !token} className={authButton} style={authButtonStyle}>
        {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} Confirm my email
      </button>
      {!token && <p className="text-sm text-red-600 mt-3">This page needs the link from your email.</p>}
    </AuthCard>
  )
}

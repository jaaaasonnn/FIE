'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { AuthCard, authButton, authButtonStyle } from '@/components/account/AuthCard'

// Where the link in a reset email lands: choose a new password. The link is
// used only when the form is sent, and it works once.
export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetPassword /></Suspense>
}

function ResetPassword() {
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('The two passwords do not match'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'The password could not be changed.'); return }
      setDone(data.message)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthCard title="Password changed">
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }} role="status">
          {done} Your account has been signed out on every device.
        </p>
        <Link href="/login" className={authButton} style={authButtonStyle}>Sign in</Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <Input label="New password" type="password" autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters." />
        <Input label="Repeat the new password" type="password" autoComplete="new-password" required
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}{' '}
            {/expired|not valid/.test(error) && <Link href="/auth/forgot-password" className="underline underline-offset-4">Ask for a new link</Link>}
          </p>
        )}
        <button type="submit" disabled={busy || !token} className={authButton} style={authButtonStyle}>
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} Change password
        </button>
        {!token && <p className="text-sm text-red-600">This page needs the link from your email. <Link href="/auth/forgot-password" className="underline underline-offset-4">Ask for a new link</Link></p>}
      </form>
    </AuthCard>
  )
}

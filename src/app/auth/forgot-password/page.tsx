'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { AuthCard, authButton, authButtonStyle } from '@/components/account/AuthCard'

// Asking for a link to reset a password. The answer shown is the server's,
// and it is the same whether or not the address has an account.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const data = await res.json()
      setMessage(data.message ?? '')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="Forgot your password?">
      {message ? (
        <div className="space-y-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <p role="status">{message}</p>
          <p>If nothing arrives in a few minutes, check the address and your spam folder, then try again.</p>
          <Link href="/login" className="font-semibold underline underline-offset-4" style={{ color: 'var(--color-text-primary)' }}>Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Enter the email address on your account and we will send you a link to choose a new password.
          </p>
          <Input label="Email address" type="email" autoComplete="email" placeholder="ama@example.com" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className={authButton} style={authButtonStyle}>
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} Send the link
          </button>
          <p className="text-sm text-center">
            <Link href="/login" className="underline underline-offset-4" style={{ color: 'var(--color-text-secondary)' }}>Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthCard>
  )
}

'use client'

import { useState } from 'react'
import { CheckCircle, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { normalizeEmail } from '@/lib/utils'

export type EmailProfile = {
  email: string | null
  emailVerified?: boolean
  /** The address a change is waiting on, masked, when one is under way */
  pendingEmail?: string | null
}

const muted = { color: 'var(--color-text-secondary)' }
const ink = { color: 'var(--color-text-primary)' }

/**
 * The email address on an account: what it is, whether it has been confirmed,
 * and how to add or change it. The address never changes here. A link goes to
 * the new address and the email changes only when that link is followed; the
 * server says the same thing whether or not the address could be used.
 */
export function EmailSettings({ profile }: { profile: EmailProfile }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'change' | 'resend' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function post(url: string, body: Record<string, unknown>, which: 'change' | 'resend') {
    setBusy(which)
    setError('')
    setMessage('')
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'That did not work. Please try again.'); return false }
      setMessage(data.message)
      return true
    } catch {
      setError('Network error. Please try again.')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function change() {
    if (!normalizeEmail(email)) { setError('Enter a valid email address (e.g. ama@example.com)'); return }
    if (!password) { setError('Enter your current password to change your email.'); return }
    if (await post('/api/users/me/email', { email, password }, 'change')) {
      setOpen(false)
      setEmail('')
      setPassword('')
    }
  }

  return (
    <div>
      <p className="block text-sm font-medium mb-1.5" style={ink}>Email Address</p>
      <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span style={ink}>{profile.email ?? 'No email address yet'}</span>
          {profile.email && (
            profile.emailVerified
              ? <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: '#065F46' }}><CheckCircle size={13} aria-hidden /> Confirmed</span>
              : <span className="text-xs font-medium" style={{ color: '#92400E' }}>Not confirmed yet</span>
          )}
        </div>
        {profile.email && !profile.emailVerified && (
          <p className="text-xs mt-2" style={muted}>
            We sent a link to this address. Follow it to confirm the address is yours.{' '}
            <button type="button" onClick={() => post('/api/auth/resend-verification', {}, 'resend')} disabled={busy !== null}
              className="font-semibold underline underline-offset-2 disabled:opacity-50" style={ink}>
              {busy === 'resend' ? 'Sending…' : 'Send the link again'}
            </button>
          </p>
        )}
        {profile.pendingEmail && (
          <p className="text-xs mt-2" style={muted}>
            A change to {profile.pendingEmail} is waiting. It happens only when the link we sent to that address is followed.
          </p>
        )}
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setMessage(''); setError('') }}
            className="mt-2 text-xs font-semibold underline underline-offset-2" style={ink}>
            {profile.email ? 'Change email address' : 'Add an email address'}
          </button>
        )}
        {open && (
          <div className="mt-3 pt-3 border-t border-stone-100 space-y-3">
            <Input label={profile.email ? 'New email address' : 'Email address'} type="email" placeholder="ama@example.com" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Your current password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              hint={profile.email
                ? 'We will send a link to the new address. Your email changes only when you follow it; until then your current email stays as it is.'
                : 'We will send a link to this address. It is added to your account when you follow it.'} />
            <div className="flex gap-2">
              <button type="button" onClick={change} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                {busy === 'change' && <Loader2 size={13} className="animate-spin" aria-hidden />} Send the link
              </button>
              <button type="button" onClick={() => { setOpen(false); setError('') }} disabled={busy !== null}
                className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-200" style={ink}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
      {message && <p className="mt-1 text-xs" style={ink} role="status">{message}</p>}
      {!profile.email && !open && <p className="mt-1 text-xs" style={muted}>Add an email to get booking confirmations and receipts. You need one to pay.</p>}
    </div>
  )
}

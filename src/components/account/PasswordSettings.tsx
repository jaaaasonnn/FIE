'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'

const muted = { color: 'var(--color-text-secondary)' }
const ink = { color: 'var(--color-text-primary)' }
const MIN_LENGTH = 8

/**
 * The password on an account, and the devices it is signed in on. Changing
 * the password asks for the current one and signs every other device out.
 * "Sign out everywhere" ends every session, this one included.
 */
export function PasswordSettings() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState<'change' | 'signout' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function change() {
    setError('')
    setMessage('')
    if (!current) { setError('Enter your current password.'); return }
    if (next.length < MIN_LENGTH) { setError(`Your new password must be at least ${MIN_LENGTH} characters`); return }
    setBusy('change')
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'That did not work. Please try again.'); return }
      setMessage(data.message)
      setOpen(false)
      setCurrent('')
      setNext('')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function signOutEverywhere() {
    setError('')
    setBusy('signout')
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ everywhere: true }) })
      if (!res.ok) { setError('That did not work. Please try again.'); return }
      window.location.assign('/login')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-password-settings>
      <p className="block text-sm font-medium mb-1.5" style={ink}>Password and sign-in</p>
      <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
        {!open && (
          <div className="flex items-center gap-4 flex-wrap">
            <button type="button" onClick={() => { setOpen(true); setMessage(''); setError('') }}
              className="text-xs font-semibold underline underline-offset-2" style={ink}>
              Change password
            </button>
            <button type="button" onClick={signOutEverywhere} disabled={busy !== null}
              className="text-xs font-semibold underline underline-offset-2 disabled:opacity-50" style={ink}>
              {busy === 'signout' ? 'Signing out…' : 'Sign out on every device'}
            </button>
          </div>
        )}
        {open && (
          <div className="space-y-3">
            <Input label="Your current password" type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} />
            <Input label="New password" type="password" autoComplete="new-password"
              value={next} onChange={(e) => setNext(e.target.value)}
              hint={`At least ${MIN_LENGTH} characters. Every other device is signed out when you change it.`} />
            <div className="flex gap-2">
              <button type="button" onClick={change} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                {busy === 'change' && <Loader2 size={13} className="animate-spin" aria-hidden />} Change password
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
      {!open && !message && <p className="mt-1 text-xs" style={muted}>Signing out on every device ends every session, including this one.</p>}
    </div>
  )
}

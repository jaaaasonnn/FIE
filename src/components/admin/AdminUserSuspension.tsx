'use client'

import { useState } from 'react'
import { REASON_MAX, REASON_MIN } from '@/lib/suspensionRules'

const field = { border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }

/**
 * Suspend or restore one account, from the admin Users tab. A reason is
 * needed either way; the rules and the record are in lib/suspension.ts.
 * Nothing is offered on the admin's own row.
 */
export function AdminUserSuspension({ userId, suspended, isSelf, onDone }: { userId: string; suspended: boolean; isSelf: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (isSelf) return null
  const action = suspended ? 'restore' : 'suspend'
  const label = suspended ? 'Restore' : 'Suspend'

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Could not change this account.'); return }
      setOpen(false)
      setReason('')
      onDone()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="px-2 py-1 rounded text-xs"
        style={suspended ? { backgroundColor: '#D1FAE5', color: '#065F46' } : { backgroundColor: '#FEE2E2', color: '#991B1B' }}>
        {label}
      </button>
    )
  }

  return (
    <div className="w-56">
      <label className="block text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {suspended ? 'Why is this account being restored?' : 'Why is this account being suspended?'}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={REASON_MAX}
          className="mt-1 w-full p-2 rounded-lg text-xs font-normal" style={field} />
      </label>
      {!suspended && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          They are signed out and cannot sign in. Their homes leave search and their payouts wait. They are sent an email.
        </p>
      )}
      {error && <p className="mt-1 text-xs" style={{ color: '#991B1B' }}>{error}</p>}
      <div className="mt-2 flex gap-1">
        <button type="button" disabled={busy || reason.trim().length < REASON_MIN} onClick={submit}
          className="px-3 py-1 rounded-full text-xs font-semibold disabled:opacity-50"
          style={suspended ? { backgroundColor: '#065F46', color: '#fff' } : { backgroundColor: '#991B1B', color: '#fff' }}>
          {busy ? 'Saving' : `${label} account`}
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setError('') }}
          className="px-3 py-1 rounded-full text-xs font-semibold border border-stone-300" style={{ color: 'var(--color-text-primary)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

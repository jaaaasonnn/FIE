'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'
import type { HostIdState } from '@/lib/hostId'

type Verification = {
  id: string
  idType: string
  idPhotoUrl: string | null // signed link, short-lived: see GET /api/admin/verifications
  selfieUrl: string | null
  status: string
  notes: string | null
  createdAt: string
  user: { id: string; name: string | null; profilePhoto: string | null; role: string; isVerified: boolean }
}
type Waiting = { hostId: string; name: string | null; email: string | null; idState: HostIdState; count: number; amount: number }
type Data = { verifications: Verification[]; waitingForId: Waiting[]; payoutsLive: boolean }

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }
const field = { border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  PENDING: { label: 'Waiting for review', bg: '#FEF3C7', color: '#92400E' },
  APPROVED: { label: 'Approved', bg: '#D1FAE5', color: '#065F46' },
  REJECTED: { label: 'Rejected', bg: '#FEE2E2', color: '#991B1B' },
}
const ID_STATE: Record<HostIdState, string> = {
  APPROVED: 'Approved',
  IN_REVIEW: 'Waiting for review',
  REJECTED: 'Rejected: the host has been asked to send it again',
  NONE: 'No ID sent',
}

/**
 * The admin's ID reviews. Approving here is the only way a host becomes
 * payable (lib/hostId.ts): the admin who presses the button is recorded as
 * the reviewer. Above the reviews, the money that is waiting on a host's ID.
 */
export function AdminVerifications() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/verifications')
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Could not load the ID reviews.'); return }
      setData({ verifications: json.verifications ?? [], waitingForId: json.waitingForId ?? [], payoutsLive: !!json.payoutsLive })
    } catch {
      setError('Network error. Please try again.')
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/admin/verifications')
      .then(async (r) => ({ ok: r.ok, json: await r.json() }))
      .then(({ ok, json }) => {
        if (!active) return
        if (ok) setData({ verifications: json.verifications ?? [], waitingForId: json.waitingForId ?? [], payoutsLive: !!json.payoutsLive })
        else setError(json.error ?? 'Could not load the ID reviews.')
      })
      .catch(() => { if (active) setError('Network error. Please try again.') })
    return () => { active = false }
  }, [])

  if (error) return <p className="text-sm" style={{ color: '#991B1B' }}>{error}</p>
  if (!data) return <div className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={16} className="animate-spin" aria-hidden /> Loading ID reviews</div>

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-bold mb-1" style={ink}>Money waiting on a host&apos;s ID</h3>
        <p className="text-xs mb-3" style={muted}>
          Payouts that have fallen due and are not sent because the host&apos;s ID is not approved. Nothing is lost: each is sent on the first payout run after the ID is approved.
          {!data.payoutsLive && ' Payouts are switched off at the moment, so nothing would be sent to anyone yet.'}
        </p>
        {data.waitingForId.length === 0 ? <p className="text-sm" style={muted}>No payout is waiting on an ID.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={muted}>
                  <th className="py-2 pr-3 font-semibold">Host</th>
                  <th className="py-2 pr-3 font-semibold">ID</th>
                  <th className="py-2 pr-3 font-semibold">Payouts</th>
                  <th className="py-2 font-semibold">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {data.waitingForId.map((w) => (
                  <tr key={w.hostId} className="border-t border-stone-100">
                    <td className="py-2 pr-3" style={ink}>
                      <a href={`/profile/${w.hostId}`} className="font-medium underline">{w.name ?? 'Host'}</a>
                      {w.email && <span className="block text-xs" style={muted}>{w.email}</span>}
                    </td>
                    <td className="py-2 pr-3" style={ink}>{ID_STATE[w.idState]}</td>
                    <td className="py-2 pr-3" style={ink}>{w.count}</td>
                    <td className="py-2 font-semibold" style={ink}>{usd(w.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="font-bold mb-1" style={ink}>ID reviews</h3>
        <p className="text-xs mb-3" style={muted}>
          Approve only when the photo is clear, the whole document shows and the name matches the account. A host is paid only once their ID is approved here.
        </p>
        {data.verifications.length === 0 ? (
          <p className="text-sm text-center py-16" style={muted}>No ID has been sent in yet.</p>
        ) : (
          <div className="space-y-4">{data.verifications.map((v) => <ReviewRow key={v.id} v={v} onChanged={load} />)}</div>
        )}
      </section>
    </div>
  )
}

function ReviewRow({ v, onChanged }: { v: Verification; onChanged: () => void }) {
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const status = STATUS[v.status] ?? { label: v.status, bg: '#F3F4F6', color: '#6B7280' }
  const idName = v.idType.replace('_', ' ')
  // Taking back an approval already given needs a reason on the record
  const removing = v.status === 'APPROVED'

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/verifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationId: v.id, status: decision, notes }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'That did not work. Please try again.'); return }
      setMode(null)
      setNotes('')
      onChanged()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm text-sm" data-review={v.id}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4 flex-wrap">
          <div>
            <p className="font-semibold" style={ink}>{v.user.name ?? 'User'} <span className="text-xs font-normal" style={muted}>· {v.user.role === 'HOST' ? 'Host' : v.user.role === 'ADMIN' ? 'Admin' : 'Guest'}</span></p>
            <p className="text-sm text-[#6B645C]">{idName}</p>
            <p className="text-xs text-[#736D62]">Sent {new Date(v.createdAt).toLocaleDateString('en-GH')}</p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: status.bg, color: status.color }}>{status.label}</span>
            {v.notes && <p className="text-xs mt-2 max-w-xs" style={muted}>Note (admins only): {v.notes}</p>}
          </div>
          <Document url={v.idPhotoUrl} label="ID document" alt={`${idName} document`} />
          <Document url={v.selfieUrl} label="Selfie" alt="Selfie sent with the ID" />
        </div>
        {mode === null && (
          <div className="flex gap-2 flex-wrap">
            {v.status === 'PENDING' && (
              <button type="button" onClick={() => setMode('approve')} className="flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold"
                style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                <CheckCircle size={14} aria-hidden /> Approve
              </button>
            )}
            {v.status !== 'REJECTED' && (
              <button type="button" onClick={() => setMode('reject')} className="flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold"
                style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                <XCircle size={14} aria-hidden /> {removing ? 'Remove approval' : 'Reject'}
              </button>
            )}
          </div>
        )}
      </div>

      {mode === 'approve' && (
        <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
          <p className="text-xs" style={ink}>
            Approve this ID? The account shows &quot;ID checked&quot;{v.user.role === 'HOST' ? ', and this host can be paid from the next payout run' : ''}. You are recorded as the reviewer.
          </p>
          {error && <p className="text-xs font-semibold" style={{ color: '#991B1B' }} role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => decide('APPROVED')} className="px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#065F46', color: '#FFFFFF' }}>{busy ? 'Saving…' : 'Yes, approve this ID'}</button>
            <button type="button" disabled={busy} onClick={() => { setMode(null); setError('') }} className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-300" style={ink}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
          <label className="block text-xs" style={ink}>
            <span className="font-semibold">{removing ? 'Why is the approval being removed?' : 'Note on why it is rejected'}</span>{' '}
            <span style={muted}>({removing ? 'needed' : 'optional'}; only admins see this)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full p-2 rounded-lg text-sm" style={field} />
          </label>
          <p className="text-xs" style={muted}>
            The person is asked to send their ID again.{removing ? ' The "ID checked" badge is removed.' : ''}{v.user.role === 'HOST' ? ' This host\'s payouts are held until an ID is approved.' : ''}
          </p>
          {error && <p className="text-xs font-semibold" style={{ color: '#991B1B' }} role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || (removing && !notes.trim())} onClick={() => decide('REJECTED')} className="px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#991B1B', color: '#FFFFFF' }}>{busy ? 'Saving…' : removing ? 'Remove the approval' : 'Reject this ID'}</button>
            <button type="button" disabled={busy} onClick={() => { setMode(null); setError('') }} className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-300" style={ink}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** One private document, shown through its short-lived signed link. */
function Document({ url, label, alt }: { url: string | null; label: string; alt: string }) {
  if (!url) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-24 h-16 rounded-lg flex items-center justify-center text-[10px] text-[#736D62]" style={{ backgroundColor: '#F3F0EA', border: '1px dashed #D8D0C2' }}>None sent</div>
        <span className="text-[10px] text-[#736D62]">{label}</span>
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1 group">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to a private file, not one for the image optimiser */}
      <img src={url} alt={alt} className="w-24 h-16 rounded-lg object-cover border border-stone-200 group-hover:opacity-90" />
      <span className="text-[10px] text-[#736D62] group-hover:underline">{label}</span>
    </a>
  )
}

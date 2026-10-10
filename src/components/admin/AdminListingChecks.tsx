'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { formatStayDate } from '@/lib/stayDates'
import {
  CHECK_BADGE, CHECK_REMINDER_DAYS, CHECK_VALID_MONTHS, MIN_CHECK_NOTE, removalReasonText,
} from '@/lib/listingCheckRules'

type History = {
  id: string; checkedAt: string; expiresAt: string; method: string; note: string; checkedBy: string | null
  revokedAt: string | null; revokeReason: string | null; revokeNote: string | null; revokedBy: string | null
}
type Row = {
  id: string; title: string; hostName: string | null; region: string; city: string; neighbourhood: string | null
  propertyType: string; bedrooms: number; digitalAddress: string | null; photoCount: number
  check: { id: string; checkedAt: string; expiresAt: string; expiresSoon: boolean } | null
  blocked: string | null
  history: History[]
}
type Data = { queue: Row[]; checked: Row[]; items: Record<string, string>; methods: Record<string, string> }

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }
const field = { border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }
const day = (value: string) => formatStayDate(value, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The admin's queue of listings to check: those never checked and those whose
 * check runs out soon. Recording a check needs every item on the checklist,
 * how the home was seen, and a private note. Removing one needs a reason,
 * which the host is told. Everything is recorded with the admin who did it.
 */
export function AdminListingChecks() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/listing-checks')
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Could not load listing checks.'); return }
      setData(json)
    } catch {
      setError('Network error. Please try again.')
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/admin/listing-checks')
      .then(async (r) => ({ ok: r.ok, json: await r.json() }))
      .then(({ ok, json }) => {
        if (!active) return
        if (ok) setData(json)
        else setError(json.error ?? 'Could not load listing checks.')
      })
      .catch(() => { if (active) setError('Network error. Please try again.') })
    return () => { active = false }
  }, [])

  if (error) return <p className="text-sm" style={{ color: '#991B1B' }}>{error}</p>
  if (!data) return <div className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={16} className="animate-spin" aria-hidden /> Loading listing checks</div>

  return (
    <div className="space-y-8">
      <p className="text-sm p-3 rounded-xl" style={{ backgroundColor: 'var(--color-accent-subtle)', ...ink }}>
        A listing you mark shows &quot;{CHECK_BADGE}&quot; for {CHECK_VALID_MONTHS} months. It tells guests that FieGH checked the address and the photos on that date.
        It does not say who owns the home and it promises nothing about it, so record only what you have seen yourself.
        It is removed automatically if the host changes the address, the property type, the bedrooms or the photos, or the listing is put on hold.
      </p>

      <section>
        <h3 className="font-bold mb-1" style={ink}>To check</h3>
        <p className="text-xs mb-3" style={muted}>Live listings with no check, or with one that runs out within {CHECK_REMINDER_DAYS} days. Soonest to run out first.</p>
        {data.queue.length === 0 ? <p className="text-sm" style={muted}>Nothing is waiting.</p> : (
          <div className="space-y-3">{data.queue.map((row) => <ListingRow key={row.id} row={row} data={data} onChanged={load} />)}</div>
        )}
      </section>

      <section>
        <h3 className="font-bold mb-3" style={ink}>Checked</h3>
        {data.checked.length === 0 ? <p className="text-sm" style={muted}>No listing has a check standing.</p> : (
          <div className="space-y-3">{data.checked.map((row) => <ListingRow key={row.id} row={row} data={data} onChanged={load} />)}</div>
        )}
      </section>
    </div>
  )
}

function ListingRow({ row, data, onChanged }: { row: Row; data: Data; onChanged: () => void }) {
  const [mode, setMode] = useState<'mark' | 'revoke' | null>(null)
  const [method, setMethod] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/listing-checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: row.id, ...body }) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'That did not work. Please try again.'); return }
      setMode(null)
      onChanged()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const allTicked = Object.keys(data.items).every((key) => ticked.includes(key))
  const ready = allTicked && !!method && note.trim().length >= MIN_CHECK_NOTE

  return (
    <div className="soft-panel p-4 text-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="font-semibold" style={ink}>{row.title}</p>
          <p className="text-xs mt-0.5" style={muted}>
            Host {row.hostName ?? 'unknown'} · {[row.neighbourhood, row.city, row.region].filter(Boolean).join(', ')} · {row.propertyType}, {row.bedrooms} bed
          </p>
          <p className="text-xs mt-0.5" style={muted}>
            Digital address: <strong style={ink}>{row.digitalAddress ?? 'none given'}</strong> · {row.photoCount} photo{row.photoCount === 1 ? '' : 's'}
          </p>
          {row.check && (
            <p className="text-xs mt-0.5" style={{ color: row.check.expiresSoon ? '#92400E' : '#065F46' }}>
              Checked {day(row.check.checkedAt)}. {row.check.expiresSoon ? 'Runs out' : 'Stands until'} {day(row.check.expiresAt)}.
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href={`/listings/${row.id}`} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full text-xs font-semibold border border-stone-300" style={ink}>Open listing</a>
          {!row.blocked && mode === null && (
            <button type="button" onClick={() => setMode('mark')} className="px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              {row.check ? 'Record a new check' : 'Mark as checked'}
            </button>
          )}
          {row.check && mode === null && (
            <button type="button" onClick={() => setMode('revoke')} className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
              Remove check
            </button>
          )}
        </div>
      </div>

      {row.blocked && <p className="text-xs mt-3" style={{ color: '#92400E' }}>Cannot be marked yet: {row.blocked}</p>}

      {mode === 'mark' && (
        <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
          <p className="text-xs font-semibold" style={ink}>Confirm each of these. All are needed.</p>
          {Object.entries(data.items).map(([key, label]) => (
            <label key={key} className="flex items-start gap-2 text-xs cursor-pointer" style={ink}>
              <input type="checkbox" className="mt-0.5" checked={ticked.includes(key)}
                onChange={(e) => setTicked((t) => (e.target.checked ? [...t, key] : t.filter((k) => k !== key)))} />
              {label}
            </label>
          ))}
          <fieldset className="text-xs" style={ink}>
            <legend className="font-semibold mb-1">How did you see the home?</legend>
            <div className="flex gap-4">
              {Object.entries(data.methods).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name={`method-${row.id}`} checked={method === key} onChange={() => setMethod(key)} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs" style={ink}>
            <span className="font-semibold">Note of what you checked</span> <span style={muted}>(only admins see this; at least {MIN_CHECK_NOTE} characters)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full p-2 rounded-lg text-sm" style={field} />
          </label>
          {error && <p className="text-xs font-semibold" style={{ color: '#991B1B' }} role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !ready} onClick={() => post({ action: 'mark', method, checks: ticked, note })}
              className="px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              {busy ? 'Saving…' : `Show "${CHECK_BADGE}"`}
            </button>
            <button type="button" disabled={busy} onClick={() => { setMode(null); setError('') }} className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-300" style={ink}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'revoke' && (
        <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
          <label className="block text-xs" style={ink}>
            <span className="font-semibold">Reason for removing the check</span> <span style={muted}>(the host is told this)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full p-2 rounded-lg text-sm" style={field} />
          </label>
          {error && <p className="text-xs font-semibold" style={{ color: '#991B1B' }} role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !reason.trim()} onClick={() => post({ action: 'revoke', reason })}
              className="px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: '#991B1B', color: '#FFFFFF' }}>
              {busy ? 'Removing…' : 'Remove the check'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setMode(null); setError('') }} className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-300" style={ink}>Keep it</button>
          </div>
        </div>
      )}

      {row.history.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold cursor-pointer" style={ink}>History ({row.history.length})</summary>
          <ul className="mt-2 space-y-2 text-xs" style={muted}>
            {row.history.map((h) => (
              <li key={h.id}>
                <span style={ink}>Checked {day(h.checkedAt)} by {h.checkedBy ?? 'an admin'}</span> ({data.methods[h.method] ?? h.method}). Note: {h.note}
                {h.revokedAt && ` Removed ${day(h.revokedAt)}${h.revokedBy ? ` by ${h.revokedBy}` : ''}: ${h.revokeReason === 'REPLACED' ? 'replaced by a newer check' : removalReasonText(h.revokeReason, h.revokeNote)}.`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

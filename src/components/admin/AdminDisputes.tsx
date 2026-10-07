'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { formatUsd } from '@/lib/utils'
import { formatStayDate } from '@/lib/stayDates'
import { DECISION_AIM } from '@/lib/disputes'

type Evidence = { id: string; by: string; url: string | null }
type Item = {
  id: string
  raisedByRole: 'GUEST' | 'HOST'
  reasonLabel: string
  description: string | null
  response: string | null
  status: string
  statusText: string
  outcomeLabel: string | null
  refundAmount: number | null
  resolution: string | null
  createdAt: string
  open: boolean
  outcomes: { value: string; label: string }[]
  evidence: Evidence[]
  events: { type: string; note: string | null; createdAt: string; by: string }[]
  booking: {
    id: string; title: string; rentalMode: string; checkIn: string; checkOut: string; status: string; paymentStatus: string
    subtotal: number; serviceFee: number; damageDeposit: number; totalPrice: number
    guest: { name: string | null; disputesRaised: number }
    host: { name: string | null; disputesRaised: number }
    refund: { amount: number; status: string; reason: string } | null
    payout: { amount: number; status: string } | null
  }
}
type Effect = { summary: string[] }

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }
const field = { border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }
const NEEDS_AMOUNT = ['PARTIAL_REFUND', 'DEPOSIT_KEPT']

/**
 * The admin's view of every dispute: both statements, the photos, the
 * booking and its amounts, and a decision form. A decision is always
 * previewed first, as plain sentences worked out on the server, and only
 * then confirmed. While decisions are switched off, confirming reports the
 * same preview and changes nothing.
 */
export function AdminDisputes() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/disputes')
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not load disputes.'); return }
      setItems(data.disputes)
      setEnabled(!!data.decisionsEnabled)
    } catch {
      setError('Network error. Please try again.')
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/admin/disputes')
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!active) return
        if (ok) { setItems(data.disputes); setEnabled(!!data.decisionsEnabled) }
        else setError(data.error ?? 'Could not load disputes.')
      })
      .catch(() => { if (active) setError('Network error. Please try again.') })
    return () => { active = false }
  }, [])

  if (error) return <p className="text-sm" style={ink}>{error}</p>
  if (!items) return <div className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={16} className="animate-spin" aria-hidden /> Loading disputes</div>

  const openCount = items.filter((i) => i.open).length
  return (
    <div>
      <p className="text-sm" style={ink}>
        {openCount === 0 ? 'No open disputes.' : `${openCount} open ${openCount === 1 ? 'dispute' : 'disputes'}.`} {DECISION_AIM}
      </p>
      {!enabled && (
        <p className="text-sm mt-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--color-accent-subtle)', ...ink }}>
          Decisions are switched off (DISPUTE_DECISIONS_ENABLED). You can review, add notes and preview a decision, but confirming changes nothing.
          An open guest dispute still holds the host&apos;s payout.
        </p>
      )}
      <div className="mt-5 space-y-5">
        {items.map((item) => <DisputeItem key={item.id} item={item} onChanged={load} />)}
      </div>
    </div>
  )
}

function DisputeItem({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const b = item.booking
  const [outcome, setOutcome] = useState('')
  const [amount, setAmount] = useState('')
  const [resolution, setResolution] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<Effect | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/disputes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disputeId: item.id, ...body }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'That did not work. Please try again.'); return null }
      return data
    } catch {
      setError('Network error. Please try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const decision = () => ({ action: 'decide', outcome, ...(NEEDS_AMOUNT.includes(outcome) ? { amount } : {}), resolution })

  async function showPreview() {
    setPreview(null)
    const data = await post({ ...decision(), dryRun: true })
    if (data) setPreview(data.effect)
  }

  async function confirm() {
    const data = await post(decision())
    if (!data) return
    if (data.mode === 'dry-run') {
      setPreview(data.effect)
      setMessage(`Nothing was changed: ${data.reason}. This is what the decision would do.`)
      return
    }
    setPreview(null)
    setMessage('Decision recorded.')
    onChanged()
  }

  async function addNote(action: 'note' | 'correction') {
    const data = await post({ action, note })
    if (data) { setNote(''); onChanged() }
  }

  const side = (who: 'GUEST' | 'HOST') => (who === 'GUEST' ? 'Guest' : 'Host')
  const other = item.raisedByRole === 'GUEST' ? 'HOST' : 'GUEST'

  return (
    <article className="bg-white p-5 rounded-2xl border border-stone-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-base" style={ink}>{item.reasonLabel}</h3>
          <p className="text-xs mt-0.5" style={muted}>
            Raised by the {side(item.raisedByRole).toLowerCase()} on {formatStayDate(item.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}. {item.statusText}
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--color-accent-subtle)', ...ink }}>
          {item.status === 'UNDER_REVIEW' ? 'Under review' : item.status === 'OPEN' ? 'Open' : 'Decided'}
        </span>
      </div>

      {/* The booking and its money */}
      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs" style={muted}>
        <div className="col-span-2"><dt>Booking</dt><dd className="font-semibold" style={ink}>{b.title}</dd></div>
        <div><dt>Dates</dt><dd style={ink}>{formatStayDate(b.checkIn, { day: 'numeric', month: 'short' })} to {formatStayDate(b.checkOut, { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
        <div><dt>Status</dt><dd style={ink}>{b.status.toLowerCase()}, {b.paymentStatus.toLowerCase().replace('_', ' ')}</dd></div>
        <div><dt>Stay price</dt><dd style={ink}>{formatUsd(b.subtotal)}</dd></div>
        <div><dt>Service fee</dt><dd style={ink}>{formatUsd(b.serviceFee)}</dd></div>
        <div><dt>Deposit</dt><dd style={ink}>{formatUsd(b.damageDeposit)}</dd></div>
        <div><dt>Total paid</dt><dd style={ink}>{formatUsd(b.totalPrice)}</dd></div>
        <div><dt>Guest</dt><dd style={ink}>{b.guest.name ?? 'Guest'} ({b.guest.disputesRaised} raised)</dd></div>
        <div><dt>Host</dt><dd style={ink}>{b.host.name ?? 'Host'} ({b.host.disputesRaised} raised)</dd></div>
        <div><dt>Refund on record</dt><dd style={ink}>{b.refund ? `${formatUsd(b.refund.amount)}, ${b.refund.status.toLowerCase()}` : 'None'}</dd></div>
        <div><dt>Host payout</dt><dd style={ink}>{b.payout ? `${formatUsd(b.payout.amount)}, ${b.payout.status.toLowerCase()}` : item.open && item.raisedByRole === 'GUEST' ? 'On hold' : 'None yet'}</dd></div>
      </dl>

      {/* Both sides */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Statement title={`${side(item.raisedByRole)} says`} text={item.description} evidence={item.evidence.filter((e) => e.by === item.raisedByRole)} />
        <Statement title={`${side(other)} replies`} text={item.response} empty="No reply yet." evidence={item.evidence.filter((e) => e.by === other)} />
      </div>

      {item.outcomeLabel && (
        <div className="mt-4 p-3 rounded-xl" style={{ backgroundColor: 'var(--color-accent-subtle)' }}>
          <p className="text-sm font-semibold" style={ink}>Decision: {item.outcomeLabel}{item.refundAmount ? ` (${formatUsd(item.refundAmount)})` : ''}</p>
          {item.resolution && <p className="text-sm mt-1 whitespace-pre-wrap break-words" style={ink}>{item.resolution}</p>}
        </div>
      )}

      {/* History, including private notes */}
      {item.events.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm font-semibold cursor-pointer" style={ink}>History and notes</summary>
          <ol className="mt-2 space-y-1.5 text-xs leading-relaxed" style={muted}>
            {item.events.map((e, i) => (
              <li key={i}>
                {formatStayDate(e.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}: {e.type === 'ADMIN_NOTE' ? 'Private note' : e.type.toLowerCase().replace('_', ' ')} by {e.by}
                {e.note ? `. ${e.note}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* Decide */}
      {item.open && (
        <div className="mt-5 pt-5 border-t border-stone-100 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`outcome-${item.id}`} className="text-sm font-semibold block mb-1" style={ink}>Outcome</label>
              <select id={`outcome-${item.id}`} value={outcome} onChange={(e) => { setOutcome(e.target.value); setPreview(null) }}
                className="focus-ring w-full h-11 px-3 rounded-xl text-sm" style={field}>
                <option value="">Choose an outcome</option>
                {item.outcomes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {NEEDS_AMOUNT.includes(outcome) && (
              <div>
                <label htmlFor={`amount-${item.id}`} className="text-sm font-semibold block mb-1" style={ink}>
                  {outcome === 'PARTIAL_REFUND' ? `Amount to refund (up to ${formatUsd(b.subtotal)})` : `Amount to keep (up to ${formatUsd(b.damageDeposit)})`}
                </label>
                <input id={`amount-${item.id}`} type="number" min="0" step="0.01" inputMode="decimal" value={amount}
                  onChange={(e) => { setAmount(e.target.value); setPreview(null) }} className="focus-ring w-full h-11 px-3 rounded-xl text-sm" style={field} />
              </div>
            )}
          </div>
          <div>
            <label htmlFor={`why-${item.id}`} className="text-sm font-semibold block mb-1" style={ink}>Reason for the decision (both parties will see this)</label>
            <textarea id={`why-${item.id}`} value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} maxLength={1000}
              className="focus-ring w-full p-3 rounded-xl text-sm" style={field} />
          </div>

          {preview && (
            <div className="p-3 rounded-xl" role="status" style={{ border: '1px solid var(--color-border-strong)' }}>
              <p className="text-sm font-semibold" style={ink}>What this decision does</p>
              <ul className="mt-1.5 space-y-1 text-sm" style={ink}>
                {preview.summary.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <p className="text-xs mt-2" style={muted}>Decisions are final. A mistake is put right by hand and written here as a correction.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={showPreview} disabled={busy || !outcome}
              className="pressable focus-ring px-5 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ border: '1px solid var(--color-border-strong)', ...ink }}>
              Preview the effect
            </button>
            <button type="button" onClick={confirm} disabled={busy || !preview || !resolution.trim()}
              className="pressable focus-ring px-5 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)', ...ink }}>
              Confirm decision
            </button>
            {item.status === 'OPEN' && (
              <button type="button" onClick={async () => { if (await post({ action: 'review' })) onChanged() }} disabled={busy}
                className="pressable focus-ring px-5 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
                style={{ border: '1px solid var(--color-border-strong)', ...ink }}>
                Mark as under review
              </button>
            )}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="mt-5 pt-5 border-t border-stone-100">
        <label htmlFor={`note-${item.id}`} className="text-sm font-semibold block mb-1" style={ink}>Add a note</label>
        <textarea id={`note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
          className="focus-ring w-full p-3 rounded-xl text-sm" style={field} />
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" onClick={() => addNote('note')} disabled={busy || !note.trim()}
            className="pressable focus-ring px-5 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
            style={{ border: '1px solid var(--color-border-strong)', ...ink }}>
            Save as a private note
          </button>
          {!item.open && (
            <button type="button" onClick={() => addNote('correction')} disabled={busy || !note.trim()}
              className="pressable focus-ring px-5 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ border: '1px solid var(--color-border-strong)', ...ink }}>
              Save as a correction both parties see
            </button>
          )}
        </div>
      </div>

      {message && <p className="text-sm mt-3" role="status" style={ink}>{message}</p>}
      {error && <p className="text-sm mt-3" role="alert" style={{ color: '#991B1B' }}>{error}</p>}
    </article>
  )
}

function Statement({ title, text, empty, evidence }: { title: string; text: string | null; empty?: string; evidence: Evidence[] }) {
  return (
    <div>
      <p className="text-sm font-semibold" style={ink}>{title}</p>
      <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap break-words" style={text ? ink : muted}>{text || empty || ''}</p>
      {evidence.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {evidence.map((e) => (
            <li key={e.id}>
              {e.url && (
                <a href={e.url} target="_blank" rel="noreferrer" className="focus-ring block rounded-xl overflow-hidden" aria-label="Open photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.url} alt="" className="w-full aspect-square object-cover" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

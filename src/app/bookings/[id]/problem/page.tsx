'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { formatStayDate } from '@/lib/stayDates'
import { formatUsd } from '@/lib/utils'
import {
  EVIDENCE_TYPES, MAX_DESCRIPTION, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_PER_SIDE, MIN_DESCRIPTION,
} from '@/lib/disputes'
import { SUPPORT_EMAIL } from '@/lib/contact'

type Evidence = { id: string; by: string; url: string | null }
type DisputeEvent = { type: string; note: string | null; createdAt: string; by: string }
type Dispute = {
  id: string
  raisedByRole: 'GUEST' | 'HOST'
  reasonLabel: string
  description: string | null
  response: string | null
  status: string
  statusText: string
  outcome: string | null
  outcomeLabel: string | null
  refundAmount: number | null
  resolution: string | null
  createdAt: string
  evidence: Evidence[]
  events: DisputeEvent[]
}
type Data = {
  role: 'GUEST' | 'HOST' | null
  booking: { id: string; title: string; checkIn: string; checkOut: string; status: string }
  disputes: Dispute[]
  eligibility: { ok: boolean; message?: string; window?: { opens: string; closes: string } } | null
  reasons: Record<string, string> | null
  aim: string
}

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }
const field = { border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }
const day = (key: string) => formatStayDate(`${key}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })
const EVENT_LABELS: Record<string, string> = {
  RAISED: 'Reported', REPLIED: 'Replied', UNDER_REVIEW: 'Review started', RESOLVED: 'Decided', CORRECTION: 'Correction',
}

/** Checks the chosen files against the same limits the server applies. */
function checkPhotos(files: File[], alreadyAdded: number): string {
  if (alreadyAdded + files.length > MAX_EVIDENCE_PER_SIDE) return `You can add at most ${MAX_EVIDENCE_PER_SIDE} photos (${alreadyAdded} already added).`
  if (files.some((f) => !EVIDENCE_TYPES.includes(f.type))) return 'Photos must be JPEG, PNG or WebP images.'
  if (files.some((f) => f.size > MAX_EVIDENCE_BYTES)) return 'Each photo can be at most 5MB.'
  return ''
}

async function uploadPhotos(disputeId: string, files: File[]): Promise<string> {
  if (files.length === 0) return ''
  const form = new FormData()
  files.forEach((f) => form.append('photos', f))
  const res = await fetch(`/api/disputes/${disputeId}/evidence`, { method: 'POST', body: form })
  if (res.ok) return ''
  const data = await res.json().catch(() => ({}))
  return data.error ?? 'The photos could not be added. Please try again.'
}

export default function ReportProblemPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${id}/disputes`)
      const json = await res.json()
      if (!res.ok) { setLoadError(json.error ?? 'Could not load this booking.'); return }
      setData(json)
    } catch {
      setLoadError('Network error. Please try again.')
    }
  }, [id])

  useEffect(() => {
    let active = true
    fetch(`/api/bookings/${id}/disputes`)
      .then(async (r) => ({ ok: r.ok, json: await r.json() }))
      .then(({ ok, json }) => {
        if (!active) return
        if (ok) setData(json)
        else setLoadError(json.error ?? 'Could not load this booking.')
      })
      .catch(() => { if (active) setLoadError('Network error. Please try again.') })
    return () => { active = false }
  }, [id])

  const back = data?.role === 'HOST' ? '/dashboard/host/bookings' : '/dashboard/guest'

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-2xl mx-auto px-4 pt-10 pb-20">
        <h1 className="text-[1.75rem] md:text-[2rem] font-bold" style={ink}>Report a problem</h1>

        {loadError ? (
          <p className="mt-4 text-sm" style={ink}>{loadError}</p>
        ) : !data ? (
          <div className="flex items-center gap-2 mt-6 text-sm" style={muted}>
            <Loader2 size={16} className="animate-spin" aria-hidden /> Loading
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm" style={muted}>
              {data.booking.title}, {formatStayDate(data.booking.checkIn, { day: 'numeric', month: 'short' })} to{' '}
              {formatStayDate(data.booking.checkOut, { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>

            <div className="mt-6 space-y-5">
              {data.disputes.map((d) => (
                <DisputeCard key={d.id} dispute={d} role={data.role} aim={data.aim} onChanged={load} />
              ))}
            </div>

            {data.role && data.eligibility?.ok && data.reasons && (
              <RaiseForm bookingId={data.booking.id} role={data.role} reasons={data.reasons}
                closes={data.eligibility.window?.closes} aim={data.aim} onDone={load} />
            )}

            {data.role && data.eligibility && !data.eligibility.ok && !data.disputes.some((d) => d.raisedByRole === data.role) && (
              <p className="mt-6 text-sm leading-relaxed" style={ink}>{data.eligibility.message}</p>
            )}

            <Link href={back} className="focus-ring inline-block mt-8 text-sm font-semibold underline underline-offset-4" style={{ color: 'var(--color-accent-deep)' }}>
              Back to bookings
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

function RaiseForm({
  bookingId, role, reasons, closes, aim, onDone,
}: { bookingId: string; role: 'GUEST' | 'HOST'; reasons: Record<string, string>; closes?: string; aim: string; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!reason) { setError('Choose what the problem is.'); return }
    if (description.trim().length < MIN_DESCRIPTION) { setError(`Describe the problem in at least ${MIN_DESCRIPTION} characters.`); return }
    const photoError = checkPhotos(files, 0)
    if (photoError) { setError(photoError); return }

    setBusy(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/disputes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, description }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'The problem could not be reported. Please try again.'); return }
      // The report is in. Photos are attached to it next; if they fail, they can be added from the report itself.
      const uploadError = await uploadPhotos(json.dispute.id, files)
      if (uploadError) setError(`Your report was sent, but the photos were not added: ${uploadError}`)
      onDone()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 soft-panel-lg p-5 sm:p-6 space-y-4">
      <p className="text-sm leading-relaxed" style={ink}>
        {role === 'GUEST'
          ? 'Tell us what is wrong with the home. While your report is open, the host is not paid for this stay.'
          : 'Tell us what went wrong during the stay. A report from a host is about the damage deposit.'}
        {closes ? ` You can report until the end of ${day(closes)}.` : ''}
      </p>
      <div>
        <label htmlFor="problem-reason" className="text-sm font-semibold block mb-1" style={ink}>What is the problem?</label>
        <select id="problem-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="focus-ring w-full h-11 px-3 rounded-xl text-sm" style={field}>
          <option value="">Choose one</option>
          {Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="problem-description" className="text-sm font-semibold block mb-1" style={ink}>Describe what happened</label>
        <textarea id="problem-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={MAX_DESCRIPTION}
          className="focus-ring w-full p-3 rounded-xl text-sm" style={field} />
      </div>
      <div>
        <label htmlFor="problem-photos" className="text-sm font-semibold block mb-1" style={ink}>Photos (optional)</label>
        <input id="problem-photos" type="file" accept={EVIDENCE_TYPES.join(',')} multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="focus-ring block w-full text-sm" style={ink} />
        <p className="text-xs mt-1" style={muted}>
          Up to {MAX_EVIDENCE_PER_SIDE} photos, 5MB each, JPEG, PNG or WebP. Only you, the other party and our team can see them.
        </p>
      </div>
      {error && <p className="text-sm" role="alert" style={{ color: '#991B1B' }}>{error}</p>}
      <button type="submit" disabled={busy}
        className="pressable focus-ring w-full sm:w-auto px-7 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
        {busy ? 'Sending' : 'Send report'}
      </button>
      <p className="text-xs" style={muted}>{aim} The other party can reply once, and both of you will see the decision here.</p>
    </form>
  )
}

function DisputeCard({ dispute, role, aim, onChanged }: { dispute: Dispute; role: 'GUEST' | 'HOST' | null; aim: string; onChanged: () => void }) {
  const mine = role === dispute.raisedByRole
  const open = dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW'
  const canReply = !!role && !mine && open && !dispute.response
  const myPhotos = dispute.evidence.filter((e) => e.by === role).length
  const [reply, setReply] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const who = (side: string) => (side === role ? 'You' : side === 'GUEST' ? 'The guest' : 'The host')

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (reply.trim().length < MIN_DESCRIPTION) { setError(`Write your reply in at least ${MIN_DESCRIPTION} characters.`); return }
    const photoError = checkPhotos(files, myPhotos)
    if (photoError) { setError(photoError); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/disputes/${dispute.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: reply }) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'The reply could not be sent. Please try again.'); return }
      const uploadError = await uploadPhotos(dispute.id, files)
      if (uploadError) setError(`Your reply was sent, but the photos were not added: ${uploadError}`)
      onChanged()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function addPhotos(chosen: File[]) {
    setError('')
    const photoError = checkPhotos(chosen, myPhotos)
    if (photoError) { setError(photoError); return }
    setBusy(true)
    const uploadError = await uploadPhotos(dispute.id, chosen)
    setBusy(false)
    if (uploadError) setError(uploadError)
    onChanged()
  }

  return (
    <article className="soft-panel-lg p-5 sm:p-6">
      <p className="text-xs" style={muted}>
        {who(dispute.raisedByRole)} reported this on {formatStayDate(dispute.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <h2 className="text-lg font-bold mt-1" style={ink}>{dispute.reasonLabel}</h2>
      <p className="text-sm mt-1 font-semibold" style={ink}>{dispute.statusText}</p>

      <p className="text-sm mt-4 leading-relaxed whitespace-pre-wrap break-words" style={ink}>{dispute.description}</p>
      <Photos evidence={dispute.evidence.filter((e) => e.by === dispute.raisedByRole)} label={`Photos from ${who(dispute.raisedByRole).toLowerCase()}`} />

      {dispute.response && (
        <div className="mt-5 pt-5 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-semibold" style={ink}>{who(dispute.raisedByRole === 'GUEST' ? 'HOST' : 'GUEST')} replied</p>
          <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap break-words" style={ink}>{dispute.response}</p>
        </div>
      )}
      <Photos evidence={dispute.evidence.filter((e) => e.by !== dispute.raisedByRole)}
        label={`Photos from ${who(dispute.raisedByRole === 'GUEST' ? 'HOST' : 'GUEST').toLowerCase()}`} />

      {dispute.outcomeLabel && (
        <div className="mt-5 p-4 rounded-2xl" style={{ backgroundColor: 'var(--color-accent-subtle)' }}>
          <p className="text-sm font-semibold" style={ink}>
            Decision: {dispute.outcomeLabel}{dispute.refundAmount ? ` (${formatUsd(dispute.refundAmount)})` : ''}
          </p>
          {dispute.resolution && <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap break-words" style={ink}>{dispute.resolution}</p>}
          <p className="text-xs mt-2" style={muted}>Decisions are final. If something looks wrong, contact support at {SUPPORT_EMAIL}.</p>
        </div>
      )}

      {canReply && (
        <form onSubmit={sendReply} className="mt-5 pt-5 border-t space-y-3" style={{ borderColor: 'var(--color-border)' }}>
          <label htmlFor={`reply-${dispute.id}`} className="text-sm font-semibold block" style={ink}>Your reply</label>
          <textarea id={`reply-${dispute.id}`} value={reply} onChange={(e) => setReply(e.target.value)} rows={4} maxLength={MAX_DESCRIPTION}
            className="focus-ring w-full p-3 rounded-xl text-sm" style={field} />
          <div>
            <label htmlFor={`reply-photos-${dispute.id}`} className="text-sm font-semibold block mb-1" style={ink}>Photos (optional)</label>
            <input id={`reply-photos-${dispute.id}`} type="file" accept={EVIDENCE_TYPES.join(',')} multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="focus-ring block w-full text-sm" style={ink} />
          </div>
          <p className="text-xs" style={muted}>You can reply once. {aim}</p>
          <button type="submit" disabled={busy}
            className="pressable focus-ring w-full sm:w-auto px-7 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
            {busy ? 'Sending' : 'Send reply'}
          </button>
        </form>
      )}

      {role && open && !canReply && myPhotos < MAX_EVIDENCE_PER_SIDE && (mine || dispute.response) && (
        <div className="mt-5 pt-5 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <label htmlFor={`more-photos-${dispute.id}`} className="text-sm font-semibold block mb-1" style={ink}>
            Add photos ({myPhotos} of {MAX_EVIDENCE_PER_SIDE} added)
          </label>
          <input id={`more-photos-${dispute.id}`} type="file" accept={EVIDENCE_TYPES.join(',')} multiple disabled={busy}
            onChange={(e) => { const chosen = Array.from(e.target.files ?? []); e.target.value = ''; if (chosen.length) addPhotos(chosen) }}
            className="focus-ring block w-full text-sm" style={ink} />
        </div>
      )}

      {error && <p className="text-sm mt-3" role="alert" style={{ color: '#991B1B' }}>{error}</p>}

      {dispute.events.length > 0 && (
        <details className="mt-5">
          <summary className="text-sm font-semibold cursor-pointer focus-ring rounded" style={ink}>History</summary>
          <ol className="mt-2 space-y-1.5 text-xs leading-relaxed" style={muted}>
            {dispute.events.map((e, i) => (
              <li key={i}>
                {formatStayDate(e.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}: {EVENT_LABELS[e.type] ?? e.type} by {e.by}
                {e.type === 'CORRECTION' && e.note ? `. ${e.note}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  )
}

function Photos({ evidence, label }: { evidence: Evidence[]; label: string }) {
  if (evidence.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-xs mb-1.5" style={muted}>{label}</p>
      <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {evidence.map((e) => (
          <li key={e.id}>
            {e.url ? (
              // Signed, short-lived links to a private bucket: next/image cannot optimise them
              <a href={e.url} target="_blank" rel="noreferrer" className="focus-ring block rounded-xl overflow-hidden" aria-label="Open photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.url} alt="" className="w-full aspect-square object-cover" />
              </a>
            ) : (
              <div className="w-full aspect-square rounded-xl" style={{ backgroundColor: 'var(--color-border)' }} />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

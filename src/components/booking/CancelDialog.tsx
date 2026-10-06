'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { formatUsd } from '@/lib/utils'
import { formatStayDate } from '@/lib/stayDates'
import { HOST_CANCEL_REASONS, MAX_CANCEL_NOTE, type HostCancelReason } from '@/lib/cancellationPolicy'
import { REFUND_TIMING, type CancelPreview } from '@/lib/cancellation'

type Props = {
  bookingId: string
  listingTitle: string
  /** Who is cancelling: decides the wording and, for a host, asks for a reason */
  role: 'GUEST' | 'HOST'
  onClose: () => void
  /** Called once the booking has been cancelled, with the server's message */
  onDone: (message: string) => void
}

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }

/**
 * Shows exactly what cancelling will do before anything happens: the amount
 * back, the amount kept and the day the refund stops applying, all worked out
 * on the server. Confirming sends that amount back with the request; if the
 * server now works out a different one, nothing is cancelled and the new
 * figures are shown instead.
 */
export function CancelDialog({ bookingId, listingTitle, role, onClose, onDone }: Props) {
  const [preview, setPreview] = useState<CancelPreview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reason, setReason] = useState<HostCancelReason | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)
  const [done, setDone] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/bookings/${bookingId}/cancellation`)
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!active) return
        if (ok) setPreview(data.preview)
        else setLoadError(data.error ?? 'Could not work out the cancellation. Please try again.')
      })
      .catch(() => { if (active) setLoadError('Network error. Please try again.') })
    return () => { active = false }
  }, [bookingId])

  // Escape closes, and focus starts inside the dialog
  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function confirm() {
    if (!preview?.canCancel) return
    if (role === 'HOST' && !reason) { setError('Choose a reason for cancelling.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: role === 'HOST' ? 'host-cancel' : 'cancel',
          // Only compared on the server with what it works out itself
          ...(preview.quote ? { expectedRefund: preview.quote.total } : {}),
          ...(role === 'HOST' ? { reason, note } : {}),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setDone(data.message ?? 'The booking is cancelled.')
        return
      }
      if (data.preview) {
        // The amount moved while this was open (the day rolled over): show the new one
        setPreview(data.preview)
        setChanged(true)
      }
      setError(data.error ?? 'Could not cancel the booking. Please try again.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const withdrawal = preview?.canCancel && preview.withdrawal
  const heading = done ? (withdrawal ? 'Request withdrawn' : 'Booking cancelled')
    : withdrawal ? 'Withdraw this request?' : 'Cancel this booking?'
  const quote = preview?.canCancel ? preview.quote : null

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4"
      style={{ backgroundColor: 'rgba(31,27,22,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="cancel-dialog-title" tabIndex={-1}
        className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 outline-none"
        style={{ backgroundColor: 'var(--color-bg-card)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="cancel-dialog-title" className="text-lg font-bold" style={ink}>{heading}</h2>
            <p className="text-sm mt-0.5 truncate" style={muted}>{listingTitle}</p>
          </div>
          <button type="button" onClick={() => (done ? onDone(done) : onClose())} disabled={busy} aria-label="Close"
            className="focus-ring w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-full flex-shrink-0 disabled:opacity-50">
            <X size={18} aria-hidden style={ink} />
          </button>
        </div>

        {done ? (
          <>
            <p className="text-sm mt-4 leading-relaxed" style={ink}>{done}</p>
            <button type="button" onClick={() => onDone(done)}
              className="pressable focus-ring mt-5 w-full h-11 rounded-full text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              Done
            </button>
          </>
        ) : loadError ? (
          <p className="text-sm mt-4" style={ink}>{loadError}</p>
        ) : !preview ? (
          <div className="flex items-center gap-2 mt-5 text-sm" style={muted}>
            <Loader2 size={16} className="animate-spin" aria-hidden /> Working out your refund
          </div>
        ) : !preview.canCancel ? (
          <>
            <p className="text-sm mt-4 leading-relaxed" style={ink}>{preview.message}</p>
            <button type="button" onClick={onClose}
              className="pressable focus-ring mt-5 w-full h-11 rounded-full text-sm font-semibold"
              style={{ border: '1px solid var(--color-border-strong)', color: 'var(--color-text-primary)' }}>
              Close
            </button>
          </>
        ) : (
          <>
            {changed && (
              <p className="text-sm mt-4 p-3 rounded-xl" role="status"
                style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-text-primary)' }}>
                The refund has changed since this opened. Please check the new amounts below.
              </p>
            )}

            {quote ? (
              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold" style={ink}>
                    {role === 'HOST' ? 'The guest gets back' : 'You get back'}
                  </span>
                  <span className="text-xl font-bold" style={ink}>{formatUsd(quote.total)}</span>
                </div>
                <dl className="mt-2 space-y-1 text-sm" style={muted}>
                  <div className="flex justify-between gap-3"><dt>Stay price</dt><dd>{formatUsd(quote.stayRefund)}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Service fee</dt><dd>{formatUsd(quote.serviceFeeRefund)}</dd></div>
                  {(quote.depositRefund > 0) && (
                    <div className="flex justify-between gap-3"><dt>Damage deposit</dt><dd>{formatUsd(quote.depositRefund)}</dd></div>
                  )}
                </dl>
                <div className="flex justify-between gap-3 mt-3 pt-3 text-sm border-t" style={{ borderColor: 'var(--color-border)', ...ink }}>
                  <span>Not refunded</span>
                  <span className="font-semibold">{formatUsd(quote.kept)}</span>
                </div>
                <p className="text-xs mt-1" style={muted}>Out of {formatUsd(preview.paidAmount)} paid.</p>

                {role === 'GUEST' && (
                  <p className="text-sm mt-4" style={ink}>
                    {preview.policyLabel} policy.{' '}
                    {preview.appliesUntil
                      ? `This refund applies if you cancel on or before ${formatStayDate(`${preview.appliesUntil}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`
                      : 'The stay price is no longer refundable for these dates.'}
                  </p>
                )}
                {role === 'HOST' && (
                  <p className="text-sm mt-4" style={ink}>
                    When a host cancels, the guest is refunded everything they paid.
                  </p>
                )}
                <p className="text-xs mt-2" style={muted}>{REFUND_TIMING}</p>
              </div>
            ) : (
              <p className="text-sm mt-4 leading-relaxed" style={ink}>
                {withdrawal
                  ? 'The host has not answered yet. Nothing has been charged, so there is nothing to refund.'
                  : 'Nothing has been charged for this booking, so there is nothing to refund.'}
              </p>
            )}

            {role === 'GUEST' && quote && (
              <details className="mt-4">
                <summary className="text-sm font-semibold cursor-pointer focus-ring rounded" style={ink}>How this policy works</summary>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed" style={muted}>
                  {preview.rules.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </details>
            )}

            {role === 'HOST' && (
              <div className="mt-5 space-y-3">
                <div>
                  <label htmlFor="cancel-reason" className="text-sm font-semibold block mb-1" style={ink}>Reason for cancelling</label>
                  <select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value as HostCancelReason | '')}
                    className="focus-ring w-full h-11 px-3 rounded-xl text-sm"
                    style={{ border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
                    <option value="">Choose a reason</option>
                    {(Object.keys(HOST_CANCEL_REASONS) as HostCancelReason[]).map((key) => (
                      <option key={key} value={key}>{HOST_CANCEL_REASONS[key]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cancel-note" className="text-sm font-semibold block mb-1" style={ink}>Note for our team (optional)</label>
                  <textarea id="cancel-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_CANCEL_NOTE} rows={3}
                    className="focus-ring w-full p-3 rounded-xl text-sm"
                    style={{ border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }} />
                </div>
              </div>
            )}

            {error && <p className="text-sm mt-4" role="alert" style={{ color: '#991B1B' }}>{error}</p>}

            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="pressable focus-ring flex-1 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
                style={{ border: '1px solid var(--color-border-strong)', color: 'var(--color-text-primary)' }}>
                {withdrawal ? 'Keep request' : 'Keep booking'}
              </button>
              <button type="button" onClick={confirm} disabled={busy}
                className="pressable focus-ring flex-1 h-11 rounded-full text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#991B1B', color: '#fff' }}>
                {busy ? 'Cancelling' : withdrawal ? 'Withdraw request' : 'Cancel booking'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

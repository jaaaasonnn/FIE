'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { REPORT_REASONS, reportMailto } from '@/lib/listingReport'

// Fetched on the first tap on the listing page's flag (ShareReport.tsx). A reason, an optional note, and a link that
// opens an email to support with the home filled in. Nothing is stored: a real reports system (a table and an admin
// tab) is still to be built (CLAUDE.md, FINDINGS AS36).
//
// The browser's own modal <dialog> (showModal): the rest of the page is inert, Tab stays inside, Escape closes it. Not
// Radix's dialog, which the listing page also uses (the photo viewer): sharing it with this file made the bundler
// split it into a file of its own, 2 KB more on every listing page. For the same reason this file imports nothing the
// page also uses: the address, the link and the close icon come from ShareReport.tsx or are drawn here.

export function ReportDialog({ open, onOpenChange, id, title, url, to, returnFocus }: {
  open: boolean; onOpenChange: (o: boolean) => void; id: string; title: string
  /** The home's own address, and support's email address */
  url: string; to: string
  /** The flag that opened it, which has the focus again once it closes */
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // A plain link once a reason is chosen: the person's own mail app opens with the report written out
  const mailto = reason ? reportMailto({ to, id, title, url, reason, note }) : null
  const SEND = 'flex items-center justify-center w-full mt-4 py-3 rounded-full text-sm font-bold'
  const SEND_STYLE = { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }
  const close = () => dialog.current?.close()

  return (
    <dialog ref={dialog} aria-labelledby="report-title"
      // Closed by Escape, the close button, the link, or a tap on the dimmed page around it
      onClose={() => { onOpenChange(false); returnFocus.current?.focus() }}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      className="m-auto w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto border-0 bg-white rounded-2xl p-6 shadow-xl backdrop:bg-black/50"
      style={{ color: 'var(--color-text-primary)' }}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <h2 id="report-title" className="text-lg font-bold">Report this listing</h2>
        <button type="button" aria-label="Close" onClick={close}
          className="w-11 h-11 -mt-2 -mr-2 rounded-full flex items-center justify-center hover:bg-stone-100 flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <form onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend className="text-sm font-semibold mb-2">Reason</legend>
          <div className="space-y-1">
            {REPORT_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-3 min-h-11 px-3 rounded-xl border cursor-pointer text-sm"
                style={{ borderColor: reason === r ? 'var(--color-accent)' : 'var(--color-border)' }}>
                <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                {r}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="report-note" className="block text-sm font-semibold mt-4 mb-1.5">
          Note (optional)
        </label>
        <textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000}
          className="focus-ring w-full px-3 py-2 rounded-xl border text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }} />
        {mailto ? (
          <a href={mailto} onClick={close} className={SEND} style={SEND_STYLE}>Email support</a>
        ) : (
          <button type="button" disabled className={`${SEND} opacity-50`} style={SEND_STYLE}>Email support</button>
        )}
      </form>
    </dialog>
  )
}

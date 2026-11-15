'use client'

import { useState, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { SUPPORT_EMAIL } from '@/lib/contact'
import { REPORT_REASONS, reportMailto } from '@/lib/listingReport'
import { listingUrl } from './ShareReport'

// Fetched on the first tap on the listing page's flag (ShareReport.tsx). A reason, an optional note, and a button
// that opens an email to support with the home filled in. Nothing is stored: a real reports system (a table and an
// admin tab) is still to be built (CLAUDE.md).

export function ReportDialog({ open, onOpenChange, id, title, returnFocus }: {
  open: boolean; onOpenChange: (o: boolean) => void; id: string; title: string
  /** The flag that opened it, which has the focus again once it closes */
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  // A plain link once a reason is chosen: the person's own mail app opens with the report written out
  const mailto = reason ? reportMailto({ to: SUPPORT_EMAIL, id, title, url: listingUrl(id), reason, note }) : null
  const SEND = 'flex items-center justify-center w-full mt-4 py-3 rounded-full text-sm font-bold'
  const SEND_STYLE = { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl p-6 shadow-xl"
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus.current?.focus() }}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <Dialog.Title className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Report this listing
            </Dialog.Title>
            <Dialog.Close aria-label="Close" className="w-11 h-11 -mt-2 -mr-2 rounded-full flex items-center justify-center hover:bg-stone-100 flex-shrink-0">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <fieldset>
              <legend className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>Reason</legend>
              <div className="space-y-1">
                {REPORT_REASONS.map((r) => (
                  <label key={r} className="flex items-center gap-3 min-h-11 px-3 rounded-xl border cursor-pointer text-sm"
                    style={{ borderColor: reason === r ? 'var(--color-accent)' : 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                    <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                    {r}
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="report-note" className="block text-sm font-semibold mt-4 mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
              Note (optional)
            </label>
            <textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000}
              className="focus-ring w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }} />
            {mailto ? (
              <a href={mailto} onClick={() => onOpenChange(false)} className={SEND} style={SEND_STYLE}>Email support</a>
            ) : (
              <button type="button" disabled className={`${SEND} opacity-50`} style={SEND_STYLE}>Email support</button>
            )}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

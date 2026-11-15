'use client'

import { useRef, useState } from 'react'
import { Share2, Flag } from 'lucide-react'
import { showToast } from '@/components/ui/Toaster'
import { useOnDemand } from '@/lib/useOnDemand'

// The listing page's Share and Report buttons. Share is a few lines here, not fetched on the tap: the phone's share
// sheet and the clipboard both need the tap itself (Safari refuses them once the page has waited for a download).
// Report's dialog is fetched on the first tap (ReportDialog.tsx), so the page's own script barely grows.

const BUTTON = 'p-2 rounded-full hover:bg-stone-100 transition-all'
const COLOUR = { color: 'var(--color-text-secondary)' }

/** The home's own address, without whatever search or dates are in the address bar */
export function listingUrl(id: string): string {
  return `${window.location.origin}/listings/${encodeURIComponent(id)}`
}

/** Copies through the clipboard, or the older way where the clipboard is not offered (an http address) */
async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* the older way below */ }
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(field)
  field.select()
  let done = false
  try { done = document.execCommand('copy') } catch { done = false }
  field.remove()
  return done
}

export function ShareButton({ id, title }: { id: string; title: string }) {
  const share = () => {
    const url = listingUrl(id)
    // The phone's own share sheet where there is one. Closing it without sharing is not an error.
    if (typeof navigator.share === 'function') { navigator.share({ title, url }).catch(() => {}); return }
    copy(url).then((done) => { if (done) showToast('Link copied', 'success') })
  }
  return (
    <button type="button" aria-label="Share this home" onClick={share} className={BUTTON} style={COLOUR}>
      <Share2 size={18} aria-hidden />
    </button>
  )
}

const loadDialog = () => import('./ReportDialog')

export function ReportButton({ id, title }: { id: string; title: string }) {
  const [wanted, setWanted] = useState(false)
  const [open, setOpen] = useState(false)
  const flag = useRef<HTMLButtonElement>(null)
  const { mod, failed, retry } = useOnDemand(loadDialog, wanted)
  const press = () => { if (failed) retry(); setWanted(true); setOpen(true) }
  const Dialog = mod?.ReportDialog
  return (
    <>
      <button ref={flag} type="button" aria-label="Report this listing" aria-haspopup="dialog" onClick={press}
        onPointerEnter={() => setWanted(true)} onFocus={() => setWanted(true)} className={BUTTON} style={COLOUR}>
        <Flag size={16} aria-hidden />
      </button>
      {Dialog && <Dialog open={open} onOpenChange={setOpen} id={id} title={title} returnFocus={flag} />}
    </>
  )
}

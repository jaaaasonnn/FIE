'use client'

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

// The listing page's full-screen photos, fetched on the first press on a photo (ListingGallery.tsx). The browser's
// own modal <dialog> (showModal): the page behind is inert and Tab stays inside. The photos are a strip that
// scrolls sideways and snaps to each one (CSS scroll-snap, globals.css .photo-viewer-*), so a finger swipes them
// with no script; Escape and the Close button close it, the arrow keys move between photos, and Back closes it
// without leaving the listing: one history entry (#photos), added through Next's own pushState, as the search
// sheet does (public/shell.js). The page behind does not scroll while it is open (globals.css), and nothing stops
// a pinch: the page's own zoom works as anywhere else.
//
// It imports nothing the listing page also uses, so the bundler does not split shared code into a file of its own
// that every listing page would then load (see ReportDialog.tsx): the image addresses and the icons are written
// here.

// Each photo through the site's image optimiser at the screen's width, as next/image asks for them (its default widths,
// next.config.ts sets none of its own). Written here rather than through next/image's getImageProps, which the gallery
// would have to call: that added 0.387 KB to the listing page's first load.
export const WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840]
export const optimised = (src: string, w: number) => `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=75`
const srcSet = (src: string) => WIDTHS.map((w) => `${optimised(src, w)} ${w}w`).join(', ')

const HASH = '#photos'

export function PhotoViewer({ photos, start, title, onClosed }: {
  photos: string[]
  /** The photo it opens at */
  start: number
  title: string
  /** Called once it has closed, however it closed */
  onClosed: () => void
}) {
  const n = photos.length
  const dialog = useRef<HTMLDialogElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const pushed = useRef(false)
  const [at, setAt] = useState(start)

  useLayoutEffect(() => {
    const d = dialog.current
    const s = strip.current
    if (!d || !s) return
    if (!d.open) d.showModal()
    s.scrollLeft = start * s.clientWidth
    // The focus goes to Close (showModal would give it to the strip, which Chromium lets the keyboard reach)
    closeButton.current?.focus({ preventScroll: true })
    if (location.hash !== HASH) {
      history.pushState({ fieghPhotos: true }, '', location.pathname + location.search + HASH)
      pushed.current = true
    }
    // Back (the button, the gesture) takes the entry away: the viewer closes and the listing stays
    const onPop = () => { if (location.hash !== HASH && d.open) { pushed.current = false; d.close() } }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // Opened once, at `start`: the gallery mounts a new viewer for each opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closed = () => {
    // Closed here (Escape, the button): the history entry it added goes too, so Back then leaves the listing as usual
    if (pushed.current) {
      pushed.current = false
      if (location.hash === HASH && history.state?.fieghPhotos) history.back()
    } else if (location.hash === HASH) history.replaceState(history.state, '', location.pathname + location.search)
    onClosed()
  }

  // While a move made by a key or an arrow is on its way, the photo it is heading for counts: the strip's own position
  // passes the photos in between, and a second press must go on from the target, not from where the strip has got to
  const heading = useRef<{ to: number; until: number } | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScroll = () => {
    const s = strip.current
    if (!s) return
    const i = Math.min(n - 1, Math.max(0, Math.round(s.scrollLeft / Math.max(1, s.clientWidth))))
    const h = heading.current
    if (h && i !== h.to && Date.now() < h.until) return
    heading.current = null
    if (i !== at) setAt(i)
  }
  const go = (i: number) => {
    const s = strip.current
    if (!s || i < 0 || i >= n) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    heading.current = { to: i, until: Date.now() + 800 }
    s.scrollTo({ left: i * s.clientWidth, behavior: still ? 'instant' : 'smooth' })
    setAt(i)
    // Once the move is over (or was stopped by a finger), the strip's own position counts again
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => { heading.current = null; onScroll() }, 850)
  }
  useLayoutEffect(() => () => { if (settle.current) clearTimeout(settle.current) }, [])
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1) }
  }

  return (
    <dialog ref={dialog} className="photo-viewer" aria-label={`Photos of ${title}`} onClose={closed} onKeyDown={onKey}>
      {/* The keyboard can reach the strip itself (Tab), and the arrow keys then move it */}
      <div ref={strip} className="photo-viewer-strip" onScroll={onScroll} tabIndex={0} role="region" aria-label="Photos">
        {photos.map((p, i) => (
          <div key={i} className="photo-viewer-slide" role="group" aria-label={`Photo ${i + 1} of ${n}`}>
            {/* The photo shown and the ones beside it at once, the rest as they come near */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={optimised(p, 1920)} srcSet={srcSet(p)} sizes="100vw" alt={i === 0 ? title : ''} draggable={false}
              loading={Math.abs(i - at) <= 1 ? 'eager' : 'lazy'} decoding="async" />
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="photo-viewer-arrow photo-viewer-prev" aria-label="Previous photo" disabled={at === 0} onClick={() => go(at - 1)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button type="button" className="photo-viewer-arrow photo-viewer-next" aria-label="Next photo" disabled={at === n - 1} onClick={() => go(at + 1)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </>
      )}
      <p className="photo-viewer-count" aria-live="polite" aria-atomic="true">
        <span aria-hidden="true">{at + 1} / {n}</span>
        <span className="sr-only">Photo {at + 1} of {n}</span>
      </p>
      {/* Last in the page's order, first to have the focus: drawn above the photos, clear of the notch */}
      <button type="button" className="photo-viewer-close" aria-label="Close photos" ref={closeButton} onClick={() => dialog.current?.close()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </dialog>
  )
}

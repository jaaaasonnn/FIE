'use client'

import { useCallback, useRef, useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useOnDemand } from '@/lib/useOnDemand'

// The listing page's photos (tester-fixes-2). The big photo is a strip that scrolls sideways and snaps to each
// photo (CSS scroll-snap, globals.css .listing-gallery-*), so a finger swipes it with no script; the strip's scroll
// position is the photo shown. A tap or click on a photo, or on a thumbnail, opens the full-screen viewer at that
// photo (PhotoViewer.tsx), whose code is fetched on the first press, so the page's own script barely grows.

const loadViewer = () => import('./PhotoViewer')
const SIZES = '(min-width: 1280px) 1216px, 100vw'

export function ListingGallery({ photos, title }: { photos: string[]; title: string }) {
  const n = photos.length
  const strip = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [at, setAt] = useState(0)
  const [wanted, setWanted] = useState(false)
  // The photo the viewer is open at, or null while it is closed
  const [viewing, setViewing] = useState<number | null>(null)
  const { mod, failed, retry } = useOnDemand(loadViewer, wanted)
  const Viewer = mod?.PhotoViewer

  const onScroll = () => {
    const s = strip.current
    if (!s) return
    const i = Math.min(n - 1, Math.max(0, Math.round(s.scrollLeft / Math.max(1, s.clientWidth))))
    if (i !== at) setAt(i)
  }
  const go = (i: number) => {
    const s = strip.current
    if (!s) return
    s.scrollTo({ left: i * s.clientWidth, behavior: 'instant' })
    setAt(i)
  }
  const want = () => { if (failed) retry(); setWanted(true) }
  const open = (i: number, from: HTMLElement) => { opener.current = from; want(); setViewing(i) }
  const closed = useCallback(() => {
    setViewing(null)
    opener.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <div
        className="listing-gallery relative rounded-2xl overflow-hidden mb-8 aspect-[16/9] sm:aspect-[21/9] bg-stone-200"
        style={{ boxShadow: '0 8px 28px rgba(31, 27, 22, 0.1)' }}
      >
        <div ref={strip} className="listing-gallery-strip" onScroll={onScroll}>
          {photos.map((src, i) => (
            <button key={i} type="button" className="listing-gallery-slide" aria-haspopup="dialog"
              aria-label={`View photo ${i + 1} of ${n} full screen`}
              onPointerDown={want} onClick={(e) => open(i, e.currentTarget)}>
              <Image src={src} alt={i === 0 ? title : ''} fill preload={i === 0} sizes={SIZES} className="object-cover" />
            </button>
          ))}
        </div>
        {n > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => go((at - 1 + n) % n)}
              className="listing-gallery-arrow absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-all"
              style={{ boxShadow: '0 4px 14px rgba(31, 27, 22, 0.12)' }}>
              <ChevronLeft size={20} />
            </button>
            <button type="button" aria-label="Next photo" onClick={() => go((at + 1) % n)}
              className="listing-gallery-arrow absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-all"
              style={{ boxShadow: '0 4px 14px rgba(31, 27, 22, 0.12)' }}>
              <ChevronRight size={20} />
            </button>
          </>
        )}
        <div className="listing-gallery-dots absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
          {photos.map((_, i) => (
            <button key={i} type="button" aria-label={`Show photo ${i + 1} of ${n}`} onClick={() => go(i)}
              className="w-2 h-2 rounded-full transition-all"
              style={{ backgroundColor: i === at ? '#fff' : 'rgba(255,255,255,0.5)' }} />
          ))}
        </div>
        <div className="listing-gallery-count absolute top-4 right-4 px-3 py-1 rounded-full text-xs font-medium"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}>
          {at + 1} / {n}
        </div>
      </div>
      <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
        {photos.map((p, i) => (
          <button key={i} type="button" aria-label={`Photo ${i + 1} of ${n}`} aria-haspopup="dialog"
            aria-current={i === at ? 'true' : undefined}
            onPointerDown={want} onClick={(e) => { go(i); open(i, e.currentTarget) }}
            className="flex-shrink-0 w-20 h-16 rounded-xl overflow-hidden border-2 transition-all"
            style={{ borderColor: i === at ? 'var(--color-accent)' : 'transparent' }}>
            <Image src={p} alt="" width={80} height={64} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {Viewer && viewing !== null && <Viewer photos={photos} start={viewing} title={title} onClosed={closed} />}
    </>
  )
}

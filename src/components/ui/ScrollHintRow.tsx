'use client'

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useScrollAffordance } from '@/hooks/useScrollAffordance'

interface ScrollHintRowProps {
  children: React.ReactNode
  className?: string
  rowClassName?: string
  /** Solid color the edge fade transitions from — should match the row's
   *  actual background, otherwise the fade is invisible (fading to a color
   *  that doesn't match what's behind it). */
  fadeColor: string
  /** When provided, the direct child at this index is scrolled into view
   *  (smoothly) whenever it changes — for rows whose "current" position
   *  moves on its own (e.g. a step indicator), not just static tab strips
   *  the user taps directly. */
  activeIndex?: number
}

// Horizontally-scrollable row (tabs, filter pills, step indicators, …) that
// shows a gold chevron on whichever edge(s) still hide content, since a
// bare overflow-x-auto strip gives no visual hint that it scrolls.
export function ScrollHintRow({ children, className, rowClassName, fadeColor, activeIndex }: ScrollHintRowProps) {
  const { scrollRef, scrollEl, canScrollLeft, canScrollRight } = useScrollAffordance()

  useEffect(() => {
    if (activeIndex == null || !scrollEl) return
    const child = scrollEl.children[activeIndex] as HTMLElement | undefined
    child?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeIndex, scrollEl])

  return (
    <div className={cn('relative', className)}>
      <div ref={scrollRef} className={cn('flex overflow-x-auto', rowClassName)}>
        {children}
      </div>
      {canScrollLeft && (
        <div
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-10 flex items-center justify-start pl-1"
          style={{ background: `linear-gradient(to right, ${fadeColor} 40%, transparent)` }}
        >
          <ChevronLeft size={14} style={{ color: 'var(--gold)' }} />
        </div>
      )}
      {canScrollRight && (
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 flex items-center justify-end pr-1"
          style={{ background: `linear-gradient(to left, ${fadeColor} 40%, transparent)` }}
        >
          <ChevronRight size={14} style={{ color: 'var(--gold)' }} />
        </div>
      )}
    </div>
  )
}

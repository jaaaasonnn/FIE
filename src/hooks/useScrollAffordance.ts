'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Tracks whether a horizontally-scrollable element has more content hidden
 * off its left/right edge, for rendering a "scroll for more" affordance.
 *
 * Takes a callback ref (not useRef) because the scrollable element often
 * doesn't exist on first render — e.g. it's behind an auth/loading gate —
 * and a plain useEffect(..., []) would fire while a useRef's .current was
 * still null and never re-run once the element actually mounted.
 */
export function useScrollAffordance() {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const update = useCallback(() => {
    const el = scrollEl
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [scrollEl])

  useEffect(() => {
    const el = scrollEl
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [scrollEl, update])

  return { scrollRef: setScrollEl, scrollEl, canScrollLeft, canScrollRight, updateScrollAffordance: update }
}

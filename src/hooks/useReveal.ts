'use client'

import { useEffect, useRef } from 'react'

/**
 * Scroll-reveal for landing-page sections. Attach the returned ref to a
 * section; children with `.reveal-item` (stagger via `--i`) or `.reveal-line`
 * animate in when it scrolls into view. The motion itself lives in
 * globals.css behind `prefers-reduced-motion: no-preference`.
 *
 * Content is visible in the server render and only hidden once this runs,
 * and only for sections that start below the fold, so nothing on screen
 * flashes out, and if JS never runs everything simply stays visible.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || el.getBoundingClientRect().top < window.innerHeight) return

    el.dataset.reveal = 'pending'
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.reveal = 'done'
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}

'use client'

import { useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, kept up to date as the window changes. False while the page is drawn on the
 * server and on the first draw in the browser, so both agree; the real answer follows straight after.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

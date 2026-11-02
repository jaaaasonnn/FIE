'use client'

import { useSyncExternalStore } from 'react'

const never = () => () => {}

/**
 * False while a page is drawn on the server and on its first draw in the browser, true straight after.
 * For what only the browser can know, such as its time zone: the server's draw and the first one in the
 * browser must be the same, or React throws the browser's away (a hydration mismatch).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false)
}

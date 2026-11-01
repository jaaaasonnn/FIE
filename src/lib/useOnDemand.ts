'use client'

import { useCallback, useEffect, useState } from 'react'

// Code a page loads only when it is needed (the map, the date picker), so a phone does not pay for it on
// every visit. If the file does not arrive (a dropped connection on mobile data; the chunk guard has already
// asked for it again), the caller shows "Try again" in its place, never a box that stays blank (G6).

const loaded = new Map<() => Promise<unknown>, unknown>()

/**
 * Starts `load` once `wanted` is true and gives back what it loaded. A module loaded once stays loaded for
 * the rest of the visit. `retry` starts it again after a failure.
 */
export function useOnDemand<T>(load: () => Promise<T>, wanted: boolean): { mod: T | null; failed: boolean; retry: () => void } {
  const [mod, setMod] = useState<T | null>(() => (loaded.get(load) as T | undefined) ?? null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!wanted || mod) return
    let active = true
    load().then(
      (m) => { loaded.set(load, m); if (active) setMod(() => m) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [load, wanted, mod, attempt])

  const retry = useCallback(() => { setFailed(false); setAttempt((n) => n + 1) }, [])
  return { mod, failed, retry }
}

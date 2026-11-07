'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { fetchRetry } from '@/lib/clientFetch'

// Which homes the signed-in person has saved, for the hearts on a page of cards (app shell, stage 2). The
// cards are drawn on the server, in a page kept for everyone, so a heart starts unfilled and is filled here
// once the browser knows who is signed in. One answer per page: the first heart on a page asks
// GET /api/wishlists?only=ids, the others share it, and when the last heart leaves (the person goes to
// another page) the answer is dropped, so the next page asks again. A tap changes the shared answer at once
// and puts it back if the server refuses.

type State = { userId: string | null; ids: ReadonlySet<string>; busy: ReadonlySet<string> }

const EMPTY: ReadonlySet<string> = new Set()
let state: State = { userId: null, ids: EMPTY, busy: EMPTY }
let loading: { userId: string; promise: Promise<void> } | null = null
let mounted = 0
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

const SERVER_STATE: State = { userId: null, ids: EMPTY, busy: EMPTY }

function load(userId: string) {
  if (state.userId === userId || loading?.userId === userId) return
  const promise = fetchRetry('/api/wishlists?only=ids')
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { ids?: unknown } | null) => {
      if (loading?.userId !== userId) return
      const ids = Array.isArray(data?.ids) ? data.ids.filter((v): v is string => typeof v === 'string') : []
      set({ userId, ids: new Set(ids) })
    })
    .catch(() => { /* hearts stay as drawn; a tap still works */ })
    .finally(() => { if (loading?.userId === userId) loading = null })
  loading = { userId, promise }
}

/** The saved state for one heart. `userId` is the signed-in person's, or null. */
export function useWishlist(userId: string | null) {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE)

  useEffect(() => {
    mounted++
    return () => {
      mounted--
      // The last heart on the page has gone: the next page asks again
      if (mounted === 0) queueMicrotask(() => { if (mounted === 0) { loading = null; state = { userId: null, ids: EMPTY, busy: EMPTY } } })
    }
  }, [])

  useEffect(() => {
    if (userId) load(userId)
  }, [userId])

  const loaded = !!userId && s.userId === userId
  return { ids: loaded ? s.ids : EMPTY, busy: s.busy, loaded }
}

// ── A save asked for while signed out (app shell stage 3) ───────────────────────────────────────────────────
// A heart pressed by someone signed out sends them to log in and back. The home it was for is kept in this tab's
// sessionStorage (never the address, so a link cannot save anything for anyone), for 10 minutes, and saved once
// when that home's heart is on the page again and the person's saved homes are known. Only its id is kept.
const PENDING_KEY = 'fiegh-save-after-login'
const PENDING_MS = 10 * 60 * 1000

/** Keeps the home a signed-out person asked to save */
export function rememberSave(listingId: string) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: listingId, at: Date.now() })) } catch { /* no storage: nothing is saved later */ }
}

/** Whether a save waits for this home; if so it is used up. A save past its 10 minutes, or unreadable, is dropped. */
export function takeSave(listingId: string): boolean {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return false
    const p = JSON.parse(raw) as { id?: unknown; at?: unknown } | null
    const age = typeof p?.at === 'number' ? Date.now() - p.at : NaN
    if (typeof p?.id !== 'string' || !(age >= 0 && age <= PENDING_MS)) { sessionStorage.removeItem(PENDING_KEY); return false }
    if (p.id !== listingId) return false
    sessionStorage.removeItem(PENDING_KEY)
    return true
  } catch {
    return false
  }
}

/** Saves or unsaves a home for the signed-in person. Resolves to whether it is saved now. */
export async function toggleSaved(userId: string, listingId: string): Promise<boolean> {
  if (state.busy.has(listingId)) return state.ids.has(listingId)
  const was = state.userId === userId && state.ids.has(listingId)
  const flip = (on: boolean) => {
    const ids = new Set(state.userId === userId ? state.ids : EMPTY)
    if (on) ids.add(listingId)
    else ids.delete(listingId)
    return ids
  }
  set({ userId, ids: flip(!was), busy: new Set([...state.busy, listingId]) })
  let now = was
  try {
    const res = await fetch('/api/wishlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId }),
    })
    const data = res.ok ? await res.json() : null
    now = typeof data?.wishlisted === 'boolean' ? data.wishlisted : was
  } catch {
    now = was
  }
  const busy = new Set(state.busy)
  busy.delete(listingId)
  set({ userId, ids: flip(now), busy })
  return now
}

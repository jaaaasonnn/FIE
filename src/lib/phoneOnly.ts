'use client'

import { useSyncExternalStore } from 'react'

// Code a phone needs and a wider screen never does (AS8, app shell stage 3). The server draws a phone's parts into
// every page, as before, and CSS shows them below 768 px; in the browser their code is asked for only at a phone's
// width. On a wider screen the parts stay as the server drew them (hidden) and their code is never downloaded,
// unless the window is narrowed to a phone's width, when it is fetched then.

export const PHONE_QUERY = '(max-width: 767px)'

/**
 * A phone's module, for a page to draw its parts with. At a phone's width it is fetched at once; at a wider width
 * when the window first becomes a phone's width (never, if it does not). `serverModule` is the server's own copy
 * (null in the browser): the server always draws the parts.
 */
export function phoneModule<M>(load: () => Promise<M>, serverModule: M | null) {
  let loaded: M | null = null
  let started = false
  const listeners = new Set<() => void>()

  function start() {
    if (started) return
    started = true
    load().then((m) => { loaded = m; for (const l of listeners) l() }, () => { started = false })
  }
  if (typeof window !== 'undefined') {
    const list = window.matchMedia(PHONE_QUERY)
    if (list.matches) start()
    else {
      const onChange = () => { if (list.matches) { list.removeEventListener('change', onChange); start() } }
      list.addEventListener('change', onChange)
    }
  }

  const subscribe = (onChange: () => void) => { listeners.add(onChange); return () => { listeners.delete(onChange) } }
  /** The module once it has come; null until then, on the browser's first draw (which must match the server's
   * HTML: the part is then kept as the server drew it), and always on a wider screen. */
  return function usePhoneModule(): M | null {
    return useSyncExternalStore(subscribe, () => loaded, () => serverModule)
  }
}

/**
 * A part kept as the server drew it: the same element, its children left to the server's HTML. React does not
 * draw into an element whose content it was given as HTML, so nothing is replaced or checked.
 */
export const KEEP_SERVER_HTML = { __html: '' } as const

// G6: a page whose JavaScript did not arrive (a dropped connection on mobile
// data) never becomes usable. Nothing in the app can notice, because the app
// is that JavaScript. This small script goes in the page's <head>, before
// any of it, and watches for one of the app's own script files failing to
// load. It asks for that file again, at most twice, a little later each time,
// and adds it to the page once it has arrived; if it still does not arrive it
// shows a plain message with a Try again button instead of a page that spins
// for ever.
//
// Why not reload the page: Safari keeps a failed file and does not ask for it
// again on a reload, so the page would fail the same way each time. Asking
// for the file with `cache: 'reload'` replaces what the browser kept, and the
// file is then added under its own address, which the app's loader needs.
//
// Plain JavaScript in a string: it must run before anything else is loaded.

import { LOAD_FAILED } from '@/lib/clientFetch'

/** Waits before each new try of a file: two tries after the first failure. */
export const CHUNK_RETRY_DELAYS_MS = [500, 1500]

/** The guard itself. Kept as a function so it can be tested; sent to the page as its source text. */
export function chunkGuard(w: Window, message: string, delays: number[]) {
  const d = w.document
  let box: HTMLElement | null = null
  // Files that did not arrive after their tries, for the Try again button
  const gaveUp: string[] = []
  const tried: Record<string, boolean> = {}

  const hide = () => {
    if (box && box.parentNode) box.parentNode.removeChild(box)
    box = null
  }
  const show = () => {
    if (box) return
    const draw = () => {
      if (box) return
      box = d.createElement('div')
      box.setAttribute('role', 'alert')
      box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:#FAF7F2;font-family:system-ui,sans-serif')
      const inner = d.createElement('div')
      inner.setAttribute('style', 'max-width:420px;text-align:center;color:#1F1B16;font-size:16px;line-height:1.5')
      const text = d.createElement('p')
      text.textContent = message
      const button = d.createElement('button')
      button.type = 'button'
      button.textContent = 'Try again'
      button.setAttribute('style', 'margin-top:16px;padding:12px 24px;border:0;border-radius:12px;background:#C9932E;color:#1F1B16;font-size:16px;font-weight:600;cursor:pointer')
      button.addEventListener('click', () => {
        hide()
        for (const src of gaveUp.splice(0)) attempt(src, 0, [0])
      })
      inner.appendChild(text)
      inner.appendChild(button)
      box.appendChild(inner)
      d.body.appendChild(box)
    }
    if (d.body) draw()
    else d.addEventListener('DOMContentLoaded', draw)
  }

  // One more try of a file: ask for it afresh, then add it to the page under its own address
  const attempt = (src: string, n: number, waits: number[]) => {
    if (n >= waits.length) {
      gaveUp.push(src)
      show()
      return
    }
    w.setTimeout(() => {
      const again = () => attempt(src, n + 1, waits)
      w.fetch(src, { cache: 'reload', credentials: 'same-origin' }).then((res) => {
        if (!res.ok) return again()
        const script = d.createElement('script')
        script.src = src
        script.async = true
        script.setAttribute('data-retried', '1')
        script.addEventListener('error', again)
        d.head.appendChild(script)
      }, again)
    }, waits[n])
  }

  // The app's own files, each once here: a retried copy that fails is handled by its own try
  const appFile = (target: HTMLScriptElement | null) => {
    if (!target || target.tagName !== 'SCRIPT' || target.getAttribute('data-retried')) return ''
    const src = target.getAttribute('src') || ''
    return src.indexOf('/_next/static/') >= 0 ? src : ''
  }
  const arrived: Record<string, boolean> = {}
  const retry = (src: string) => {
    if (tried[src]) return
    tried[src] = true
    attempt(src, 0, delays)
  }
  w.addEventListener('error', (event: Event) => {
    const src = appFile(event.target as HTMLScriptElement | null)
    if (src) retry(src)
  }, true)
  w.addEventListener('load', (event: Event) => {
    const src = appFile(event.target as HTMLScriptElement | null)
    if (src) arrived[src] = true
  }, true)

  // A file can fail before this script runs: the page's own script tags come above it, and Firefox holds an
  // inline script until the stylesheets above it have loaded. Only those files, the ones already on the page
  // now, can have failed unseen; a file the app adds later is watched by the listeners above, and may still be
  // on its way when the page's load event comes. Once the page has loaded, each of those early files not seen
  // to arrive is looked up in the browser's record of what it downloaded; one with nothing in it never
  // arrived. Without that record nothing is assumed.
  const early = Array.prototype.slice.call(d.querySelectorAll('script[src]')) as HTMLScriptElement[]
  w.addEventListener('load', () => {
    const perf = w.performance
    if (!perf || typeof perf.getEntriesByName !== 'function') return
    for (let i = 0; i < early.length; i++) {
      const script = early[i]
      const src = appFile(script)
      if (!src || arrived[src] || tried[src]) continue
      const got = perf.getEntriesByName(script.src).some((e) => {
        const r = e as PerformanceResourceTiming
        return r.responseEnd > 0 && (r.decodedBodySize > 0 || r.transferSize > 0)
      })
      if (!got) retry(src)
    }
  })
}

export const CHUNK_GUARD_SCRIPT = `(${chunkGuard.toString()})(window, ${JSON.stringify(LOAD_FAILED)}, ${JSON.stringify(CHUNK_RETRY_DELAYS_MS)})`

import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { CHUNK_GUARD_SCRIPT, CHUNK_RETRY_DELAYS_MS, chunkGuard } from '@/lib/chunkGuard'
import { LOAD_FAILED } from '@/lib/clientFetch'

// G6: one of the app's script files not arriving must not leave the page stuck for ever.

type Listener = (event: { target: unknown }) => void
type El = {
  tagName: string; type: string; textContent: string; src: string; async: boolean; attrs: Record<string, string>; children: El[]
  parentNode: El | null; listeners: Record<string, (() => void)[]>
  setAttribute(k: string, v: string): void; getAttribute(k: string): string | null; appendChild(c: El): void; removeChild(c: El): void
  addEventListener(t: string, fn: () => void): void; fire(t: string): void
}

/** Just enough of a browser for the guard: events, fetch, timers, a head and a body. */
function browser(answers: boolean[], pageScripts: { tagName: string; src: string; getAttribute(k: string): string | null }[] = [], downloaded: Record<string, { responseEnd: number; decodedBodySize: number; transferSize: number }[]> = {}) {
  const listeners: Record<string, Listener[]> = {}
  const timers: { fn: () => void; ms: number }[] = []
  const fetched: { src: string; cache?: string }[] = []
  const element = (tagName = ''): El => {
    const el: El = {
      tagName: tagName.toUpperCase(), type: '', textContent: '', src: '', async: false, attrs: {}, children: [], parentNode: null, listeners: {},
      setAttribute(k, v) { el.attrs[k] = v }, getAttribute(k) { return k === 'src' ? el.src || el.attrs.src || null : el.attrs[k] ?? null },
      appendChild(c) { c.parentNode = el; el.children.push(c) }, removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null },
      addEventListener(t, fn) { (el.listeners[t] ??= []).push(fn) }, fire(t) { for (const fn of el.listeners[t] ?? []) fn() },
    }
    return el
  }
  const head = element('head')
  const body = element('body')
  const w = {
    head, body, fetched, timers,
    document: { head, body, createElement: element, addEventListener: () => {}, querySelectorAll: () => pageScripts },
    performance: { getEntriesByName: (name: string) => downloaded[name] ?? [] },
    addEventListener: (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn) },
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }) },
    fetch: (src: string, init?: { cache?: string }) => {
      fetched.push({ src, cache: init?.cache })
      const ok = answers.shift() ?? false
      return ok ? Promise.resolve({ ok: true }) : Promise.reject(new TypeError('Failed to fetch'))
    },
    fire(type: string, target: unknown) { for (const fn of [...(listeners[type] ?? [])]) fn({ target }) },
    /** Runs the waiting timers and lets the fetches they start settle. */
    async settle() {
      for (let round = 0; round < 10 && timers.length; round++) {
        timers.shift()!.fn()
        await new Promise((r) => setTimeout(r, 0))
      }
    },
    /** The copies the guard added to the page. */
    retried: () => head.children.filter((c) => c.tagName === 'SCRIPT'),
    shown: () => body.children,
  }
  return w
}

const appScript = (src = '/_next/static/chunks/abc.js') => ({ tagName: 'SCRIPT', getAttribute: (k: string) => (k === 'src' ? src : null) })

const start = (answers: boolean[], ...rest: Parameters<typeof browser> extends [unknown, ...infer R] ? R : never) => {
  const w = browser(answers, ...rest)
  chunkGuard(w as unknown as Window, LOAD_FAILED, CHUNK_RETRY_DELAYS_MS)
  return w
}

describe('a script file that does not arrive', () => {
  it('is asked for again, afresh, and added to the page under its own address', async () => {
    const w = start([true])
    w.fire('error', appScript())
    await w.settle()
    expect(w.fetched).toEqual([{ src: '/_next/static/chunks/abc.js', cache: 'reload' }])
    expect(w.retried().map((s) => s.src)).toEqual(['/_next/static/chunks/abc.js'])
    expect(w.shown()).toHaveLength(0)
  })

  it('is tried twice at most, a little later each time, then the page says so with a Try again button', async () => {
    const w = start([false, false])
    w.fire('error', appScript())
    expect(w.timers.map((t) => t.ms)).toEqual([500])
    await w.settle()
    expect(w.fetched).toHaveLength(2)
    expect(w.retried()).toHaveLength(0)
    expect(w.shown()).toHaveLength(1)
    const text = JSON.stringify(w.shown()[0], (k, v) => (k === 'parentNode' ? undefined : v))
    expect(text).toContain(LOAD_FAILED)
    expect(text).toContain('Try again')
  })

  it('a copy that is fetched but then fails to run counts as a failed try', async () => {
    const w = start([true, true])
    w.fire('error', appScript())
    await w.settle()
    w.retried()[0].fire('error')
    await w.settle()
    expect(w.fetched).toHaveLength(2)
    expect(w.retried()).toHaveLength(2)
  })

  it('Try again takes the message away and asks for the file once more', async () => {
    const w = start([false, false, true])
    w.fire('error', appScript())
    await w.settle()
    const button = w.shown()[0].children[0].children[1]
    button.fire('click')
    expect(w.shown()).toHaveLength(0)
    await w.settle()
    expect(w.fetched).toHaveLength(3)
    expect(w.retried()).toHaveLength(1)
  })

  it('ignores files that are not the app’s own, anything that is not a script, and its own copies', async () => {
    const w = start([])
    w.fire('error', appScript('https://example.com/widget.js'))
    w.fire('error', { tagName: 'IMG', getAttribute: () => '/_next/static/media/a.png' })
    w.fire('error', null)
    w.fire('error', { tagName: 'SCRIPT', getAttribute: (k: string) => (k === 'src' ? '/_next/static/chunks/abc.js' : '1') })
    await w.settle()
    expect(w.fetched).toHaveLength(0)
    expect(w.shown()).toHaveLength(0)
  })

  it('a file that failed before the guard started is noticed when the page has loaded, and asked for again', async () => {
    const tag = (src: string) => ({ tagName: 'SCRIPT', src: `https://fiegh.com${src}`, getAttribute: (k: string) => (k === 'src' ? src : null) })
    const failedEarly = tag('/_next/static/chunks/early.js')
    const fine = tag('/_next/static/chunks/fine.js')
    const seenLoading = tag('/_next/static/chunks/seen.js')
    const w = start([true], [failedEarly, fine, seenLoading], {
      'https://fiegh.com/_next/static/chunks/fine.js': [{ responseEnd: 120, decodedBodySize: 5000, transferSize: 0 }],
    })
    w.fire('load', seenLoading)
    w.fire('load', null)
    await w.settle()
    expect(w.fetched).toEqual([{ src: '/_next/static/chunks/early.js', cache: 'reload' }])
    expect(w.retried().map((s) => s.src)).toEqual(['/_next/static/chunks/early.js'])
  })

  it('a file the app adds later, still on its way when the page has loaded, is left alone', async () => {
    const pageScripts: { tagName: string; src: string; getAttribute(k: string): string | null }[] = []
    const w = start([true], pageScripts, {})
    // Added by the app after the guard started; the browser has no record of it yet
    pageScripts.push({ tagName: 'SCRIPT', src: 'https://fiegh.com/_next/static/chunks/late.js', getAttribute: (k: string) => (k === 'src' ? '/_next/static/chunks/late.js' : null) })
    w.fire('load', null)
    await w.settle()
    expect(w.fetched).toHaveLength(0)
    expect(w.retried()).toHaveLength(0)
  })

  it('is put in the page as a module, so the page is not held at it until the stylesheets have loaded', () => {
    // A plain inline script after the stylesheets made search, a listing and checkout 0.4-0.5 s slower on slow 4G
    const layout = fs.readFileSync(path.resolve(__dirname, '../app/layout.tsx'), 'utf8')
    expect(layout).toContain('<script type="module" dangerouslySetInnerHTML={{ __html: CHUNK_GUARD_SCRIPT }} />')
  })

  it('is sent to the page as runnable text with the message in it', () => {
    expect(() => new Function(CHUNK_GUARD_SCRIPT)).not.toThrow()
    expect(CHUNK_GUARD_SCRIPT).toContain(JSON.stringify(LOAD_FAILED))
  })
})

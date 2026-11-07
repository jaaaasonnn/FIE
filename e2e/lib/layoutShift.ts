import type { BrowserContext, Page } from '@playwright/test'

// Layout shift as Chromium reports it (PerformanceObserver, "layout-shift"); a shift right after someone's input is
// not counted, as the browser's own Cumulative Layout Shift does not count it. Used by tests/perf/layout-shift.spec.ts
// and, in the installed app, by tests/journeys/installed-app.spec.ts (stage 4).

/** Records every shift on every page the page or context opens, from its first paint */
export async function recordShifts(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    const record = { total: 0, worst: [] as string[] }
    ;(window as unknown as { __shift: typeof record }).__shift = record
    new PerformanceObserver((list) => {
      type Rect = { y: number; height: number }
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node; previousRect: Rect; currentRect: Rect }[] })[]) {
        if (entry.hadRecentInput) continue
        record.total += entry.value
        for (const source of entry.sources ?? []) {
          const node = source.node as Element | undefined
          // What moved, when, and from where to where (top and height, px)
          record.worst.push(`${entry.value.toFixed(4)} at ${Math.round(entry.startTime)} ms ${node?.nodeName ?? '?'}.${String(node && 'className' in node ? node.className : '').slice(0, 50)} ${Math.round(source.previousRect.y)}/${Math.round(source.previousRect.height)} -> ${Math.round(source.currentRect.y)}/${Math.round(source.currentRect.height)}`)
        }
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

/** Opens `url` and gives the shift it had by three seconds after loading */
export async function shiftOf(page: Page, url: string) {
  // (the message inbox asks for new messages every few seconds, so a page is never idle: wait for it to
  // load, then three seconds more)
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(3000)
  return page.evaluate(() => (window as unknown as { __shift: { total: number; worst: string[] } }).__shift)
}

import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// The bottom bar's tab placeholders (public/bar.js, PLACEHOLDERS): plain HTML drawn on a phone while a tapped
// tab's page is on its way. They use the pages' own classes and nothing else, so they draw in the pages' shape and
// add no CSS of their own: Tailwind also reads public/, and a class written only there would be a new rule in
// every page's stylesheet, desktop's too.

const ROOT = path.resolve(__dirname, '..', '..')
const bar = fs.readFileSync(path.join(ROOT, 'public', 'bar.js'), 'utf8')
const placeholders = bar.slice(bar.indexOf('function ph('), bar.indexOf('var going = null'))

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.(tsx|ts|css)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : []
  })
}
const src = sourceFiles(path.join(ROOT, 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n')

describe('the tab placeholders in public/bar.js', () => {
  it('are there, one for each tab', () => {
    expect(placeholders.length).toBeGreaterThan(500)
    for (const tab of ['explore', 'trips', 'wishlists', 'messages', 'profile']) expect(placeholders).toContain(`${tab}: '`)
  })

  it('use only classes the app already uses (no new CSS from public/)', () => {
    const classes = new Set<string>()
    for (const m of placeholders.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (/^[\w:./-]+$/.test(c)) classes.add(c)
    for (const m of placeholders.matchAll(/ph\('([^']*)'/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c)
    expect(classes.size).toBeGreaterThan(30)
    const missing = [...classes].filter((c) => !new RegExp(`(^|[\\s"'\`.])${c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=[\\s"'\`{,:]|$)`, 'm').test(src))
    expect(missing).toEqual([])
  })
})

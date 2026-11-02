// G5 (mobile speed): a before/after table per page against the budgets, from two measured steps
// (e2e/load/measure-g5.sh). Written to e2e/load/results/g5-<after>.md, which is kept in git, and printed.
//   node e2e/load/compare-g5.mjs <before> <after>      e.g. msbefore after5
//
// Mobile is Lighthouse's default (simulated slow 4G, CPU 4x); each figure is the median of 5 runs.
// "JS, first load" is the bundle guard's count (tests/perf/bundle.spec.ts): the page's own scripts,
// compressed, with the router's prefetching of linked pages left out; on desktop search, before the map.
// "JS, Lighthouse" is every script Lighthouse saw until the network went quiet, prefetches included, as
// Stage B reported it.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const reports = path.join(here, '..', '.reports')
const [before, after] = process.argv.slice(2)
if (!before || !after) throw new Error('usage: compare-g5.mjs <before> <after>')

const BUDGET = { lcp: 2500, cls: 0.1, tbt: 200, js: 350, searchWithMap: 650 }
const PAGES = [['home', 'home'], ['search with map', 'search'], ['listing', 'listing'], ['checkout', 'checkout'], ['guest dashboard', 'guest dashboard'], ['host dashboard', 'host dashboard'], ['admin', 'admin']]

const lighthouse = (label, data) => {
  const file = path.join(reports, 'stageB', `lighthouse-ms${label.replace(/^ms/, '')}-${data}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).results : null
}
const bundle = (label, size) => {
  const file = path.join(reports, 'mobile-speed', label.replace(/^ms/, ''), `bundle-${size}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}
const pick = (results, page, form) => results?.find((r) => r.page === page && r.formFactor === form)?.median ?? null

const s = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`)
const mark = (ok) => (ok ? '' : ' **over**')
const row = (label) => {
  const out = {}
  for (const data of ['empty', 'seeded']) out[data] = lighthouse(label, data)
  out.phone = bundle(label, 'phone')
  out.desktop = bundle(label, 'desktop')
  return out
}
const B = row(before)
const A = row(after)

const lines = [
  `# G5: ${before} → ${after}`,
  '',
  `Mobile: Lighthouse 12.8.2, simulated slow 4G and a CPU 4x slower, median of 5 runs. Budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, JS on first load ≤ ${BUDGET.js} KB (desktop search with its map ≤ ${BUDGET.searchWithMap} KB). Each cell is before → after.`,
  '',
  '| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |',
  '|---|---|---|---|---|---|---|---|',
]
for (const [lhName, bName] of PAGES) {
  const cell = (side, data, key) => pick(side[data], lhName, 'mobile')?.[key]
  const worst = (side, key) => Math.max(...['empty', 'seeded'].map((d) => cell(side, d, key) ?? -Infinity))
  const lcp = (data) => `${s(cell(B, data, 'lcp'))} → ${s(cell(A, data, 'lcp'))}${mark((cell(A, data, 'lcp') ?? 0) <= BUDGET.lcp)}`
  const cls = `${worst(B, 'cls').toFixed(3)} → ${worst(A, 'cls').toFixed(3)}${mark(worst(A, 'cls') <= BUDGET.cls)}`
  const tbt = `${Math.round(worst(B, 'tbt'))} → ${Math.round(worst(A, 'tbt'))} ms${mark(worst(A, 'tbt') <= BUDGET.tbt)}`
  const own = (side, size) => side[size]?.[bName]
  const phone = (side) => own(side, 'phone')?.totalKB
  const js = `${phone(B) ?? '–'} → ${phone(A) ?? '–'} KB${mark((phone(A) ?? 0) <= BUDGET.js)}`
  const lhJs = `${Math.round(cell(B, 'seeded', 'jsKB') ?? NaN)} → ${Math.round(cell(A, 'seeded', 'jsKB') ?? NaN)} KB`
  const desk = (side) => pick(side.seeded, lhName, 'desktop')?.lcp
  let name = lhName
  if (bName === 'search') {
    const d = own(A, 'desktop')
    if (d) name += ` (desktop: ${d.totalKB - d.mapKB} KB, ${d.totalKB} KB with the map${mark(d.totalKB <= BUDGET.searchWithMap)})`
  }
  lines.push(`| ${name} | ${lcp('empty')} | ${lcp('seeded')} | ${cls} | ${tbt} | ${js} | ${lhJs} | ${s(desk(B))} → ${s(desk(A))} |`)
}
const text = lines.join('\n') + '\n'
fs.mkdirSync(path.join(here, 'results'), { recursive: true })
fs.writeFileSync(path.join(here, 'results', `g5-${after}.md`), text)
console.log(text)

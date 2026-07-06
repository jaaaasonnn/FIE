/**
 * Bulk color token migration.
 * Replaces old inline-style color values with new design tokens.
 * Skips: node_modules, .next, scripts, public
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

// ── Inline-style value replacements (order matters — more specific first) ──
const STYLE_REPLACEMENTS = [
  // ── Backgrounds: cream/off-white → --color-bg ──────────────────────────
  [/backgroundColor:\s*'var\(--cream\)'/g,       "backgroundColor: 'var(--color-bg)'"],
  [/backgroundColor:\s*'#FAF7F2'/g,              "backgroundColor: 'var(--color-bg)'"],

  // ── Text: brown-dark on light sections → --color-text-primary ──────────
  // Only replace `color:` (not `backgroundColor:`) references to brown-dark
  [/(?<![a-zA-Z])color:\s*'var\(--brown-dark\)'/g, "color: 'var(--color-text-primary)'"],
  [/(?<![a-zA-Z])color:\s*'#1A1208'/g,             "color: 'var(--color-text-primary)'"],
  [/(?<![a-zA-Z])color:\s*'#1F1B16'/g,             "color: 'var(--color-text-primary)'"],

  // ── Accent: gold/amber text → --color-accent ───────────────────────────
  [/(?<![a-zA-Z])color:\s*'var\(--gold\)'/g,    "color: 'var(--color-accent)'"],
  [/(?<![a-zA-Z])color:\s*'var\(--amber\)'/g,   "color: 'var(--color-accent)'"],
  [/(?<![a-zA-Z])color:\s*'var\(--gold-light\)'/g, "color: 'var(--color-accent-subtle)'"],
  [/(?<![a-zA-Z])color:\s*'#F5C06A'/g,          "color: 'var(--color-accent)'"],
  [/(?<![a-zA-Z])color:\s*'#F0B84E'/g,          "color: 'var(--color-accent)'"],
  [/(?<![a-zA-Z])color:\s*'#C8873F'/g,          "color: 'var(--color-accent)'"],

  // ── Accent: gold/amber backgrounds → --color-accent ───────────────────
  [/backgroundColor:\s*'var\(--gold\)'/g,        "backgroundColor: 'var(--color-accent)'"],
  [/backgroundColor:\s*'var\(--amber\)'/g,       "backgroundColor: 'var(--color-accent)'"],
  [/backgroundColor:\s*'#F5C06A'/g,              "backgroundColor: 'var(--color-accent)'"],
  [/backgroundColor:\s*'#F0B84E'/g,              "backgroundColor: 'var(--color-accent)'"],
  [/backgroundColor:\s*'#C8873F'/g,              "backgroundColor: 'var(--color-accent)'"],

  // ── Accent: gold/amber borders → --color-border or --color-accent ──────
  [/borderColor:\s*'var\(--gold\)'/g,            "borderColor: 'var(--color-accent)'"],
  [/borderColor:\s*'var\(--amber\)'/g,           "borderColor: 'var(--color-accent)'"],
]

// ── Tailwind class replacements ─────────────────────────────────────────
const TAILWIND_REPLACEMENTS = [
  // bg-white page backgrounds → bg-[--color-bg] (cards stay white)
  // We only touch section-level bg-white that isn't a card wrapper
  // (conservative: only replace className="...bg-white..." on <section> tags)
  [/(<section[^>]*className="[^"]*)\bbg-white\b([^"]*")/g, '$1bg-[var(--color-bg)]$2'],
  // amber utility classes → accent equivalents
  [/\bbg-amber-600\b/g, 'bg-[#C9932E]'],
  [/\bbg-amber-700\b/g, 'bg-[#B37F22]'],
  [/\btext-amber-800\b/g, 'text-[#8A5E10]'],
  [/\btext-amber-600\b/g, 'text-[#C9932E]'],
  [/\btext-amber-300\b/g, 'text-[#E8BA6E]'],
  [/\bborder-amber-200\b/g, 'border-[#E5D0A8]'],
  [/\bbg-amber-100\b/g, 'bg-[#F5ECD6]'],
  [/\bbg-amber-50\b/g, 'bg-[#FAF5EC]'],
  [/\btext-amber-900\b/g, 'text-[#6B3D0E]'],
  [/\bfocus:ring-amber-[0-9]+\b/g, 'focus:ring-[#C9932E]/40'],
  [/\btext-stone-500\b/g, 'text-[#6B645C]'],
  [/\btext-stone-600\b/g, 'text-[#6B645C]'],
  [/\btext-stone-700\b/g, 'text-[#4A4540]'],
]

function walk(dir) {
  const skip = new Set(['node_modules', '.next', 'scripts', 'public', '.git'])
  const results = []
  for (const f of readdirSync(dir)) {
    if (skip.has(f)) continue
    const full = join(dir, f)
    if (statSync(full).isDirectory()) {
      results.push(...walk(full))
    } else if (['.tsx', '.ts', '.css'].includes(extname(f))) {
      results.push(full)
    }
  }
  return results
}

let changed = 0
for (const file of walk('src')) {
  let content = readFileSync(file, 'utf8')
  let next = content

  for (const [pat, rep] of STYLE_REPLACEMENTS) next = next.replace(pat, rep)
  for (const [pat, rep] of TAILWIND_REPLACEMENTS) next = next.replace(pat, rep)

  if (next !== content) {
    writeFileSync(file, next)
    console.log('updated:', file.replace(process.cwd() + '/', ''))
    changed++
  }
}
console.log(`\nDone. ${changed} files updated.`)

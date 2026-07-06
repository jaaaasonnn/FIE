import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const PATTERNS = [
  // inline style prop patterns — remove the fontFamily key-value pair cleanly
  /,?\s*fontFamily:\s*['"](?:Playfair Display,\s*serif|DM Sans,\s*sans-serif)['"],?/g,
  // CSS string inside Toaster
  /\s*font-family:'DM Sans',sans-serif;/g,
  /\s*font-family:\s*'(?:DM Sans|Playfair Display)[^']*';/g,
]

function walk(dir) {
  const results = []
  for (const f of readdirSync(dir)) {
    const full = join(dir, f)
    const stat = statSync(full)
    if (stat.isDirectory() && !f.startsWith('.') && f !== 'node_modules') {
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
  for (const p of PATTERNS) next = next.replace(p, '')
  // clean up any dangling leading comma in style objects: { , color: ... } → { color: ... }
  next = next.replace(/\{\s*,\s*/g, '{ ')
  // clean up trailing comma before closing brace: { color: 'x', } — normalise
  next = next.replace(/,(\s*\})/g, '$1')
  if (next !== content) {
    writeFileSync(file, next)
    console.log('cleaned:', file.replace(process.cwd() + '/', ''))
    changed++
  }
}
console.log(`\nDone. ${changed} files updated.`)

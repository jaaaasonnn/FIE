import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// Code that runs in the browser must never reach the database client, password hashing, the service key or
// Node's own modules. Each one would ship server code to every visitor (the admin page once sent part of the
// Prisma client, about 16 KB, through one constant), and some would ship more than code.
//
// This follows every import of every 'use client' file, and of the browser's Sentry set-up, through the
// project's own files, and fails naming the chain that reaches one. Type-only imports are left out: they
// are removed when the code is built.

const SRC = path.resolve(__dirname, '../..')
const SERVER_ONLY_PACKAGES = [/^@prisma\/client/, /^bcryptjs$/, /^ws$/, /^@supabase\//, /^node:/, /^(fs|path|crypto|child_process|net|tls|os|stream|http|https|zlib)$/]
const SERVER_ONLY_FILES = ['lib/db.ts', 'lib/session.ts', 'lib/supabase.ts']

const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) return files(full)
  return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
})

const isClient = (text: string) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(text)

/** What a file imports at run time: every static import, re-export and import(), except type-only ones. */
export function runtimeImports(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const out: string[] = []
  for (const m of code.matchAll(/^\s*(import|export)\s+(type\s+)?([^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) if (!m[2]) out.push(m[4])
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1])
  return out
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null
  if (!base) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every chain from `entry` that ends at server-only code. */
export function forbiddenChains(entry: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const rel = (f: string) => path.relative(SRC, f)
  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const spec of runtimeImports(fs.readFileSync(file, 'utf8'))) {
      const local = resolveLocal(file, spec)
      if (local) {
        const next = [...chain, rel(local)]
        if (SERVER_ONLY_FILES.includes(rel(local))) found.push(next.join(' → '))
        else visit(local, next)
      } else if (!spec.startsWith('.') && SERVER_ONLY_PACKAGES.some((p) => p.test(spec))) {
        found.push([...chain, spec].join(' → '))
      }
    }
  }
  visit(entry, [rel(entry)])
  return found
}

describe('code sent to the browser', () => {
  const entries = [
    ...files(SRC).filter((f) => isClient(fs.readFileSync(f, 'utf8'))),
    path.join(SRC, 'instrumentation-client.ts'),
  ]

  it('finds the client files (a sanity check on the search itself)', () => {
    expect(entries.length).toBeGreaterThan(50)
    expect(entries.map((f) => path.relative(SRC, f))).toContain('app/admin/AdminClient.tsx')
  })

  it('never imports the database client, password hashing, the service key or Node modules, directly or through another file', () => {
    expect(entries.flatMap(forbiddenChains)).toEqual([])
  })

  it('would notice such an import (the check on the check)', () => {
    expect(runtimeImports(`import { db } from '@/lib/db'\nimport type { X } from '@prisma/client'\nexport { a } from './b'\nconst m = await import('maplibre-gl')`)).toEqual(['@/lib/db', './b', 'maplibre-gl'])
    expect(forbiddenChains(path.join(SRC, 'lib/exchangeRate.ts')).length).toBeGreaterThan(0)
  })
})

import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { envRate, rateInForce, usableRate } from '@/lib/exchangeRateShared'

// The dollar-to-cedi rate in force, and when there is none (polish-1: the preview's INITIAL_USD_TO_GHS held
// placeholder text and pages showed "GH₵ NaN"). With none, pages show dollars only and no payment is started.

describe('usableRate', () => {
  it('passes a real number above zero through exactly', () => {
    for (const n of [15.5, 15.655, 1, 0.01, 99.99]) expect(usableRate(n)).toBe(n)
  })
  it('gives null for anything else', () => {
    for (const v of [null, undefined, Number.NaN, 0, -0, -15.5, Infinity, -Infinity, '15.5', '', {}, [], true]) expect(usableRate(v), String(v)).toBeNull()
  })
})

describe('envRate (INITIAL_USD_TO_GHS)', () => {
  it('reads a plain decimal number above zero', () => {
    expect(envRate('15.5')).toBe(15.5)
    expect(envRate(' 15.5 ')).toBe(15.5)
    expect(envRate('16')).toBe(16)
    expect(envRate('0.5')).toBe(0.5)
  })
  it('is null when missing, empty, placeholder text, not a plain number, zero or negative', () => {
    for (const raw of [undefined, '', '   ', 'your_rate_here', 'abc', 'NaN', 'Infinity', '0', '0.0', '-15.5', '15,5', '15.5 cedis', '1e3', '0x10', '+15.5', '.5', '15.'])
      expect(envRate(raw), JSON.stringify(raw)).toBeNull()
  })
})

describe('rateInForce', () => {
  it('uses the newest stored rate when there is one, exactly as stored', () => {
    expect(rateInForce({ usdToGhs: 15.655 }, '15.5')).toBe(15.655)
    expect(rateInForce({ usdToGhs: 15.655 }, 'your_rate_here')).toBe(15.655)
  })
  it('falls back to INITIAL_USD_TO_GHS only when nothing is stored', () => {
    expect(rateInForce(null, '15.5')).toBe(15.5)
    expect(rateInForce(undefined, '15.5')).toBe(15.5)
  })
  it('is null with no stored rate and no usable INITIAL_USD_TO_GHS', () => {
    for (const raw of [undefined, '', 'your_rate_here', '0', '-1']) expect(rateInForce(null, raw)).toBeNull()
  })
  it('never swaps a stored rate that is not usable for the environment\'s', () => {
    for (const bad of [Number.NaN, 0, -15.5, Infinity]) expect(rateInForce({ usdToGhs: bad }, '15.5')).toBeNull()
  })
})

describe('the source', () => {
  // Every read of INITIAL_USD_TO_GHS goes through envRate or rateInForce: a bare Number(process.env...) is how
  // "GH₵ NaN" reached the pages
  it('reads INITIAL_USD_TO_GHS only through envRate or rateInForce', () => {
    const root = path.resolve(__dirname, '..')
    const files: string[] = []
    const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p) } }
    walk(root)
    const bad: string[] = []
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8')
      for (const m of text.matchAll(/process\.env\.INITIAL_USD_TO_GHS/g)) {
        const before = text.slice(Math.max(0, m.index! - 40), m.index)
        if (!/(envRate|rateInForce)\([^()]*$/.test(before)) bad.push(`${path.relative(root, f)}: ${before.split('\n').pop()}${m[0]}`)
      }
    }
    expect(bad).toEqual([])
    expect(files.length).toBeGreaterThan(100)
  })
})

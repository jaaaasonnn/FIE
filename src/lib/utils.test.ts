import { describe, it, expect } from 'vitest'
import { formatUsd, formatUsdCompact } from './utils'

describe('price formats', () => {
  it('always shows cents in breakdowns', () => {
    expect(formatUsd(95)).toBe('$95.00')
    expect(formatUsd(16000)).toBe('$16,000.00')
  })
  it('drops cents on cards only when the amount is whole', () => {
    expect(formatUsdCompact(95)).toBe('$95')
    expect(formatUsdCompact(95.5)).toBe('$95.50')
    expect(formatUsdCompact(16000)).toBe('$16,000')
    expect(formatUsdCompact(16000 / 12)).toBe('$1,333.33')
  })
})

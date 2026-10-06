import { describe, it, expect } from 'vitest'
import { shortUsd, shortUsdRange } from './mapLabels'

describe('shortUsd', () => {
  it('shows whole dollars under a thousand', () => {
    expect(shortUsd(45)).toBe('$45')
    expect(shortUsd(45.5)).toBe('$46')
    expect(shortUsd(999)).toBe('$999')
    expect(shortUsd(0)).toBe('$0')
  })

  it('shortens thousands', () => {
    expect(shortUsd(1000)).toBe('$1k')
    expect(shortUsd(1400)).toBe('$1.4k')
    expect(shortUsd(999.6)).toBe('$1k')
    expect(shortUsd(9960)).toBe('$10k')
    expect(shortUsd(12000)).toBe('$12k')
    expect(shortUsd(18500)).toBe('$19k')
  })

  it('shortens millions', () => {
    expect(shortUsd(1_200_000)).toBe('$1.2m')
    expect(shortUsd(25_000_000)).toBe('$25m')
  })
})

describe('shortUsdRange', () => {
  it('joins the two ends with "to"', () => {
    expect(shortUsdRange(45, 120)).toBe('$45 to $120')
    expect(shortUsdRange(1400, 45)).toBe('$45 to $1.4k')
  })

  it('collapses to one label when both ends read the same', () => {
    expect(shortUsdRange(80, 80)).toBe('$80')
    expect(shortUsdRange(1410, 1440)).toBe('$1.4k')
  })
})

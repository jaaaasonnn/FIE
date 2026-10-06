import { describe, it, expect } from 'vitest'
import { shortUsd, clusterLabel } from './mapLabels'

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

describe('clusterLabel', () => {
  it('shows the number of homes', () => {
    expect(clusterLabel(2)).toBe('2')
    expect(clusterLabel(3)).toBe('3')
    expect(clusterLabel(42)).toBe('42')
    expect(clusterLabel(99)).toBe('99')
  })

  it('caps at two digits so the bubble keeps its size', () => {
    expect(clusterLabel(100)).toBe('99+')
    expect(clusterLabel(1250)).toBe('99+')
  })

  it('never shows a price or a fraction', () => {
    expect(clusterLabel(3.9)).toBe('3')
    expect(clusterLabel(-1)).toBe('0')
    expect(clusterLabel(7)).not.toContain('$')
  })
})

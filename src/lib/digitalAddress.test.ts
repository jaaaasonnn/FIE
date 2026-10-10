import { describe, expect, it } from 'vitest'
import { DIGITAL_ADDRESS_ERROR, isDigitalAddress, parseDigitalAddress } from '@/lib/digitalAddress'

const stored = (raw: unknown) => { const r = parseDigitalAddress(raw); return r.ok ? r.value : 'REFUSED' }

describe('a Ghana Post digital address', () => {
  it('is stored in one form, whatever the case and spacing it was typed in', () => {
    for (const typed of ['GA-183-8164', 'ga-183-8164', ' Ga 183 8164 ', 'GA1838164', 'ga 1838164', 'GA.183.8164', 'GA - 183 - 8164', 'GA--183--8164']) {
      expect(stored(typed), typed).toBe('GA-183-8164')
    }
  })

  it('accepts three or four digits in each part', () => {
    expect(stored('AK-039-5028')).toBe('AK-039-5028')
    expect(stored('GW-0012-3456')).toBe('GW-0012-3456')
    expect(stored('gw00123456')).toBe('GW-0012-3456')
    expect(stored('WS-123-456')).toBe('WS-123-456')
    expect(stored('ws123456')).toBe('WS-123-456')
    expect(stored('GA-1234-567')).toBe('GA-1234-567')
  })

  it('accepts an area code whose second character is a digit', () => {
    expect(stored('E2-183-8164')).toBe('E2-183-8164')
    expect(stored('g2 183 8164')).toBe('G2-183-8164')
  })

  it('keeps leading zeros', () => {
    expect(stored('GA-001-0002')).toBe('GA-001-0002')
  })

  it('stores nothing for nothing: the address is optional', () => {
    for (const empty of [null, undefined, '', '   ']) expect(parseDigitalAddress(empty)).toEqual({ ok: true, value: null })
  })

  it('refuses anything that is not the shape of one', () => {
    for (const bad of [
      'GA', 'GA-183', 'GA-18-8164', 'GA-183-81645', 'GA-12345-678', 'G-183-8164', 'GAA-183-8164', '1A-183-8164', 'GA-183-816A',
      '12 Oxford Street, Osu', 'GA-183-8164 Accra', 'GA_183_8164', 'https://ghanapostgps.com/GA-183-8164', 'GA-183-8164'.repeat(3),
      1838164, true, {}, ['GA-183-8164'],
    ]) {
      expect(parseDigitalAddress(bad), String(bad)).toEqual({ ok: false, error: DIGITAL_ADDRESS_ERROR })
    }
  })

  it('knows a stored value from a typed one', () => {
    expect(isDigitalAddress('GA-183-8164')).toBe(true)
    for (const not of ['ga-183-8164', 'GA1838164', 'GA-183-8164 ', '', null, 5]) expect(isDigitalAddress(not)).toBe(false)
  })

  it('gives the same answer for a value it has already stored', () => {
    for (const once of ['GA-183-8164', 'GW-0012-3456', 'E2-123-456']) expect(stored(stored(once))).toBe(once)
  })
})

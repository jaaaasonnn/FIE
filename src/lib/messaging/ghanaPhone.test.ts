import { describe, expect, it } from 'vitest'
import { ghanaMsisdn, maskMsisdn } from '@/lib/messaging/ghanaPhone'

describe('Ghana mobile numbers for SMS', () => {
  it('accepts the three usual forms and gives 233XXXXXXXXX', () => {
    for (const typed of ['0241234567', '+233241234567', '233241234567', ' 024 123 4567 ', '+233 24-123-4567', '(024) 123.4567']) {
      expect(ghanaMsisdn(typed), typed).toBe('233241234567')
    }
    expect(ghanaMsisdn('0501234567')).toBe('233501234567')
    expect(ghanaMsisdn('0201234567')).toBe('233201234567')
  })

  it('accepts every mobile range, 02x and 05x', () => {
    for (let d = 0; d <= 9; d++) {
      expect(ghanaMsisdn(`02${d}1234567`)).toBe(`2332${d}1234567`)
      expect(ghanaMsisdn(`05${d}1234567`)).toBe(`2335${d}1234567`)
    }
  })

  it('refuses anything that is not a Ghana mobile number', () => {
    for (const bad of [
      '0302123456',      // a fixed line in Accra
      '0441234567', '0141234567', '0941234567',
      '024123456', '02412345678',          // too short, too long
      '+2330241234567', '2330241234567',   // a 0 kept after the country code
      '+0241234567', '00233241234567',
      '+234 803 123 4567', '+447700900123', // other countries
      '024123456a', '024 123 4567 ext 2', '', '   ', 'null',
    ]) expect(ghanaMsisdn(bad), bad).toBeNull()
    expect(ghanaMsisdn(undefined)).toBeNull()
    expect(ghanaMsisdn(241234567)).toBeNull()
  })

  it('masks a number for logs and errors, never showing it whole', () => {
    expect(maskMsisdn('0241234567')).toBe('+233 24 *** **67')
    expect(maskMsisdn('233241234567')).toBe('+233 24 *** **67')
    expect(maskMsisdn('0241234567')).not.toContain('123')
    expect(maskMsisdn('not a number 0302123456')).toBe('[number]')
  })
})

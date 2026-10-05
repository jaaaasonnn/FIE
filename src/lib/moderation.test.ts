import { describe, it, expect } from 'vitest'
import { hasContactDetails } from './moderation'

describe('hasContactDetails', () => {
  it('flags phone numbers, email providers and WhatsApp', () => {
    expect(hasContactDetails('Call me on 0241234567')).toBe(true)
    expect(hasContactDetails('Reach me at +233 24 123 4567')).toBe(true)
    expect(hasContactDetails('kwame@gmail.com')).toBe(true)
    expect(hasContactDetails('Message me on WhatsApp')).toBe(true)
  })
  it('passes an ordinary description, empty text and null', () => {
    expect(hasContactDetails('A bright two-bedroom flat, five minutes from Osu.')).toBe(false)
    expect(hasContactDetails('')).toBe(false)
    expect(hasContactDetails(null)).toBe(false)
  })
})

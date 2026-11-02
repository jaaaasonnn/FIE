import { describe, expect, it } from 'vitest'
import { SAMPLE_FACTS, TEMPLATES } from './templates'

// SU7: what the guest and the host are told when a booking ends because its home is no longer available,
// in the wording the owner approved.

const text = (pieces: ReturnType<(typeof TEMPLATES)['booking.expired']['render']>, to: string) =>
  pieces.filter((p) => p.to === to).map((p) => [...(p.email?.lines ?? []), p.inApp?.body ?? ''].join(' ')).join(' ')

describe('a booking whose home is no longer available', () => {
  it('tells the guest it has ended and nothing was charged; the host who switched it off is told too', () => {
    const pieces = TEMPLATES['booking.expired'].render({ ...SAMPLE_FACTS, expiredFor: 'HOME_UNAVAILABLE', homeGone: 'SWITCHED_OFF' })
    expect(text(pieces, 'guest')).toContain('The home you booked is no longer available, so your booking')
    expect(text(pieces, 'guest')).toContain('has ended. You have not been charged.')
    expect(text(pieces, 'host')).toContain('ended because the home is switched off. The guest was not charged.')
  })

  it('does not write to a suspended host', () => {
    const pieces = TEMPLATES['booking.expired'].render({ ...SAMPLE_FACTS, expiredFor: 'HOME_UNAVAILABLE', homeGone: 'HOST_SUSPENDED' })
    expect(pieces.map((p) => p.to)).toEqual(['guest'])
  })

  it('tells a guest whose money arrived after the home went that it is refunded in full', () => {
    const pieces = TEMPLATES['payment.late_refund'].render({ ...SAMPLE_FACTS, expiredFor: 'HOME_UNAVAILABLE' })
    const guest = pieces.find((p) => p.to === 'guest')!.email!.lines.join(' ')
    expect(guest).toContain('The home became unavailable before your payment')
    expect(guest).toContain('so it is being refunded in full')
    expect(guest).toContain('Refunds can take several working days to arrive.')
  })
})

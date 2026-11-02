import { describe, expect, it } from 'vitest'
import { HOME_UNAVAILABLE, homeUnavailable, withHomeAvailable } from './homeAvailability'
import { payState } from './payDeadline'

// SU7: the rule, and what the booking reads send about it.

const on = { isActive: true, moderationHold: false }
describe('a home that is no longer available', () => {
  it('is one its host switched off, or whose host is suspended; never one on hold', () => {
    expect(homeUnavailable({ listing: on, host: { suspendedAt: null } })).toBe(false)
    expect(homeUnavailable({ listing: { isActive: false, moderationHold: false }, host: { suspendedAt: null } })).toBe(true)
    expect(homeUnavailable({ listing: on, host: { suspendedAt: new Date() } })).toBe(true)
    // Held, by an admin or by the automatic check: outside the rule
    expect(homeUnavailable({ listing: { isActive: false, moderationHold: true }, host: { suspendedAt: null } })).toBe(false)
  })

  it('reaches the booking reads only as homeAvailable: no switches, no suspension', () => {
    const booking = { id: 'b', listing: { id: 'l', title: 'A home', isActive: false, moderationHold: false }, host: { id: 'h', name: 'Ama', suspendedAt: new Date() } }
    const sent = withHomeAvailable(booking)
    expect(sent).toEqual({ id: 'b', listing: { id: 'l', title: 'A home' }, host: { id: 'h', name: 'Ama' }, homeAvailable: false })
    // The booking as read is left as it was
    expect(booking.host.suspendedAt).toBeInstanceOf(Date)
  })

  it('is a pay state of its own: unpaid on such a home, or ended for it', () => {
    expect(payState({ status: 'CONFIRMED', paymentStatus: 'UNPAID', homeAvailable: false })).toBe('HOME_UNAVAILABLE')
    expect(payState({ status: 'PENDING', paymentStatus: 'UNPAID', homeAvailable: false })).toBe('HOME_UNAVAILABLE')
    expect(payState({ status: 'CANCELLED', paymentStatus: 'PAID', cancelledBy: 'SYSTEM', cancelReason: HOME_UNAVAILABLE })).toBe('HOME_UNAVAILABLE')
    // A paid booking is the guest's, whatever happened to the home since
    expect(payState({ status: 'CONFIRMED', paymentStatus: 'PAID', homeAvailable: false })).toBe(null)
    expect(payState({ status: 'CONFIRMED', paymentStatus: 'UNPAID', homeAvailable: true })).toBe('AWAITING_PAYMENT')
  })
})

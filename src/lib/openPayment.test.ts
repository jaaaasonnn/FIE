import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/lib/testing/fakeDb'

// G15: a payment settled while another tab's Pay is on its way must not lead
// to a second payment. The route read the booking as unpaid before the claim;
// the claim looks again once it holds the booking.

const tables = vi.hoisted(() => ({}) as Tables)
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(tables) }))

import { claimPaymentSlot } from '@/lib/openPayment'

const fresh = (over: { instalmentId?: string | null; gatewayReference?: string } = {}) => ({
  bookingId: 'b1', instalmentId: null, amount: 300, method: 'CARD', gatewayReference: 'FIE-b1-new', amountPesewas: 465000, usdToGhs: 15.5, ...over,
})

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  tables.booking = [{ id: 'b1', status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentReference: 'FIE-b1-first', updatedAt: new Date() }]
  tables.payment = [{ id: 'p1', bookingId: 'b1', instalmentId: null, status: 'PENDING', gatewayReference: 'FIE-b1-first', createdAt: new Date() }]
})

describe('claiming the payment slot', () => {
  it('starts no payment for a booking paid in the meantime', async () => {
    tables.booking[0].paymentStatus = 'PAID'
    tables.payment[0].status = 'SUCCESS'
    const slot = await claimPaymentSlot(fresh(), { stampBooking: true })
    expect(slot.kind).toBe('paid')
    expect(tables.payment).toHaveLength(1)
    expect(tables.booking[0].paymentReference).toBe('FIE-b1-first')
  })

  it('starts no payment for a rent instalment paid in the meantime', async () => {
    tables.booking[0].paymentStatus = 'PAID'
    tables.payment.push({ id: 'p2', bookingId: 'b1', instalmentId: 'i2', status: 'SUCCESS', gatewayReference: 'FIE-b1-rent', createdAt: new Date() })
    const slot = await claimPaymentSlot(fresh({ instalmentId: 'i2' }), { stampBooking: false })
    expect(slot.kind).toBe('paid')
    expect(tables.payment).toHaveLength(2)
  })

  it('still hands back the open payment, and still starts one where nothing is paid or open', async () => {
    expect((await claimPaymentSlot(fresh(), { stampBooking: true })).kind).toBe('open')
    tables.payment[0].status = 'FAILED'
    const slot = await claimPaymentSlot(fresh(), { stampBooking: true })
    expect(slot.kind).toBe('new')
    expect(tables.payment).toHaveLength(2)
    // The later month's rent on a paid booking is not mistaken for the booking being paid
    tables.booking[0].paymentStatus = 'PAID'
    expect((await claimPaymentSlot(fresh({ instalmentId: 'i3', gatewayReference: 'FIE-b1-i3' }), { stampBooking: false })).kind).toBe('new')
  })
})

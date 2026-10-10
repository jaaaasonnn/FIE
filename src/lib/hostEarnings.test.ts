import { describe, expect, it } from 'vitest'
import { monthEarnings, type EarningsBooking } from '@/lib/hostEarnings'
import { hostShare } from '@/lib/disputes'

// The host dashboard's "This Month" figure. It is March 2027 throughout.
const NOW = new Date('2027-03-15T10:00:00Z')
const day = (key: string) => `${key}T12:00:00.000Z`
const stay = (over: Partial<EarningsBooking> = {}): EarningsBooking =>
  ({ status: 'CONFIRMED', paymentStatus: 'PAID', checkIn: day('2027-03-10'), subtotal: 400, refund: null, instalments: [], ...over })
const earned = (...bookings: EarningsBooking[]) => monthEarnings(bookings, NOW)

describe('this month\'s earnings', () => {
  it('is the host\'s share of a paid stay that checks in this month', () => {
    expect(earned(stay())).toBe(hostShare(400))
    expect(earned(stay(), stay({ subtotal: 100, status: 'COMPLETED' }))).toBe(hostShare(400) + hostShare(100))
  })

  it('never counts the damage deposit: only the stay price goes in', () => {
    // A booking's total includes the deposit; the sum is given the subtotal alone
    expect(earned(stay({ subtotal: 400 }))).toBeLessThan(400)
  })

  it('leaves out stays in other months, past and future', () => {
    expect(earned(stay({ checkIn: day('2027-02-28') }))).toBe(0)
    expect(earned(stay({ checkIn: day('2027-04-01') }))).toBe(0)
    expect(earned(stay({ checkIn: day('2027-12-25') }))).toBe(0)
    expect(earned(stay({ checkIn: day('2027-03-01') }), stay({ checkIn: day('2027-03-31') }))).toBe(2 * hostShare(400))
  })

  it('leaves out anything not paid for, and requests not yet accepted', () => {
    expect(earned(stay({ paymentStatus: 'UNPAID' }))).toBe(0)
    expect(earned(stay({ status: 'PENDING', paymentStatus: 'UNPAID' }))).toBe(0)
  })

  it('leaves out cancelled, declined and refunded stays', () => {
    expect(earned(stay({ status: 'CANCELLED' }))).toBe(0)
    expect(earned(stay({ status: 'DECLINED' }))).toBe(0)
    expect(earned(stay({ paymentStatus: 'REFUNDED' }))).toBe(0)
    expect(earned(stay({ refund: { reason: 'DISPUTE_FULL', stayRefund: 400 } }))).toBe(0)
    expect(earned(stay({ refund: { reason: 'GUEST_CANCELLED', stayRefund: 200 } }))).toBe(0)
  })

  it('takes a dispute\'s part refund off the stay before the host\'s share', () => {
    expect(earned(stay({ paymentStatus: 'PARTIALLY_REFUNDED', refund: { reason: 'DISPUTE_PARTIAL', stayRefund: 150 } }))).toBe(hostShare(400, 150))
    // A deposit going back to the guest takes nothing from the host
    expect(earned(stay({ refund: { reason: 'DISPUTE_DEPOSIT', stayRefund: 0 } }))).toBe(hostShare(400))
  })

  describe('a stay paid in instalments', () => {
    const instalment = (sequence: number, due: string, status = 'PAID', amount = 1000) => ({ sequence, status, dueDate: day(due), amount })
    const tenancy = (instalments: ReturnType<typeof instalment>[], over: Partial<EarningsBooking> = {}) =>
      stay({ checkIn: day('2027-01-15'), subtotal: 12_000, instalments, ...over })

    it('counts the instalment that falls due this month, not the year\'s rent', () => {
      const all = [instalment(1, '2027-01-15', 'PAID', 2000), instalment(2, '2027-03-15'), instalment(3, '2027-04-15', 'PENDING')]
      expect(earned(tenancy(all))).toBe(hostShare(1000))
    })

    it('counts the first payment in the month the tenant moves in', () => {
      expect(earned(tenancy([instalment(1, '2027-03-05', 'PAID', 3000), instalment(2, '2027-06-05', 'PENDING')], { checkIn: day('2027-03-05') }))).toBe(hostShare(3000))
    })

    it('counts nothing for rent that is due this month but not paid', () => {
      expect(earned(tenancy([instalment(1, '2027-01-15'), instalment(2, '2027-03-15', 'PENDING')]))).toBe(0)
      expect(earned(tenancy([instalment(1, '2027-01-15'), instalment(2, '2027-03-15', 'PART_COVERED')]))).toBe(0)
      expect(earned(tenancy([instalment(1, '2027-01-15'), instalment(2, '2027-03-15', 'CANCELLED')]))).toBe(0)
    })

    it('counts rent covered in full from the deposit', () => {
      expect(earned(tenancy([instalment(1, '2027-01-15'), instalment(2, '2027-03-15', 'COVERED')]))).toBe(hostShare(1000))
    })

    it('counts rent paid early in the month it falls due, not the month it was paid', () => {
      expect(earned(tenancy([instalment(1, '2027-01-15'), instalment(2, '2027-04-15', 'PAID')]))).toBe(0)
    })

    it('takes a dispute\'s part refund off the first payment only', () => {
      const refund = { reason: 'DISPUTE_PARTIAL', stayRefund: 500 }
      expect(earned(tenancy([instalment(1, '2027-03-05', 'PAID', 3000)], { checkIn: day('2027-03-05'), refund }))).toBe(hostShare(3000, 500))
      expect(earned(tenancy([instalment(1, '2027-01-15', 'PAID', 3000), instalment(2, '2027-03-15')], { refund }))).toBe(hostShare(1000))
    })
  })

  it('goes by the month in Ghana, whatever time zone the browser is in', () => {
    // 00:30 on 1 April in Accra. In New York or Los Angeles it is still 31 March.
    const justIntoApril = new Date('2027-04-01T00:30:00Z')
    expect(monthEarnings([stay({ checkIn: day('2027-04-01') })], justIntoApril)).toBe(hostShare(400))
    expect(monthEarnings([stay({ checkIn: day('2027-03-31') })], justIntoApril)).toBe(0)
    // 23:30 on 31 March in Accra. In Auckland it is already 1 April.
    const lastOfMarch = new Date('2027-03-31T23:30:00Z')
    expect(monthEarnings([stay({ checkIn: day('2027-03-31') })], lastOfMarch)).toBe(hostShare(400))
    expect(monthEarnings([stay({ checkIn: day('2027-04-01') })], lastOfMarch)).toBe(0)
  })

  it('is zero with no bookings', () => {
    expect(earned()).toBe(0)
  })
})

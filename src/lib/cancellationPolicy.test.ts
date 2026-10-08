import { describe, it, expect } from 'vitest'
import {
  DEFAULT_POLICY, asPolicy, commonRuleLines, isHostCancelReason, policyRuleLines,
  quoteRefund, refundPercent, refundPesewas, tierDeadline, type RefundInput,
} from './cancellationPolicy'
import { refundStatusText } from './refundWording'

// A 4-night short stay: $100 a night, 12% service fee, $50 deposit
const short: RefundInput = {
  rentalMode: 'SHORT_STAY', policy: 'MODERATE', by: 'GUEST', daysBefore: 10,
  subtotal: 400, serviceFee: 48, damageDeposit: 50, pricePerUnit: 100, paid: 498,
}
// A 3-month stay at $900 a month, $300 deposit
const monthly: RefundInput = {
  rentalMode: 'TEMP_STAY', policy: 'MODERATE', by: 'GUEST', daysBefore: 20,
  subtotal: 2700, serviceFee: 324, damageDeposit: 300, pricePerUnit: 900, paid: 3324,
}
// A year at $9,600, $600 deposit
const yearly: RefundInput = {
  rentalMode: 'PERMANENT', policy: 'MODERATE', by: 'GUEST', daysBefore: 40,
  subtotal: 9600, serviceFee: 1152, damageDeposit: 600, pricePerUnit: 9600, paid: 11352,
}
const pct = (mode: string, policy: string, days: number[]) => days.map((d) => refundPercent(mode, policy, d))

describe('refund percentage by policy and notice', () => {
  it('short stay', () => {
    expect(pct('SHORT_STAY', 'FLEXIBLE', [30, 1])).toEqual([100, 100])
    expect(pct('SHORT_STAY', 'MODERATE', [5, 4, 1])).toEqual([100, 50, 50])
    expect(pct('SHORT_STAY', 'STRICT', [14, 13, 7, 6, 1])).toEqual([100, 50, 50, 0, 0])
  })
  it('monthly', () => {
    expect(pct('TEMP_STAY', 'FLEXIBLE', [7, 6, 1])).toEqual([100, 50, 50])
    expect(pct('TEMP_STAY', 'MODERATE', [14, 13, 7, 6, 1])).toEqual([100, 50, 50, 0, 0])
    expect(pct('TEMP_STAY', 'STRICT', [30, 29, 14, 13, 1])).toEqual([100, 50, 50, 0, 0])
  })
  it('long-term', () => {
    expect(pct('PERMANENT', 'FLEXIBLE', [14, 13, 1])).toEqual([100, 50, 50])
    expect(pct('PERMANENT', 'MODERATE', [30, 29, 14, 13, 1])).toEqual([100, 50, 50, 0, 0])
    expect(pct('PERMANENT', 'STRICT', [60, 59, 30, 29, 1])).toEqual([100, 50, 50, 0, 0])
  })
  it('gives nothing on or after the check-in day', () => {
    expect(pct('SHORT_STAY', 'FLEXIBLE', [0, -1])).toEqual([0, 0])
  })
  it('treats a missing or unknown policy as Moderate', () => {
    expect(DEFAULT_POLICY).toBe('MODERATE')
    expect(asPolicy(null)).toBe('MODERATE')
    expect(asPolicy('flexible')).toBe('MODERATE')
    expect(refundPercent('SHORT_STAY', undefined, 4)).toBe(50)
  })
})

describe('quoteRefund', () => {
  it('gives everything back on a full refund', () => {
    expect(quoteRefund(short)).toEqual({
      policy: 'MODERATE', percent: 100, stayRefund: 400, serviceFeeRefund: 48, depositRefund: 50, total: 498, kept: 0,
    })
  })

  it('keeps the service fee when only part of the stay comes back', () => {
    expect(quoteRefund({ ...short, daysBefore: 3 })).toEqual({
      policy: 'MODERATE', percent: 50, stayRefund: 200, serviceFeeRefund: 0, depositRefund: 50, total: 250, kept: 248,
    })
  })

  it('always returns the deposit, even with no refund of the stay', () => {
    expect(quoteRefund({ ...short, policy: 'STRICT', daysBefore: 2 })).toEqual({
      policy: 'STRICT', percent: 0, stayRefund: 0, serviceFeeRefund: 0, depositRefund: 50, total: 50, kept: 448,
    })
  })

  it('returns nothing but zero when there is no deposit and no refund', () => {
    const q = quoteRefund({ ...short, policy: 'STRICT', daysBefore: 2, damageDeposit: 0, paid: 448 })
    expect(q).toMatchObject({ total: 0, kept: 448 })
  })

  it('keeps at most one month of a monthly stay', () => {
    // 50% of $2,700 would keep $1,350; the cap makes it $900
    expect(quoteRefund({ ...monthly, daysBefore: 10 })).toMatchObject({ percent: 50, stayRefund: 1800, serviceFeeRefund: 0, depositRefund: 300, total: 2100, kept: 1224 })
    // 0% would keep all $2,700; the cap makes it $900
    expect(quoteRefund({ ...monthly, daysBefore: 3 })).toMatchObject({ percent: 0, stayRefund: 1800, serviceFeeRefund: 0, total: 2100 })
    // A one-month stay at 50% keeps $450, under the cap
    expect(quoteRefund({ ...monthly, subtotal: 900, serviceFee: 108, paid: 1308, daysBefore: 10 })).toMatchObject({ stayRefund: 450, total: 750 })
  })

  it('keeps at most one month of a long-term stay', () => {
    // 50% of $9,600 would keep $4,800; the cap makes it $800
    expect(quoteRefund({ ...yearly, daysBefore: 20 })).toMatchObject({ percent: 50, stayRefund: 8800, serviceFeeRefund: 0, depositRefund: 600, total: 9400, kept: 1952 })
    expect(quoteRefund({ ...yearly, daysBefore: 5 })).toMatchObject({ percent: 0, stayRefund: 8800, total: 9400 })
    expect(quoteRefund(yearly)).toMatchObject({ percent: 100, stayRefund: 9600, serviceFeeRefund: 1152, total: 11352, kept: 0 })
  })

  it('does not cap a short stay', () => {
    expect(quoteRefund({ ...short, subtotal: 4000, serviceFee: 480, paid: 4530, policy: 'STRICT', daysBefore: 2 })).toMatchObject({ stayRefund: 0, total: 50 })
  })

  it('gives the guest everything when the host cancels, whatever the policy or notice', () => {
    for (const policy of ['FLEXIBLE', 'MODERATE', 'STRICT']) {
      expect(quoteRefund({ ...short, policy, by: 'HOST', daysBefore: 1 })).toMatchObject({ percent: 100, stayRefund: 400, serviceFeeRefund: 48, depositRefund: 50, total: 498, kept: 0 })
    }
    expect(quoteRefund({ ...yearly, policy: 'STRICT', by: 'HOST', daysBefore: 1 })).toMatchObject({ total: 11352, kept: 0 })
  })

  it('rounds to the cent', () => {
    const q = quoteRefund({ ...short, subtotal: 333.33, serviceFee: 40, damageDeposit: 0, paid: 373.33, daysBefore: 3 })
    expect(q).toMatchObject({ stayRefund: 166.67, total: 166.67, kept: 206.66 })
  })

  it('refuses a refund bigger than the payment', () => {
    expect(() => quoteRefund({ ...short, paid: 400 })).toThrow(/more than the 400 paid/)
  })

  it('ignores anything that is not a stored amount', () => {
    // There is no field for a requested amount: the same inputs always give the same answer
    expect(quoteRefund({ ...short, daysBefore: 3 })).toEqual(quoteRefund({ ...short, daysBefore: 3 }))
  })
})

describe('refundPesewas', () => {
  it('returns exactly what was charged on a full refund', () => {
    expect(refundPesewas(498, 498, 771_900)).toBe(771_900)
    expect(refundPesewas(500, 498, 771_900)).toBe(771_900)
  })
  it('returns the same share of the cedis charged on a part refund', () => {
    expect(refundPesewas(250, 498, 771_900)).toBe(387_500)
    expect(refundPesewas(50, 498, 771_900)).toBe(77_500)
    expect(refundPesewas(0, 498, 771_900)).toBe(0)
    // Whatever rate the guest was charged at, not today's or a fixed one
    expect(refundPesewas(250, 498, 800_000)).toBe(401_606)
    expect(refundPesewas(100, 300, 1_000_001)).toBe(333_334)
  })
})

describe('wording', () => {
  it('describes each short stay policy from the same tiers', () => {
    expect(policyRuleLines('SHORT_STAY', 'FLEXIBLE')).toEqual(['Full refund of the stay price if you cancel up to the day before check-in.'])
    expect(policyRuleLines('SHORT_STAY', 'MODERATE')).toEqual([
      'Full refund of the stay price if you cancel 5 or more days before check-in.',
      '50% of the stay price back if you cancel 1 to 4 days before check-in.',
    ])
    expect(policyRuleLines('SHORT_STAY', 'STRICT')).toEqual([
      'Full refund of the stay price if you cancel 14 or more days before check-in.',
      '50% of the stay price back if you cancel 7 to 13 days before check-in.',
      'No refund of the stay price if you cancel less than 7 days before check-in.',
    ])
  })
  it('describes monthly and long-term policies, with the one-month cap', () => {
    expect(policyRuleLines('TEMP_STAY', 'FLEXIBLE')).toEqual([
      'Full refund of the rent if you cancel 7 or more days before move-in.',
      '50% of the rent back if you cancel 1 to 6 days before move-in.',
      "We never keep more than one month's rent.",
    ])
    expect(policyRuleLines('PERMANENT', 'STRICT')).toEqual([
      'Full refund of the rent if you cancel 60 or more days before move-in.',
      '50% of the rent back if you cancel 30 to 59 days before move-in.',
      'No refund of the rent if you cancel less than 30 days before move-in.',
      "We never keep more than one month's rent.",
    ])
  })
  it('states the deposit and check-in day rules, and the fee rule only where a fee was charged', () => {
    const always = [
      'The damage deposit is always refunded in full if you cancel before check-in.',
      'From the check-in day onwards you cannot cancel online. Contact support at support@fiegh.com.',
    ]
    // New bookings carry no service fee, so a listing says nothing about one
    expect(commonRuleLines('SHORT_STAY')).toEqual(always)
    expect(commonRuleLines('SHORT_STAY', false)).toEqual(always)
    // A booking that was charged one still states its rule
    expect(commonRuleLines('SHORT_STAY', true)).toEqual(['The service fee is refunded only when the whole stay price is refunded.', ...always])
    expect(commonRuleLines('PERMANENT', true)[0]).toBe('The service fee is refunded only when the whole rent is refunded.')
  })
  it('uses no em-dashes or arrows', () => {
    const all = ['SHORT_STAY', 'TEMP_STAY', 'PERMANENT'].flatMap((m) => ['FLEXIBLE', 'MODERATE', 'STRICT'].flatMap((p) => [...policyRuleLines(m, p), ...commonRuleLines(m)]))
    expect(all.join(' ')).not.toMatch(/[—–→]/)
  })
  it('knows when the current refund stops applying', () => {
    expect(tierDeadline('SHORT_STAY', 'MODERATE', 10)).toEqual({ percent: 100, minDays: 5 })
    expect(tierDeadline('SHORT_STAY', 'MODERATE', 3)).toEqual({ percent: 50, minDays: 1 })
    expect(tierDeadline('SHORT_STAY', 'STRICT', 3)).toBeNull()
  })
})

describe('host cancellation reasons', () => {
  it('accepts only the listed reasons', () => {
    for (const r of ['PROPERTY_UNAVAILABLE', 'EMERGENCY', 'DOUBLE_BOOKING', 'GUEST_REQUEST', 'OTHER']) expect(isHostCancelReason(r)).toBe(true)
    for (const r of ['', 'other', 'toString', 'constructor', undefined, 5]) expect(isHostCancelReason(r)).toBe(false)
  })
})

describe('what the guest is told about a refund', () => {
  it('says owed, on its way, or refunded, and never more than that', () => {
    expect(refundStatusText({ amount: 250, status: 'PENDING' })).toBe('A refund of $250.00 is owed to you and will be sent to the card or mobile money number you paid with.')
    expect(refundStatusText({ amount: 250, status: 'PROCESSING' })).toBe('A refund of $250.00 is on its way. It can take up to 10 working days to arrive.')
    expect(refundStatusText({ amount: 250, status: 'PROCESSED', processedAt: '2027-03-04T09:30:00Z' })).toMatch(/^\$250\.00 was refunded on 4 Mar 2027\.$/)
    for (const status of ['FAILED', 'NEEDS_ATTENTION']) {
      expect(refundStatusText({ amount: 250, status })).toMatch(/Our team is handling it/)
    }
  })
})

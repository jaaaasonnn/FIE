import { describe, expect, it } from 'vitest'
import {
  ADVANCE_MONTHS_ERROR, DEFAULT_ADVANCE_MONTHS, MAX_ADVANCE_MONTHS, OVERDUE_REMINDER_DAYS, RENT_AFTER_MOVE_IN, RENT_FIRST_PAYMENT_FIRST,
  RENT_ALREADY_SETTLED, RENT_NOT_PAYABLE, RENT_PAY_IN_ORDER, SHORT_TENANCY_MAX_ADVANCE,
  advanceMonths, advanceSummary, buildSchedule, coverQuote, daysPastDue, depositLeft, endTenancyQuote, isAdvanceMonths,
  isOverdue, laterInstalmentRefusal, listingAdvanceMonths, monthlyRent, nextPayable, outstanding, parseAdvanceMonths,
  payoutReleaseAt, refundableRent, reminderKind, rentPlan, rentReceived, rentStatus, tenancyMonths,
  type InstalmentState,
} from '@/lib/rentRules'
import { dayKey } from '@/lib/hostCalendar'

// Pure rules: no database, no network, and nothing here depends on the
// machine's time zone (npm run test:tz runs it in six).

const day = (key: string) => new Date(`${key}T12:00:00.000Z`)
const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
const HOUR = 60 * 60 * 1000

/** A one-year tenancy from 15 Jan 2027 at $12,000 a year with a $500 deposit and three months up front. */
const yearly = (over: Partial<Parameters<typeof buildSchedule>[0]> = {}) => buildSchedule({
  rentalMode: 'PERMANENT', checkIn: day('2027-01-15'), units: 1, subtotal: 12_000, damageDeposit: 500, advanceMonthsRequired: 3, ...over,
})

/** The same schedule as stored rows, with the first `paid` instalments paid. */
function rows(paid = 1, over: Record<number, Partial<InstalmentState>> = {}): (InstalmentState & { id: string; paidAt: Date | null })[] {
  return yearly().map((r) => ({
    ...r, id: `inst_${r.sequence}`, status: r.sequence <= paid ? 'PAID' : 'PENDING', coveredFromDeposit: 0, paidAt: null, ...over[r.sequence],
  }))
}
const standing = { status: 'CONFIRMED', paymentStatus: 'PAID', checkIn: day('2027-01-15'), checkOut: day('2028-01-15'), damageDeposit: 500 }

describe('the advance', () => {
  it('is three months on a long-term listing that has not chosen', () => {
    expect(DEFAULT_ADVANCE_MONTHS).toBe(3)
    expect(advanceMonths('PERMANENT', 12, null)).toBe(3)
    expect(advanceMonths('PERMANENT', 12, undefined)).toBe(3)
    expect(listingAdvanceMonths(null)).toBe(3)
  })

  it('is whatever the host set, from 1 to 6', () => {
    for (let n = 1; n <= MAX_ADVANCE_MONTHS; n++) expect(advanceMonths('PERMANENT', 12, n)).toBe(n)
  })

  it('is never more than 6, whatever is stored on the listing', () => {
    expect(MAX_ADVANCE_MONTHS).toBe(6)
    expect(advanceMonths('PERMANENT', 12, 12)).toBe(6)
    expect(advanceMonths('PERMANENT', 12, 7)).toBe(6)
    expect(advanceMonths('PERMANENT', 24, 99)).toBe(6)
  })

  it('falls back to the default for a stored value that is not a whole month count', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(advanceMonths('PERMANENT', 12, bad)).toBe(3)
  })

  it('is capped at two months for a tenancy of six months or less', () => {
    expect(SHORT_TENANCY_MAX_ADVANCE).toBe(2)
    expect(advanceMonths('PERMANENT', 6, 6)).toBe(2)
    expect(advanceMonths('PERMANENT', 6, 3)).toBe(2)
    expect(advanceMonths('PERMANENT', 6, 1)).toBe(1)
    expect(advanceMonths('PERMANENT', 3, null)).toBe(2)
    // Seven months is over the line
    expect(advanceMonths('PERMANENT', 7, 6)).toBe(6)
  })

  it('is one month for a monthly booking, whatever the listing says', () => {
    for (const setting of [null, 1, 3, 6, 12]) {
      expect(advanceMonths('TEMP_STAY', 11, setting)).toBe(1)
      expect(advanceMonths('TEMP_STAY', 1, setting)).toBe(1)
    }
  })

  it('is never longer than the tenancy itself', () => {
    expect(advanceMonths('PERMANENT', 1, 6)).toBe(1)
    expect(advanceMonths('PERMANENT', 2, 6)).toBe(2)
  })

  describe('as a listing form sends it', () => {
    it('stores nothing as null, which means the default', () => {
      for (const empty of [null, undefined, '']) expect(parseAdvanceMonths(empty)).toEqual({ ok: true, value: null })
    })
    it('accepts 1 to 6 as a number or as digits', () => {
      expect(parseAdvanceMonths(1)).toEqual({ ok: true, value: 1 })
      expect(parseAdvanceMonths('6')).toEqual({ ok: true, value: 6 })
      expect(parseAdvanceMonths(' 3 ')).toEqual({ ok: true, value: 3 })
    })
    it('refuses everything else', () => {
      for (const bad of [0, 7, 12, '12', -1, 2.5, '2.5', '3 months', '6abc', 'abc', true, {}, [], Number.NaN, Infinity]) {
        expect(parseAdvanceMonths(bad), String(bad)).toEqual({ ok: false, error: ADVANCE_MONTHS_ERROR })
      }
      expect(isAdvanceMonths('3')).toBe(false)
    })
  })

  it('reads as a plain sentence built from the same numbers', () => {
    expect(advanceSummary('PERMANENT', 12, null)).toBe("3 months' rent up front, then monthly.")
    expect(advanceSummary('PERMANENT', 12, 1)).toBe("One month's rent up front, then monthly.")
    expect(advanceSummary('PERMANENT', 12, 12)).toBe("6 months' rent up front, then monthly.")
    expect(advanceSummary('TEMP_STAY', 4, 6)).toBe("One month's rent up front, then monthly.")
    expect(advanceSummary('TEMP_STAY', 1, null)).toBe("One month's rent, paid up front.")
  })
})

describe('the schedule', () => {
  it('has no rows for a short stay', () => {
    expect(buildSchedule({ rentalMode: 'SHORT_STAY', checkIn: day('2027-01-15'), units: 3, subtotal: 300, damageDeposit: 50, advanceMonthsRequired: 3 })).toEqual([])
  })

  it('puts the advance and the deposit in the first payment, then one month at a time', () => {
    const s = yearly()
    expect(s).toHaveLength(10)
    expect(s[0]).toMatchObject({ sequence: 1, amount: 3000, depositAmount: 500 })
    expect(dayKey(s[0].periodStart)).toBe('2027-01-15')
    expect(dayKey(s[0].periodEnd)).toBe('2027-04-15')
    expect(dayKey(s[0].dueDate)).toBe('2027-01-15')
    expect(s[1]).toMatchObject({ sequence: 2, amount: 1000, depositAmount: 0 })
    expect(dayKey(s[1].dueDate)).toBe('2027-04-15')
    expect(dayKey(s[1].periodEnd)).toBe('2027-05-15')
    // Each one starts where the last ended, and the last ends on the check-out day
    for (let i = 1; i < s.length; i++) expect(s[i].periodStart.getTime()).toBe(s[i - 1].periodEnd.getTime())
    expect(dayKey(s[9].periodEnd)).toBe('2028-01-15')
    expect(s.slice(1).every((r) => r.depositAmount === 0 && r.dueDate.getTime() === r.periodStart.getTime())).toBe(true)
  })

  it('adds up to the rent exactly, to the cent, whatever the yearly price', () => {
    for (const subtotal of [10_000, 16_000, 9_999.99, 100, 1234.56, 0.12, 7, 123_456.78]) {
      for (const advance of [1, 2, 3, 4, 5, 6]) {
        const s = yearly({ subtotal, advanceMonthsRequired: advance })
        expect(sum(s), `${subtotal} with ${advance}`).toBe(subtotal)
        expect(s).toHaveLength(12 - advance + 1)
        // Whole cents only
        for (const r of s) expect(Math.abs(r.amount * 100 - Math.round(r.amount * 100))).toBeLessThan(1e-6)
      }
    }
  })

  it('gives the last payment the cents left over, and no other', () => {
    const s = yearly({ subtotal: 10_000 })
    expect(s[0].amount).toBe(2499.99)      // three months at 833.33
    expect(s.slice(1, -1).every((r) => r.amount === 833.33)).toBe(true)
    expect(s[s.length - 1].amount).toBe(833.37)
  })

  it('makes a monthly booking one month up front and then monthly', () => {
    const s = buildSchedule({ rentalMode: 'TEMP_STAY', checkIn: day('2027-03-10'), units: 4, subtotal: 3800, damageDeposit: 300, advanceMonthsRequired: 6 })
    expect(s.map((r) => [r.sequence, r.amount, r.depositAmount, dayKey(r.dueDate)])).toEqual([
      [1, 950, 300, '2027-03-10'], [2, 950, 0, '2027-04-10'], [3, 950, 0, '2027-05-10'], [4, 950, 0, '2027-06-10'],
    ])
  })

  it('is a single payment for a one-month booking', () => {
    const s = buildSchedule({ rentalMode: 'TEMP_STAY', checkIn: day('2027-03-10'), units: 1, subtotal: 950, damageDeposit: 300, advanceMonthsRequired: null })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ amount: 950, depositAmount: 300 })
    expect(dayKey(s[0].periodEnd)).toBe('2027-04-10')
  })

  it('keeps to the move-in day of the month, falling back to the last day of a shorter month', () => {
    const s = buildSchedule({ rentalMode: 'TEMP_STAY', checkIn: day('2027-01-31'), units: 4, subtotal: 4000, damageDeposit: 0, advanceMonthsRequired: null })
    // Not 28 Feb, 28 Mar, 28 Apr: each month is counted from the move-in day
    expect(s.map((r) => dayKey(r.dueDate))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
    expect(dayKey(s[3].periodEnd)).toBe('2027-05-31')
  })

  it('handles a move-in on 29 February', () => {
    const s = buildSchedule({ rentalMode: 'PERMANENT', checkIn: day('2028-02-29'), units: 1, subtotal: 12_000, damageDeposit: 0, advanceMonthsRequired: 1 })
    expect(dayKey(s[1].dueDate)).toBe('2028-03-29')
    expect(dayKey(s[11].periodEnd)).toBe('2029-02-28')
  })

  it('stores every date at 12:00 UTC, like every stay date', () => {
    for (const r of yearly()) {
      for (const d of [r.periodStart, r.periodEnd, r.dueDate]) expect(d.toISOString().slice(11)).toBe('12:00:00.000Z')
    }
  })

  it('brings a listing value outside the limits inside them', () => {
    expect(yearly({ advanceMonthsRequired: 12 })).toHaveLength(7)   // six up front, six monthly
    expect(yearly({ advanceMonthsRequired: 12 })[0].amount).toBe(6000)
    expect(yearly({ advanceMonthsRequired: null })[0].amount).toBe(3000)
  })

  it('works out the months and the monthly rent from the booking', () => {
    expect(tenancyMonths('PERMANENT', 1)).toBe(12)
    expect(tenancyMonths('TEMP_STAY', 7)).toBe(7)
    expect(monthlyRent('PERMANENT', 12_000)).toBe(1000)
    expect(monthlyRent('TEMP_STAY', 950)).toBe(950)
  })

  it('sums up as the few figures a price breakdown shows', () => {
    expect(rentPlan(yearly(), 12)).toEqual({
      firstRent: 3000, deposit: 500, dueNow: 3500, advanceMonths: 3, laterCount: 9, laterAmount: 1000, firstLaterDue: day('2027-04-15'),
    })
    expect(rentPlan([], 12)).toBeNull()
    expect(rentPlan(null, 12)).toBeNull()
  })
})

describe('late, and the grace day', () => {
  const due = day('2027-04-15')
  const owed = { status: 'PENDING', dueDate: due }

  it('counts calendar days in Ghana from the due date', () => {
    expect(daysPastDue(due, new Date('2027-04-12T23:59:00Z'))).toBe(-3)
    expect(daysPastDue(due, new Date('2027-04-15T00:00:00Z'))).toBe(0)
    expect(daysPastDue(due, new Date('2027-04-15T23:59:59Z'))).toBe(0)
    expect(daysPastDue(due, new Date('2027-04-16T00:00:00Z'))).toBe(1)
  })

  it('is not late on the due day or the day after', () => {
    expect(isOverdue(owed, new Date('2027-04-15T23:00:00Z'))).toBe(false)
    expect(isOverdue(owed, new Date('2027-04-16T23:59:59Z'))).toBe(false)
  })

  it('is late from the second day after the due date', () => {
    expect(isOverdue(owed, new Date('2027-04-17T00:00:00Z'))).toBe(true)
  })

  it('is never late once settled or no longer owed', () => {
    const later = new Date('2027-06-01T00:00:00Z')
    for (const status of ['PAID', 'COVERED', 'CANCELLED']) expect(isOverdue({ status, dueDate: due }, later)).toBe(false)
    expect(isOverdue({ status: 'PART_COVERED', dueDate: due }, later)).toBe(true)
  })
})

describe('reminders', () => {
  const due = day('2027-04-15')
  const on = (key: string) => reminderKind(due, new Date(`${key}T08:00:00Z`))

  it('go out three days before and on the day', () => {
    expect(on('2027-04-12')).toBe('DUE_SOON')
    expect(on('2027-04-15')).toBe('DUE_TODAY')
  })

  it('say nothing on the other days before, or on the grace day', () => {
    for (const key of ['2027-04-10', '2027-04-11', '2027-04-13', '2027-04-14', '2027-04-16']) expect(on(key), key).toBeNull()
  })

  it('are daily from the day after the grace day to 14 days after the due date', () => {
    expect(OVERDUE_REMINDER_DAYS).toBe(14)
    expect(on('2027-04-17')).toBe('OVERDUE')
    expect(on('2027-04-23')).toBe('OVERDUE')
    expect(on('2027-04-29')).toBe('OVERDUE')
  })

  it('then stop, and the admins are told', () => {
    expect(on('2027-04-30')).toBe('STOPPED')
    expect(on('2027-05-20')).toBe('STOPPED')
  })
})

describe('what can be paid', () => {
  const afterMoveIn = new Date('2027-01-15T00:30:00Z')
  const refusal = (instalment: { sequence: number; status: string }, all = rows(), booking: Partial<typeof standing> = {}, now = afterMoveIn) =>
    laterInstalmentRefusal({ instalment, instalments: all, booking: { ...standing, ...booking }, now })

  it('is the earliest instalment still owed, and only that one', () => {
    const all = rows()
    expect(nextPayable(all)?.sequence).toBe(2)
    expect(refusal(all[1], all)).toBeNull()
    expect(refusal(all[2], all)).toBe(RENT_PAY_IN_ORDER)
    expect(refusal(all[9], all)).toBe(RENT_PAY_IN_ORDER)
  })

  it('moves on one at a time as each is settled', () => {
    const all = rows(3)
    expect(nextPayable(all)?.sequence).toBe(4)
    expect(refusal(all[3], all)).toBeNull()
    expect(nextPayable(rows(10))).toBeNull()
  })

  it('is refused before the move-in day, and allowed from it', () => {
    const all = rows()
    expect(refusal(all[1], all, {}, new Date('2027-01-14T23:59:59Z'))).toBe(RENT_AFTER_MOVE_IN)
    expect(refusal(all[1], all, {}, new Date('2027-01-15T00:00:00Z'))).toBeNull()
  })

  it('can be paid before it falls due, once the tenant has moved in', () => {
    const all = rows()
    // Due on 15 April: paid on 20 January
    expect(refusal(all[1], all, {}, new Date('2027-01-20T10:00:00Z'))).toBeNull()
  })

  it('is refused once settled, cancelled, or on a tenancy that does not stand', () => {
    const all = rows()
    expect(refusal({ ...all[1], status: 'PAID' }, all)).toBe(RENT_ALREADY_SETTLED)
    expect(refusal({ ...all[1], status: 'COVERED' }, all)).toBe(RENT_ALREADY_SETTLED)
    expect(refusal({ ...all[1], status: 'CANCELLED' }, all)).toBe(RENT_NOT_PAYABLE)
    expect(refusal(all[1], all, { status: 'CANCELLED' })).toBe(RENT_NOT_PAYABLE)
    expect(refusal(all[1], all, { paymentStatus: 'UNPAID' })).toBe(RENT_FIRST_PAYMENT_FIRST)
    expect(refusal(all[1], all, { status: 'PENDING', paymentStatus: 'UNPAID' })).toBe(RENT_NOT_PAYABLE)
    expect(refusal(all[1], all, { paymentStatus: 'REFUNDED' })).toBe(RENT_NOT_PAYABLE)
  })

  it('charges the whole of what is owed: rent and deposit, less anything taken from the deposit', () => {
    const all = rows(0)
    expect(outstanding(all[0])).toBe(3500)
    expect(outstanding(all[1])).toBe(1000)
    expect(outstanding({ ...all[1], status: 'PART_COVERED', coveredFromDeposit: 400 })).toBe(600)
    expect(outstanding({ ...all[1], status: 'PAID' })).toBe(0)
    expect(outstanding({ ...all[1], status: 'CANCELLED' })).toBe(0)
  })

  it('tells a card where the rent stands', () => {
    const before = { ...standing, paymentStatus: 'UNPAID' }
    expect(rentStatus(rows(0), before)).toEqual({ kind: 'FIRST', amount: 3500 })
    expect(rentStatus(rows(1), standing, new Date('2027-04-20T08:00:00Z'))).toMatchObject({ kind: 'NEXT', amount: 1000, overdue: true, payable: true })
    expect(rentStatus(rows(1), standing, new Date('2027-01-10T08:00:00Z'))).toMatchObject({ kind: 'NEXT', overdue: false, payable: false })
    expect(rentStatus(rows(10), standing)).toEqual({ kind: 'DONE' })
    expect(rentStatus([], standing)).toBeNull()
    expect(rentStatus(rows(1), { ...standing, status: 'CANCELLED' })).toBeNull()
  })
})

describe('when the host is paid', () => {
  const checkIn = day('2027-01-15')
  const DELAY = 48 * HOUR

  it('is 48 hours after move-in for the first payment, however early it was paid', () => {
    const first = { sequence: 1, dueDate: checkIn, paidAt: new Date('2027-01-02T09:00:00Z') }
    expect(payoutReleaseAt(first, checkIn, DELAY).toISOString()).toBe('2027-01-17T12:00:00.000Z')
  })

  it('is the due date for a later month paid early', () => {
    const early = { sequence: 2, dueDate: day('2027-04-15'), paidAt: new Date('2027-01-20T09:00:00Z') }
    expect(payoutReleaseAt(early, checkIn, DELAY).toISOString()).toBe('2027-04-15T12:00:00.000Z')
  })

  it('is the day it was paid for a later month paid late', () => {
    const late = { sequence: 2, dueDate: day('2027-04-15'), paidAt: new Date('2027-04-22T16:30:00Z') }
    expect(payoutReleaseAt(late, checkIn, DELAY).toISOString()).toBe('2027-04-22T16:30:00.000Z')
  })
})

describe('covering a missed payment from the deposit', () => {
  const late = new Date('2027-04-20T09:00:00Z')
  const quote = (all = rows(), seq = 2, over: Partial<Parameters<typeof coverQuote>[0]> = {}) =>
    coverQuote({ instalment: all[seq - 1], instalments: all, booking: standing, now: late, ...over })

  it('takes the whole deposit when the rent is more, and leaves the rest owed', () => {
    expect(quote()).toEqual({ ok: true, cover: 500, shortfall: 500, depositLeftAfter: 0, status: 'PART_COVERED' })
  })

  it('settles the payment when the deposit covers it, and keeps what is left', () => {
    const q = coverQuote({ instalment: rows()[1], instalments: rows(), booking: { ...standing, damageDeposit: 1800 }, now: late })
    expect(q).toEqual({ ok: true, cover: 1000, shortfall: 0, depositLeftAfter: 800, status: 'COVERED' })
  })

  it('never takes more than is left after an earlier cover or a refund of the deposit', () => {
    const all = rows(1, { 2: { status: 'COVERED', coveredFromDeposit: 1000 } })
    const q = coverQuote({ instalment: all[2], instalments: all, booking: { ...standing, damageDeposit: 1800 }, now: new Date('2027-05-20T09:00:00Z') })
    expect(q).toMatchObject({ ok: true, cover: 800, shortfall: 200, depositLeftAfter: 0, status: 'PART_COVERED' })
    expect(depositLeft(1800, all, 300)).toBe(500)
    expect(depositLeft(500, rows(), 500)).toBe(0)
  })

  it('has nothing to take from before the first payment, which carries the deposit, is paid', () => {
    expect(depositLeft(500, rows(0))).toBe(0)
    expect(depositLeft(500, rows(1))).toBe(500)
  })

  it('is refused for anything but a late, unpaid payment after the first on a tenancy that stands', () => {
    const message = (q: ReturnType<typeof quote>) => (q.ok ? 'ok' : q.error)
    expect(message(quote(rows(0), 1))).toMatch(/first payment carries the deposit/)
    expect(message(quote(rows(2), 2))).toMatch(/already been settled/)
    expect(message(quote(rows(1, { 2: { status: 'CANCELLED' } }), 2))).toMatch(/no longer owed/)
    expect(message(quote(rows(), 2, { booking: { ...standing, status: 'CANCELLED' } }))).toMatch(/no longer stands/)
    // In the grace day: not late yet
    expect(message(quote(rows(), 2, { now: new Date('2027-04-16T20:00:00Z') }))).toMatch(/Only a late payment/)
    expect(message(quote(rows(), 2, { paymentInProgress: true }))).toMatch(/payment in progress/)
    expect(message(quote(rows(), 2, { booking: { ...standing, damageDeposit: 0 } }))).toMatch(/no deposit left/)
    expect(message(quote(rows(), 2, { depositRefunded: 500 }))).toMatch(/no deposit left/)
  })
})

describe('ending a tenancy early', () => {
  const now = new Date('2027-06-20T09:00:00Z')
  const end = (all = rows(3), booking: Partial<typeof standing & { endedEarlyAt: Date | null }> = {}, at = now) =>
    endTenancyQuote({ booking: { ...standing, ...booking }, instalments: all, now: at })

  it('ends at the end of the last month paid for', () => {
    // The advance (to 15 April) and two more months
    expect(end()).toEqual({ ok: true, endsOn: day('2027-06-15') })
    expect(end(rows(1))).toEqual({ ok: true, endsOn: day('2027-04-15') })
  })

  it('counts a month covered in full from the deposit, and not one only part covered', () => {
    expect(end(rows(2, { 3: { status: 'COVERED' } }))).toEqual({ ok: true, endsOn: day('2027-06-15') })
    expect(end(rows(2, { 3: { status: 'PART_COVERED', coveredFromDeposit: 400 } }))).toEqual({ ok: true, endsOn: day('2027-05-15') })
  })

  it('does not count a month paid out of order beyond a gap', () => {
    expect(end(rows(2, { 4: { status: 'PAID' } }))).toEqual({ ok: true, endsOn: day('2027-05-15') })
  })

  it('is refused before move-in, with nothing paid, when already ended, or with nothing left to end', () => {
    const message = (q: ReturnType<typeof end>) => (q.ok ? 'ok' : q.error)
    expect(message(end(rows(1), {}, new Date('2027-01-14T23:00:00Z')))).toMatch(/has not moved in yet/)
    expect(message(end(rows(0), { paymentStatus: 'UNPAID' }))).toMatch(/cannot be ended/)
    expect(message(end(rows(3), { endedEarlyAt: now }))).toMatch(/already been ended/)
    expect(message(end(rows(10)))).toMatch(/nothing to end early/)
    expect(message(end(rows(3), { status: 'CANCELLED' }))).toMatch(/cannot be ended/)
    expect(message(end(rows(3), { status: 'COMPLETED' }))).toMatch(/cannot be ended/)
    expect(message(end([]))).toMatch(/Only a tenancy paid in instalments/)
  })
})

describe('money received', () => {
  it('counts settled instalments in full and whatever the deposit covered of the rest', () => {
    expect(rentReceived(rows(0))).toBe(0)
    expect(rentReceived(rows(1))).toBe(3000)
    expect(rentReceived(rows(3))).toBe(5000)
    expect(rentReceived(rows(2, { 3: { status: 'COVERED', coveredFromDeposit: 1000 } }))).toBe(5000)
    expect(rentReceived(rows(2, { 3: { status: 'PART_COVERED', coveredFromDeposit: 400 } }))).toBe(4400)
    // Part covered, then the tenancy was ended: the part still counts
    expect(rentReceived(rows(2, { 3: { status: 'CANCELLED', coveredFromDeposit: 400 } }))).toBe(4400)
  })

  it('works a refund before move-in out from the first payment, not the whole tenancy', () => {
    expect(refundableRent(12_000, rows(1))).toBe(3000)
    // A booking with no instalments: the stay price, as before
    expect(refundableRent(400, [])).toBe(400)
  })
})

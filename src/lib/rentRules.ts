// Rent instalments for monthly and long-term bookings: how much is paid up
// front, when each later payment falls due, when one is late, and what an
// admin may take from the damage deposit for a missed one. Pure rules, no
// database and no network, so the routes, the jobs and the pages all read the
// same thing.
//
// A long stay is paid in instalments. The first covers the months paid in
// advance and carries the damage deposit; it is what confirms the booking.
// Each later one covers one month and falls due on the day that month starts.
// Short stays have no instalments, and neither does any booking made before
// instalments existed: those are paid in one payment, as they always were.
//
// Dates follow lib/stayDates.ts: calendar days stored at 12:00 UTC, with
// today's date in Ghana as "today".
//
// Nothing here is advice about the law.

import { dayKey, parseDay } from '@/lib/hostCalendar'
import { addMonthsClamped, daysBetween, ghanaToday } from '@/lib/stayDates'

/** The most months of rent a host may ask for up front. */
export const MAX_ADVANCE_MONTHS = 6
/** What a long-term listing asks for when its host has not chosen. */
export const DEFAULT_ADVANCE_MONTHS = 3
/** A tenancy this long or shorter may ask for at most SHORT_TENANCY_MAX_ADVANCE months up front. */
export const SHORT_TENANCY_MONTHS = 6
export const SHORT_TENANCY_MAX_ADVANCE = 2
/** A monthly booking pays one month up front. */
export const MONTHLY_ADVANCE_MONTHS = 1

/** Days after the due date before a payment counts as late. */
export const RENT_GRACE_DAYS = 1
/** A reminder goes out this many days before a payment falls due. */
export const REMINDER_DAYS_BEFORE = 3
/** Late reminders are sent daily up to this many days after the due date, then stop. */
export const OVERDUE_REMINDER_DAYS = 14

const cents = (n: number) => Math.round(n * 100) / 100

// ── The advance ────────────────────────────────────────────────────────────

/** True for a whole number of months a host may set: 1 to MAX_ADVANCE_MONTHS. */
export function isAdvanceMonths(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ADVANCE_MONTHS
}

export const ADVANCE_MONTHS_ERROR = `Advance rent must be a whole number of months from 1 to ${MAX_ADVANCE_MONTHS}`

/**
 * What a listing form sent for the advance, as the value to store. Nothing
 * (null, undefined, an empty string) stores null, which means the default.
 * Anything else must be a whole number from 1 to MAX_ADVANCE_MONTHS.
 */
export function parseAdvanceMonths(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  return isAdvanceMonths(n) ? { ok: true, value: n } : { ok: false, error: ADVANCE_MONTHS_ERROR }
}

/** How many months a booking runs for: a long-term rental is a year per unit. */
export function tenancyMonths(rentalMode: string, units: number): number {
  return rentalMode === 'PERMANENT' ? units * 12 : units
}

/** One month's rent, from the price the booking was made at. */
export function monthlyRent(rentalMode: string, pricePerUnit: number): number {
  return rentalMode === 'PERMANENT' ? pricePerUnit / 12 : pricePerUnit
}

/**
 * The months of rent paid up front. Worked out on the server when a booking is
 * made; a stored listing value outside the limits is brought inside them here,
 * so no booking can be made with more than the rules allow.
 *
 *  - Monthly: one month.
 *  - Long-term: the listing's own number, or DEFAULT_ADVANCE_MONTHS, never more
 *    than MAX_ADVANCE_MONTHS; and never more than SHORT_TENANCY_MAX_ADVANCE when
 *    the tenancy is SHORT_TENANCY_MONTHS or shorter.
 *  - Never more than the tenancy itself.
 */
export function advanceMonths(rentalMode: string, months: number, listingSetting: number | null | undefined): number {
  if (rentalMode !== 'PERMANENT') return Math.min(MONTHLY_ADVANCE_MONTHS, months)
  const asked = isAdvanceMonths(listingSetting) ? listingSetting
    : typeof listingSetting === 'number' && listingSetting > MAX_ADVANCE_MONTHS ? MAX_ADVANCE_MONTHS
    : DEFAULT_ADVANCE_MONTHS
  const cap = months <= SHORT_TENANCY_MONTHS ? SHORT_TENANCY_MAX_ADVANCE : MAX_ADVANCE_MONTHS
  return Math.max(1, Math.min(asked, cap, months))
}

/** The advance a listing asks for on a one-year tenancy, for showing on its page. */
export function listingAdvanceMonths(listingSetting: number | null | undefined): number {
  return advanceMonths('PERMANENT', 12, listingSetting)
}

// ── The schedule ───────────────────────────────────────────────────────────

export type ScheduleRow = {
  sequence: number
  periodStart: Date
  periodEnd: Date
  dueDate: Date
  /** Rent only, in USD */
  amount: number
  /** The damage deposit, on the first instalment only */
  depositAmount: number
}

export function usesInstalments(rentalMode: string): boolean {
  return rentalMode === 'TEMP_STAY' || rentalMode === 'PERMANENT'
}

/**
 * Every instalment of a booking. The rent is split in whole cents and the last
 * instalment takes what is left over, so the amounts add up to `subtotal`
 * exactly. Each month starts on the check-in day of the month, or on the last
 * day of a month that does not have it.
 */
export function buildSchedule({
  rentalMode, checkIn, units, subtotal, damageDeposit, advanceMonthsRequired,
}: {
  rentalMode: string
  checkIn: Date
  units: number
  subtotal: number
  damageDeposit: number
  advanceMonthsRequired: number | null | undefined
}): ScheduleRow[] {
  if (!usesInstalments(rentalMode)) return []
  const months = tenancyMonths(rentalMode, units)
  if (!Number.isInteger(months) || months < 1) throw new Error(`A tenancy of ${months} months cannot be scheduled`)
  const advance = advanceMonths(rentalMode, months, advanceMonthsRequired)

  const totalCents = Math.round(subtotal * 100)
  const perMonth = Math.floor(totalCents / months)
  const rows: ScheduleRow[] = []
  let allotted = 0
  const count = months - advance + 1
  for (let sequence = 1; sequence <= count; sequence++) {
    const firstMonth = sequence === 1 ? 0 : advance + sequence - 2
    const covered = sequence === 1 ? advance : 1
    const rentCents = sequence === count ? totalCents - allotted : perMonth * covered
    allotted += rentCents
    const periodStart = addMonthsClamped(checkIn, firstMonth)
    rows.push({
      sequence,
      periodStart,
      periodEnd: addMonthsClamped(checkIn, firstMonth + covered),
      dueDate: periodStart,
      amount: rentCents / 100,
      depositAmount: sequence === 1 ? cents(damageDeposit) : 0,
    })
  }
  return rows
}

// ── Where an instalment stands ─────────────────────────────────────────────

/** Not settled yet: money is still owed on it. */
export const OPEN_INSTALMENT_STATUSES = ['PENDING', 'PART_COVERED']
/** Settled in full, by a payment or from the deposit. */
export const SETTLED_INSTALMENT_STATUSES = ['PAID', 'COVERED']

export type InstalmentState = {
  id?: string
  sequence: number
  status: string
  dueDate: Date | string
  periodStart?: Date | string
  periodEnd: Date | string
  amount: number
  depositAmount: number
  coveredFromDeposit: number
}

export const isOpen = (i: { status: string }) => OPEN_INSTALMENT_STATUSES.includes(i.status)
export const isSettled = (i: { status: string }) => SETTLED_INSTALMENT_STATUSES.includes(i.status)

/** What is still owed on an instalment, in USD: rent and deposit, less anything covered from the deposit. */
export function outstanding(i: Pick<InstalmentState, 'status' | 'amount' | 'depositAmount' | 'coveredFromDeposit'>): number {
  return isOpen(i) ? Math.max(0, cents(i.amount + i.depositAmount - i.coveredFromDeposit)) : 0
}

/** Calendar days from the due date to today in Ghana: negative before it, 0 on the day. */
export function daysPastDue(dueDate: Date | string, now: Date = new Date()): number {
  return daysBetween(parseDay(dayKey(new Date(dueDate)))!, parseDay(ghanaToday(now))!)
}

/** Late: still owed once the grace day after the due date has passed. */
export function isOverdue(i: Pick<InstalmentState, 'status' | 'dueDate'>, now: Date = new Date()): boolean {
  return isOpen(i) && daysPastDue(i.dueDate, now) > RENT_GRACE_DAYS
}

/** The one instalment that can be paid next: the earliest still owed. */
export function nextPayable<T extends { sequence: number; status: string }>(instalments: T[]): T | null {
  return [...instalments].sort((a, b) => a.sequence - b.sequence).find(isOpen) ?? null
}

export const RENT_AFTER_MOVE_IN = 'The next rent payment can be made from your move-in day.'
export const RENT_PAY_IN_ORDER = 'Rent is paid one instalment at a time, in order. Please pay the earliest one first.'
export const RENT_ALREADY_SETTLED = 'This rent payment has already been settled.'
export const RENT_NOT_PAYABLE = 'This rent payment can no longer be made. Please contact support at support@fiegh.com.'
export const RENT_FIRST_PAYMENT_FIRST = 'The first payment has to be made before any later rent can be paid.'

/**
 * Why a rent instalment after the first cannot be paid right now, or null when
 * it can. The first instalment is the booking's own first payment and follows
 * the booking's rules (lib/payDeadline.ts).
 */
export function laterInstalmentRefusal({
  instalment, instalments, booking, now = new Date(),
}: {
  instalment: { id?: string; sequence: number; status: string }
  instalments: { id?: string; sequence: number; status: string }[]
  booking: { status: string; paymentStatus: string; checkIn: Date | string }
  now?: Date
}): string | null {
  if (isSettled(instalment)) return RENT_ALREADY_SETTLED
  if (!isOpen(instalment)) return RENT_NOT_PAYABLE
  // Confirmed but not yet paid for: the first payment comes first
  if (booking.status === 'CONFIRMED' && booking.paymentStatus === 'UNPAID') return RENT_FIRST_PAYMENT_FIRST
  if (!tenancyStands(booking)) return RENT_NOT_PAYABLE
  // Only once the tenant has moved in
  if (ghanaToday(now) < dayKey(new Date(booking.checkIn))) return RENT_AFTER_MOVE_IN
  // One at a time and in order: no skipping ahead, no paying part of one
  if (nextPayable(instalments)?.sequence !== instalment.sequence) return RENT_PAY_IN_ORDER
  return null
}

/** A tenancy that was paid for and has not been cancelled: rent can still be owed and paid on it. */
export function tenancyStands(booking: { status: string; paymentStatus: string }): boolean {
  return (booking.status === 'CONFIRMED' || booking.status === 'COMPLETED')
    && (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'PARTIALLY_REFUNDED')
}

// ── What a page shows ──────────────────────────────────────────────────────

export type RentStatus<T> =
  | { kind: 'FIRST'; amount: number }   // not paid yet: the first payment is what is due
  | { kind: 'NEXT'; instalment: T; amount: number; overdue: boolean; payable: boolean }
  | { kind: 'DONE' }                    // every instalment is settled

/**
 * Where the rent on a booking stands, for a card or a summary: the first
 * payment still to make, the next instalment owed, or nothing left to pay.
 * Null for a booking with no instalments, or one that no longer stands.
 */
export function rentStatus<T extends InstalmentState>(
  instalments: T[] | null | undefined,
  booking: { status: string; paymentStatus: string; checkIn: Date | string },
  now: Date = new Date(),
): RentStatus<T> | null {
  if (!instalments || instalments.length === 0) return null
  const first = instalments.find((i) => i.sequence === 1)
  if (booking.paymentStatus === 'UNPAID') {
    return first && (booking.status === 'PENDING' || booking.status === 'CONFIRMED') ? { kind: 'FIRST', amount: outstanding(first) } : null
  }
  if (!tenancyStands(booking)) return null
  const next = nextPayable(instalments)
  if (!next) return { kind: 'DONE' }
  return {
    kind: 'NEXT', instalment: next, amount: outstanding(next), overdue: isOverdue(next, now),
    payable: laterInstalmentRefusal({ instalment: next, instalments, booking, now }) === null,
  }
}

export type RentPlan = {
  /** Rent in the first payment */
  firstRent: number
  deposit: number
  dueNow: number
  advanceMonths: number
  /** Payments after the first */
  laterCount: number
  /** One month's rent (the last payment can differ by a few cents) */
  laterAmount: number
  firstLaterDue: Date | null
}

/** A schedule in the few figures a price breakdown needs. Null when there is none. */
export function rentPlan(
  rows: { sequence: number; amount: number; depositAmount: number; dueDate: Date | string }[] | null | undefined,
  months: number,
): RentPlan | null {
  if (!rows || rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence)
  const [first, second] = sorted
  return {
    firstRent: first.amount,
    deposit: first.depositAmount,
    dueNow: cents(first.amount + first.depositAmount),
    advanceMonths: months - (sorted.length - 1),
    laterCount: sorted.length - 1,
    laterAmount: second?.amount ?? 0,
    firstLaterDue: second ? new Date(second.dueDate) : null,
  }
}

// ── Reminders ──────────────────────────────────────────────────────────────

export type ReminderKind =
  | 'DUE_SOON'    // REMINDER_DAYS_BEFORE days before the due date
  | 'DUE_TODAY'
  | 'OVERDUE'     // daily, from the day after the grace day to OVERDUE_REMINDER_DAYS after the due date
  | 'STOPPED'     // reminders have ended: one alert to the admins

/** Which reminder an unpaid instalment gets today, if any. */
export function reminderKind(dueDate: Date | string, now: Date = new Date()): ReminderKind | null {
  const days = daysPastDue(dueDate, now)
  if (days === -REMINDER_DAYS_BEFORE) return 'DUE_SOON'
  if (days === 0) return 'DUE_TODAY'
  if (days > RENT_GRACE_DAYS && days <= OVERDUE_REMINDER_DAYS) return 'OVERDUE'
  if (days > OVERDUE_REMINDER_DAYS) return 'STOPPED'
  return null
}

// ── Payouts ────────────────────────────────────────────────────────────────

/**
 * When the host's share of a settled instalment may be sent. The first waits
 * `firstDelayMs` after move-in, like a short stay, so it never goes out while
 * the guest can still report a problem. Each later one goes on the later of
 * the day it was paid and the day it fell due.
 */
export function payoutReleaseAt(
  instalment: { sequence: number; dueDate: Date; paidAt: Date | null },
  checkIn: Date,
  firstDelayMs: number,
): Date {
  const earliest = instalment.sequence === 1 ? checkIn.getTime() + firstDelayMs : instalment.dueDate.getTime()
  return new Date(Math.max(earliest, instalment.paidAt?.getTime() ?? 0))
}

// ── Money received ─────────────────────────────────────────────────────────

/**
 * Rent actually received so far on a booking: instalments settled in full,
 * and whatever was taken from the deposit towards one that never was.
 */
export function rentReceived(instalments: Pick<InstalmentState, 'status' | 'amount' | 'coveredFromDeposit'>[]): number {
  return cents(instalments.reduce((sum, i) => sum + (isSettled(i) ? i.amount : i.coveredFromDeposit), 0))
}

/**
 * The rent a refund before move-in is worked out from. Only the first
 * instalment can have been paid by then, so for a booking with instalments it
 * is that instalment's rent, not the rent for the whole tenancy.
 */
export function refundableRent(subtotal: number, instalments: Pick<InstalmentState, 'sequence' | 'amount'>[]): number {
  const first = instalments.find((i) => i.sequence === 1)
  return first ? first.amount : subtotal
}

// ── Covering a missed payment from the deposit ─────────────────────────────

/** What is left of the damage deposit: what was paid, less what has gone back to the guest or been used for rent. */
export function depositLeft(
  damageDeposit: number,
  instalments: Pick<InstalmentState, 'sequence' | 'status' | 'coveredFromDeposit'>[],
  depositRefunded = 0,
): number {
  // Held only once the first instalment, which carries it, has been paid
  const first = instalments.find((i) => i.sequence === 1)
  if (!first || first.status !== 'PAID') return 0
  const used = instalments.reduce((sum, i) => sum + i.coveredFromDeposit, 0)
  return Math.max(0, cents(damageDeposit - used - depositRefunded))
}

export type CoverQuote =
  | { ok: false; error: string }
  | {
      ok: true
      /** Taken from the deposit for this instalment, in USD */
      cover: number
      /** Still owed by the tenant on this instalment afterwards */
      shortfall: number
      depositLeftAfter: number
      status: 'COVERED' | 'PART_COVERED'
    }

/**
 * What covering a missed rent payment from the deposit would do. Only a late
 * instalment after the first, on a tenancy that stands, with deposit left and
 * no payment in progress on it. Takes the smaller of what is owed and what is
 * left; anything it cannot cover stays owed.
 */
export function coverQuote({
  instalment, instalments, booking, depositRefunded = 0, paymentInProgress = false, now = new Date(),
}: {
  instalment: InstalmentState
  instalments: InstalmentState[]
  booking: { status: string; paymentStatus: string; damageDeposit: number }
  depositRefunded?: number
  paymentInProgress?: boolean
  now?: Date
}): CoverQuote {
  if (instalment.sequence === 1) return { ok: false, error: 'The first payment carries the deposit itself, so it cannot be covered from it' }
  if (isSettled(instalment)) return { ok: false, error: 'This payment has already been settled' }
  if (!isOpen(instalment)) return { ok: false, error: 'This payment is no longer owed' }
  if (!tenancyStands(booking)) return { ok: false, error: 'This tenancy no longer stands, so nothing can be covered on it' }
  if (!isOverdue(instalment, now)) return { ok: false, error: 'Only a late payment can be covered from the deposit' }
  if (paymentInProgress) return { ok: false, error: 'The tenant has a payment in progress on this instalment. Try again once it has finished.' }

  const left = depositLeft(booking.damageDeposit, instalments, depositRefunded)
  if (left <= 0) return { ok: false, error: 'There is no deposit left on this booking' }
  const owed = outstanding(instalment)
  const cover = Math.min(owed, left)
  const shortfall = cents(owed - cover)
  return { ok: true, cover, shortfall, depositLeftAfter: cents(left - cover), status: shortfall > 0 ? 'PART_COVERED' : 'COVERED' }
}

// ── Ending a tenancy early ─────────────────────────────────────────────────

export type EndTenancy =
  | { ok: false; error: string }
  | { ok: true; endsOn: Date }

/**
 * Where a tenancy ends when a host or an admin ends it: the end of the last
 * month that has been paid for or covered. Nothing is refunded, and the months
 * not yet paid are no longer owed.
 */
export function endTenancyQuote({
  booking, instalments, now = new Date(),
}: {
  booking: { status: string; paymentStatus: string; checkIn: Date; checkOut: Date; endedEarlyAt?: Date | null }
  instalments: Pick<InstalmentState, 'sequence' | 'status' | 'periodEnd'>[]
  now?: Date
}): EndTenancy {
  if (instalments.length === 0) return { ok: false, error: 'Only a tenancy paid in instalments can be ended this way' }
  if (booking.endedEarlyAt) return { ok: false, error: 'This tenancy has already been ended' }
  if (booking.status !== 'CONFIRMED' || !tenancyStands(booking)) {
    return { ok: false, error: `A tenancy that is ${booking.status.toLowerCase()}${booking.status === 'CONFIRMED' ? ' and not paid' : ''} cannot be ended` }
  }
  if (ghanaToday(now) < dayKey(booking.checkIn)) {
    return { ok: false, error: 'The tenant has not moved in yet. Cancel the booking instead.' }
  }
  // In order from the start: the months paid or covered without a gap
  let endsOn: Date | null = null
  for (const i of [...instalments].sort((a, b) => a.sequence - b.sequence)) {
    if (!isSettled(i)) break
    endsOn = new Date(i.periodEnd)
  }
  if (!endsOn) return { ok: false, error: 'No rent has been paid on this tenancy' }
  if (endsOn.getTime() >= booking.checkOut.getTime()) return { ok: false, error: 'Every month of this tenancy has been paid for, so there is nothing to end early' }
  return { ok: true, endsOn }
}

// ── Wording ────────────────────────────────────────────────────────────────

const monthsText = (n: number) => `${n} month${n === 1 ? '' : 's'}`

/** "3 months' rent up front, then monthly", from the same numbers the schedule uses. */
export function advanceSummary(rentalMode: string, months: number, listingSetting: number | null | undefined): string {
  const advance = advanceMonths(rentalMode, months, listingSetting)
  if (advance >= months) return months === 1 ? "One month's rent, paid up front." : `${monthsText(months)}' rent, paid up front.`
  return `${advance === 1 ? "One month's" : `${monthsText(advance)}'`} rent up front, then monthly.`
}

/** The rule shown to a host choosing the advance. */
export const ADVANCE_RULE_NOTE =
  `You can ask for 1 to ${MAX_ADVANCE_MONTHS} months' rent up front. A tenancy of ${SHORT_TENANCY_MONTHS} months or less is limited to ${SHORT_TENANCY_MAX_ADVANCE} months. After that the tenant pays monthly.`

export const RENT_REMINDER_NOTE =
  `We remind you ${REMINDER_DAYS_BEFORE} days before each payment and on the day. Nothing is taken automatically: you pay each one yourself.`

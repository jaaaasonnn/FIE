import { beforeEach, describe, expect, it, vi } from 'vitest'

// The pure rules need nothing mocked. The decision code below them runs
// against an in-memory stand-in for the database and a mocked fetch.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  disputes: [] as Row[], refunds: [] as Row[], events: [] as Row[], notifications: [] as Row[], writes: 0,
  booking: {} as Row, payments: [] as Row[], payouts: [] as Row[],
  // Makes the next read miss a refund that is really there, as when one is
  // recorded between working a decision out and writing it
  missRefundOnce: false,
}))
const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)
// Messages are covered by lib/messaging tests; here notify() is only a call that must not get in the way
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))
const sendRefund = vi.hoisted(() => vi.fn(async () => ({ sent: false, skipped: 'REFUNDS_ENABLED is not set to true' })))
vi.mock('@/lib/refunds', () => ({ sendRefund }))

vi.mock('@/lib/db', async () => {
  const { Prisma } = await import('@prisma/client')
  // Each transaction keeps its own undo list, so one that fails takes back
  // only what it wrote itself, as a real database does
  const makeTx = (undo: (() => void)[]) => ({
    dispute: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        await new Promise((r) => setTimeout(r, 0))
        const rows = state.disputes.filter((d) => d.id === where.id && (where.status as { in: string[] }).in.includes(d.status as string))
        rows.forEach((d) => { const before = { ...d }; Object.assign(d, data); undo.push(() => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, before) }) })
        state.writes += rows.length
        return { count: rows.length }
      },
    },
    refund: {
      create: async ({ data }: { data: Row }) => {
        if (state.refunds.some((r) => r.bookingId === data.bookingId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
        }
        const row = { id: `refund_${state.refunds.length + 1}`, status: 'PENDING', ...data }
        state.refunds.push(row)
        undo.push(() => { state.refunds.splice(state.refunds.indexOf(row), 1) })
        state.writes++
        return row
      },
    },
    disputeEvent: { create: async ({ data }: { data: Row }) => { state.events.push(data); undo.push(() => { state.events.splice(state.events.indexOf(data), 1) }); state.writes++; return data } },
    notification: { createMany: async ({ data }: { data: Row[] }) => { state.notifications.push(...data); undo.push(() => { state.notifications.splice(state.notifications.length - data.length, data.length) }); state.writes += data.length; return { count: data.length } } },
  })
  return {
    db: {
      dispute: {
        findUnique: async ({ where }: { where: Row }) => {
          const d = state.disputes.find((x) => x.id === where.id)
          if (!d) return null
          const found = state.refunds.find((r) => r.bookingId === state.booking.id)
          const refund = state.missRefundOnce ? undefined : found
          state.missRefundOnce = false
          return { ...d, booking: { ...state.booking, payments: state.payments, refund: refund ? { reason: refund.reason, amount: refund.amount } : null, payouts: state.payouts } }
        },
        findMany: async () => state.disputes.filter((d) => ['OPEN', 'UNDER_REVIEW'].includes(d.status as string)).map((d) => ({ ...d })),
      },
      $transaction: async (fn: (t: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        const undo: (() => void)[] = []
        try { return await fn(makeTx(undo)) } catch (error) {
          undo.reverse().forEach((u) => u())
          throw error
        }
      },
    },
  }
})

import {
  DECISION_AIM, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_PER_SIDE, EVIDENCE_TYPES, EVIDENCE_LINK_SECONDS,
  decisionEffect, disputeEligibility, disputeStatusText, guestWindow, hostShare, hostWindow, isReasonFor,
  outcomesFor, type DecisionInput, type EligibilityBooking,
} from './disputes'
import { decideDispute, runDisputeCheck } from './disputeDecisions'
import { PAYOUT_DELAY_MS } from './cronRuns'

const at = (iso: string) => new Date(iso)

// ─── Who can report a problem, and when ─────────────────────────────────────

describe('windows', () => {
  it('gives a guest the check-in day and the day after', () => {
    expect(guestWindow(at('2027-03-10T12:00:00Z'))).toEqual({ opens: '2027-03-10', closes: '2027-03-11' })
    expect(guestWindow(at('2027-12-31T12:00:00Z'))).toEqual({ opens: '2027-12-31', closes: '2028-01-01' })
  })
  it('gives a host the check-out day and the two days after', () => {
    expect(hostWindow(at('2027-03-14T12:00:00Z'))).toEqual({ opens: '2027-03-14', closes: '2027-03-16' })
  })
  it("closes the guest's window before the payout falls due", () => {
    const checkIn = at('2027-03-10T12:00:00Z')
    const closesAt = at(`${guestWindow(checkIn).closes}T23:59:59.999Z`).getTime()
    const payoutDue = checkIn.getTime() + PAYOUT_DELAY_MS
    expect(PAYOUT_DELAY_MS).toBe(48 * 60 * 60 * 1000)
    expect(payoutDue).toBeGreaterThan(closesAt)
    expect(new Date(payoutDue).toISOString()).toBe('2027-03-12T12:00:00.000Z')
  })
})

describe('who can report a problem', () => {
  const booking: EligibilityBooking = { status: 'CONFIRMED', paymentStatus: 'PAID', checkIn: at('2027-03-10T12:00:00Z'), checkOut: at('2027-03-14T12:00:00Z') }
  const can = (role: 'GUEST' | 'HOST', now: string, over: Partial<EligibilityBooking> = {}, extra: { existingRoles?: string[]; hasRefund?: boolean } = {}) =>
    disputeEligibility({ role, booking: { ...booking, ...over }, existingRoles: extra.existingRoles ?? [], hasRefund: extra.hasRefund ?? false, now: at(now) })

  it('lets a guest report on the check-in day and the day after, and not before or later', () => {
    expect(can('GUEST', '2027-03-09T23:59:00Z')).toMatchObject({ ok: false, message: 'You can report a problem from the check-in day.' })
    expect(can('GUEST', '2027-03-10T00:00:00Z').ok).toBe(true)
    expect(can('GUEST', '2027-03-11T23:59:59Z').ok).toBe(true)
    expect(can('GUEST', '2027-03-12T00:00:00Z')).toMatchObject({ ok: false, message: expect.stringMatching(/has passed.*end of the day after check-in.*support@fiegh\.com/) })
  })

  it('lets a host report on the check-out day and the two days after', () => {
    expect(can('HOST', '2027-03-13T23:00:00Z')).toMatchObject({ ok: false, message: 'You can report a problem from the check-out day.' })
    expect(can('HOST', '2027-03-14T00:00:00Z').ok).toBe(true)
    expect(can('HOST', '2027-03-16T23:59:59Z').ok).toBe(true)
    expect(can('HOST', '2027-03-17T00:00:00Z')).toMatchObject({ ok: false, message: expect.stringMatching(/has passed/) })
  })

  it('allows one dispute per side: a second from the same side is refused, the other side is not', () => {
    expect(can('GUEST', '2027-03-10T15:00:00Z', {}, { existingRoles: ['GUEST'] })).toEqual({ ok: false, message: 'You have already reported a problem on this booking.' })
    expect(can('GUEST', '2027-03-10T15:00:00Z', {}, { existingRoles: ['HOST'] }).ok).toBe(true)
    expect(can('HOST', '2027-03-14T15:00:00Z', {}, { existingRoles: ['GUEST'] }).ok).toBe(true)
    expect(can('HOST', '2027-03-14T15:00:00Z', {}, { existingRoles: ['GUEST', 'HOST'] }).ok).toBe(false)
  })

  it('refuses unpaid, cancelled, declined and pending bookings', () => {
    expect(can('GUEST', '2027-03-10T15:00:00Z', { paymentStatus: 'UNPAID' })).toMatchObject({ ok: false, message: expect.stringMatching(/has not been paid for/) })
    for (const status of ['CANCELLED', 'DECLINED', 'PENDING']) {
      expect(can('GUEST', '2027-03-10T15:00:00Z', { status })).toMatchObject({ ok: false, message: expect.stringMatching(new RegExp(status.toLowerCase())) })
      expect(can('HOST', '2027-03-14T15:00:00Z', { status }).ok).toBe(false)
    }
    expect(can('HOST', '2027-03-14T15:00:00Z', { paymentStatus: 'UNPAID' }).ok).toBe(false)
    expect(can('HOST', '2027-03-14T15:00:00Z', { paymentStatus: 'REFUNDED' }).ok).toBe(false)
  })

  it('refuses a guest once any refund is on record, pending or not', () => {
    expect(can('GUEST', '2027-03-10T15:00:00Z', {}, { hasRefund: true })).toMatchObject({ ok: false, message: expect.stringMatching(/already has a refund/) })
  })

  it('still lets a host report after a completed stay or a part refund', () => {
    expect(can('HOST', '2027-03-15T10:00:00Z', { status: 'COMPLETED', paymentStatus: 'PARTIALLY_REFUNDED' }, { hasRefund: true }).ok).toBe(true)
  })

  it('accepts only the reasons listed for each side', () => {
    expect(isReasonFor('GUEST', 'NOT_AS_DESCRIBED')).toBe(true)
    expect(isReasonFor('GUEST', 'DAMAGE')).toBe(false)
    expect(isReasonFor('HOST', 'DAMAGE')).toBe(true)
    expect(isReasonFor('HOST', 'NO_ACCESS')).toBe(false)
    for (const bad of ['', 'toString', 'constructor', undefined, 4]) expect(isReasonFor('GUEST', bad)).toBe(false)
  })

  it('limits evidence to six images of 5MB a side, on ten-minute links', () => {
    expect(MAX_EVIDENCE_PER_SIDE).toBe(6)
    expect(MAX_EVIDENCE_BYTES).toBe(5_000_000)
    expect(EVIDENCE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
    expect(EVIDENCE_LINK_SECONDS).toBe(600)
  })

  it('states an aim, not a guarantee', () => {
    expect(DECISION_AIM).toBe('We aim to decide within 3 working days.')
    expect(disputeStatusText({ status: 'OPEN', outcome: null, raisedByRole: 'GUEST' })).toBe('Reported. We aim to decide within 3 working days.')
    expect(disputeStatusText({ status: 'UNDER_REVIEW', outcome: null, raisedByRole: 'GUEST' })).toMatch(/reviewing it\. We aim/)
    expect(disputeStatusText({ status: 'RESOLVED', outcome: 'FULL_REFUND', raisedByRole: 'GUEST' })).toBe('Decided: full refund to the guest.')
  })
})

// ─── What each decision does to the money ───────────────────────────────────

// Four nights at $100: $400 stay, $48 service fee, $50 deposit, $498 paid (771,900 pesewas)
const base: DecisionInput = {
  role: 'GUEST', outcome: 'FULL_REFUND',
  booking: { rentalMode: 'SHORT_STAY', subtotal: 400, serviceFee: 48, damageDeposit: 50 },
  payment: { id: 'payment_1', amount: 498, amountPesewas: 771_900 },
  existingRefund: null, payout: null,
}
const effect = (over: Partial<DecisionInput>) => decisionEffect({ ...base, ...over })

describe("decisions on a guest's dispute", () => {
  it('full refund: everything back, no payout', () => {
    const e = effect({})
    expect(e).toMatchObject({
      ok: true, outcome: 'FULL_REFUND', amount: null, hostPayout: 0, manual: [],
      refund: { reason: 'DISPUTE_FULL', stayRefund: 400, serviceFeeRefund: 48, depositRefund: 50, amount: 498, amountPesewas: 771_900 },
    })
    expect(e.ok && e.summary).toEqual(['The guest is refunded $498.00: everything they paid.', 'The host is not paid for this stay.'])
  })

  it('partial refund: from the stay price only, the fee kept, the host paid their share of what is left', () => {
    const e = effect({ outcome: 'PARTIAL_REFUND', amount: 150 })
    expect(e).toMatchObject({
      ok: true, outcome: 'PARTIAL_REFUND', amount: 150, hostPayout: 225, manual: [],
      refund: { reason: 'DISPUTE_PARTIAL', stayRefund: 150, serviceFeeRefund: 0, depositRefund: 0, amount: 150, amountPesewas: 232_500 },
    })
    expect(hostShare(400, 150)).toBeCloseTo(225)
    expect(e.ok && e.summary.join(' ')).toMatch(/refunded \$150\.00 of the \$400\.00 stay price\. The service fee is kept\..*host is paid \$225\.00: 90% of the \$250\.00 left/)
  })

  it('partial refund: the amount must be real money within the stay price', () => {
    for (const amount of [undefined, '', 0, -5, 'abc', 400.01, 10.005]) {
      expect(effect({ outcome: 'PARTIAL_REFUND', amount }).ok).toBe(false)
    }
    expect(effect({ outcome: 'PARTIAL_REFUND', amount: 401 })).toEqual({ ok: false, error: 'The amount cannot be more than $400.00' })
    expect(effect({ outcome: 'PARTIAL_REFUND', amount: 400 })).toMatchObject({ ok: true, hostPayout: 0 })
    expect(effect({ outcome: 'PARTIAL_REFUND', amount: '99.50' })).toMatchObject({ ok: true, amount: 99.5 })
  })

  it('rejected: no refund, the hold lifts and the host is paid in full', () => {
    const e = effect({ outcome: 'REJECTED' })
    expect(e).toMatchObject({ ok: true, refund: null, hostPayout: null, manual: [] })
    expect(e.ok && e.summary).toEqual(['No refund.', 'The hold on the payout is lifted. The host is paid $360.00 by the next payout run.'])
  })

  it('says what is left to a person when the host has already been paid', () => {
    const full = effect({ payout: { status: 'COMPLETED', amount: 360 } })
    expect(full.ok && full.manual).toEqual(['The host has already been sent $360.00. Recover it by hand.'])
    const part = effect({ outcome: 'PARTIAL_REFUND', amount: 150, payout: { status: 'PROCESSING', amount: 360 } })
    expect(part.ok && part.manual).toEqual(['The host has already been sent $360.00 and is now owed $225.00. Recover $135.00 by hand.'])
    // A payout that failed moved no money
    expect(effect({ payout: { status: 'FAILED', amount: 360 } })).toMatchObject({ ok: true, manual: [] })
  })

  it('leaves monthly and long-term payouts to a person', () => {
    const e = effect({ outcome: 'PARTIAL_REFUND', amount: 900, booking: { rentalMode: 'TEMP_STAY', subtotal: 2700, serviceFee: 324, damageDeposit: 300 }, payment: { id: 'p', amount: 3324, amountPesewas: null } })
    expect(e).toMatchObject({ ok: true, hostPayout: 1620, refund: { amount: 900, amountPesewas: null } })
    expect(e.ok && e.manual[0]).toMatch(/^Pay the host \$1,620\.00 by hand/)
  })

  it('refuses to refund twice or without a payment', () => {
    expect(effect({ existingRefund: { reason: 'DISPUTE_PARTIAL', amount: 100 } })).toMatchObject({ ok: false, error: expect.stringMatching(/already has a refund/) })
    expect(effect({ payment: null })).toMatchObject({ ok: false, error: expect.stringMatching(/no successful payment/) })
  })

  it('offers only the outcomes that belong to the side that raised it', () => {
    expect(outcomesFor('GUEST')).toEqual(['FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED'])
    expect(outcomesFor('HOST')).toEqual(['DEPOSIT_RETURNED', 'DEPOSIT_KEPT', 'REJECTED'])
    for (const outcome of ['DEPOSIT_KEPT', 'DEPOSIT_RETURNED', 'ANYTHING', undefined]) expect(effect({ outcome }).ok).toBe(false)
    expect(effect({ role: 'HOST', outcome: 'FULL_REFUND' }).ok).toBe(false)
  })
})

describe("decisions on a host's dispute", () => {
  const host = (over: Partial<DecisionInput>) => effect({ role: 'HOST', ...over })

  it('deposit returned: refunded to the guest through the refund code', () => {
    expect(host({ outcome: 'DEPOSIT_RETURNED' })).toMatchObject({
      ok: true, amount: null, hostPayout: null, manual: [],
      refund: { reason: 'DISPUTE_DEPOSIT', stayRefund: 0, serviceFeeRefund: 0, depositRefund: 50, amount: 50, amountPesewas: 77_500 },
      summary: ['The guest is refunded $50.00 of the deposit.'],
    })
  })

  it('deposit kept: recorded and paid by hand, the rest refunded to the guest', () => {
    const all = host({ outcome: 'DEPOSIT_KEPT', amount: 50 })
    expect(all).toMatchObject({ ok: true, amount: 50, refund: null, manual: ['Pay $50.00 to the host by hand. Deposits are not paid out automatically.'] })
    const part = host({ outcome: 'DEPOSIT_KEPT', amount: 20 })
    expect(part).toMatchObject({ ok: true, amount: 20, refund: { reason: 'DISPUTE_DEPOSIT', depositRefund: 30, amount: 30 } })
    expect(part.ok && part.manual).toEqual(['Pay $20.00 to the host by hand. Deposits are not paid out automatically.'])
    expect(host({ outcome: 'DEPOSIT_KEPT', amount: 50.01 })).toEqual({ ok: false, error: 'The amount cannot be more than $50.00' })
    expect(host({ outcome: 'DEPOSIT_KEPT' }).ok).toBe(false)
  })

  it('falls back to a person when the booking already has a refund', () => {
    const e = host({ outcome: 'DEPOSIT_RETURNED', existingRefund: { reason: 'DISPUTE_PARTIAL', amount: 150 } })
    expect(e).toMatchObject({ ok: true, refund: null, manual: ['Return $50.00 of the deposit to the guest by hand (this booking already has a refund on record).'] })
  })

  it('rejected: nothing kept, the deposit goes back by hand as after any stay', () => {
    expect(host({ outcome: 'REJECTED' })).toMatchObject({ ok: true, refund: null, manual: ['Return the $50.00 deposit to the guest by hand, as after any stay.'] })
  })

  it('has nothing to keep or return when there was no deposit', () => {
    const noDeposit = { rentalMode: 'SHORT_STAY', subtotal: 400, serviceFee: 48, damageDeposit: 0 }
    expect(host({ outcome: 'DEPOSIT_KEPT', amount: 10, booking: noDeposit }).ok).toBe(false)
    expect(host({ outcome: 'DEPOSIT_RETURNED', booking: noDeposit }).ok).toBe(false)
    expect(host({ outcome: 'REJECTED', booking: noDeposit })).toMatchObject({ ok: true, manual: [] })
  })
})

// ─── Applying a decision ────────────────────────────────────────────────────

describe('decideDispute', () => {
  const decide = (over: Record<string, unknown> = {}) =>
    decideDispute({ disputeId: 'dispute_1', adminId: 'admin_1', outcome: 'PARTIAL_REFUND', amount: 150, resolution: 'The air conditioning did not work.', ...over })

  beforeEach(() => {
    state.disputes.length = 0; state.refunds.length = 0; state.events.length = 0; state.notifications.length = 0
    state.payments.length = 0; state.payouts.length = 0; state.writes = 0
    state.booking = { id: 'booking_1', guestId: 'guest_1', hostId: 'host_1', rentalMode: 'SHORT_STAY', subtotal: 400, serviceFee: 48, damageDeposit: 50, listing: { title: 'Test home' } }
    state.payments.push({ id: 'payment_1', amount: 498, amountPesewas: 771_900 })
    state.disputes.push({ id: 'dispute_1', bookingId: 'booking_1', raisedByRole: 'GUEST', status: 'OPEN', createdAt: at('2027-03-10T15:00:00Z') })
    sendRefund.mockClear()
    sentry.captureMessage.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', '')
  })

  it('only reports what it would do while the switch is off', async () => {
    for (const value of ['', '1', 'TRUE', 'yes']) {
      vi.stubEnv('DISPUTE_DECISIONS_ENABLED', value)
      const r = await decide()
      expect(r).toMatchObject({ ok: true, mode: 'dry-run', reason: 'DISPUTE_DECISIONS_ENABLED is not set to true', effect: { refund: { amount: 150 }, hostPayout: 225 } })
    }
    expect(state.writes).toBe(0)
    expect(state.disputes[0].status).toBe('OPEN')
    expect(state.refunds).toHaveLength(0)
    expect(sendRefund).not.toHaveBeenCalled()
  })

  it('only reports when dryRun is asked for, even switched on', async () => {
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', 'true')
    const r = await decide({ dryRun: true, resolution: '' })
    expect(r).toMatchObject({ ok: true, mode: 'dry-run', reason: 'dryRun was requested' })
    expect(state.writes).toBe(0)
    expect(sendRefund).not.toHaveBeenCalled()
  })

  it('records the decision, who made it and why, and hands the refund to the refund code', async () => {
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', 'true')
    const r = await decide()
    expect(r).toMatchObject({ ok: true, mode: 'applied', refundId: 'refund_1' })
    expect(state.disputes[0]).toMatchObject({ status: 'RESOLVED', outcome: 'PARTIAL_REFUND', refundAmount: 150, resolution: 'The air conditioning did not work.', resolvedById: 'admin_1' })
    expect(state.disputes[0].resolvedAt).toBeInstanceOf(Date)
    expect(state.refunds[0]).toMatchObject({ bookingId: 'booking_1', paymentId: 'payment_1', reason: 'DISPUTE_PARTIAL', stayRefund: 150, serviceFeeRefund: 0, depositRefund: 0, amount: 150, amountPesewas: 232_500 })
    expect(state.events[0]).toMatchObject({ disputeId: 'dispute_1', actorId: 'admin_1', type: 'RESOLVED' })
    expect(state.notifications.map((n) => n.userId)).toEqual(['guest_1', 'host_1'])
    // Sent only through lib/refunds, which has its own switch
    expect(sendRefund).toHaveBeenCalledTimes(1)
    expect(sendRefund).toHaveBeenCalledWith('refund_1')
  })

  it('creates no refund when the dispute is not upheld', async () => {
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', 'true')
    const r = await decide({ outcome: 'REJECTED' })
    expect(r).toMatchObject({ ok: true, mode: 'applied', refundId: null })
    expect(state.disputes[0]).toMatchObject({ status: 'RESOLVED', outcome: 'REJECTED', refundAmount: null })
    expect(state.refunds).toHaveLength(0)
    expect(sendRefund).not.toHaveBeenCalled()
  })

  it('needs a reason, and takes no amount from thin air', async () => {
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', 'true')
    expect(await decide({ resolution: '   ' })).toMatchObject({ ok: false, status: 400 })
    expect(await decide({ amount: 9999 })).toMatchObject({ ok: false, status: 400, error: 'The amount cannot be more than $400.00' })
    expect(await decide({ outcome: 'DEPOSIT_KEPT' })).toMatchObject({ ok: false, status: 400 })
    expect(state.writes).toBe(0)
  })

  it('is final: a decided dispute cannot be decided again', async () => {
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', 'true')
    await decide()
    const again = await decide({ outcome: 'FULL_REFUND' })
    expect(again).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Decisions are final/) })
    expect(state.refunds).toHaveLength(1)
    expect(state.disputes[0].outcome).toBe('PARTIAL_REFUND')
  })

  it('is decided once when two admins confirm at the same moment', async () => {
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', 'true')
    // One refunds, the other rejects: only one of them may take effect
    const results = await Promise.all([decide(), decide({ adminId: 'admin_2', outcome: 'REJECTED' })])
    expect(results.filter((r) => r.ok && r.mode === 'applied')).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
    expect(state.events).toHaveLength(1)
    expect(state.notifications).toHaveLength(2)
    expect(state.refunds).toHaveLength(state.disputes[0].outcome === 'PARTIAL_REFUND' ? 1 : 0)
  })

  it('changes nothing if a refund appeared on the booking in the meantime', async () => {
    vi.stubEnv('DISPUTE_DECISIONS_ENABLED', 'true')
    state.refunds.push({ id: 'refund_other', bookingId: 'booking_1', reason: 'GUEST_CANCELLED', amount: 498 })
    state.missRefundOnce = true
    const r = await decide()
    expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/already has a refund/) })
    expect(state.disputes[0].status).toBe('OPEN')
    expect(state.refunds).toHaveLength(1)
    expect(sendRefund).not.toHaveBeenCalled()
  })
})

// ─── Disputes left open ─────────────────────────────────────────────────────

describe('the daily check for disputes left open', () => {
  beforeEach(() => {
    state.disputes.length = 0
    sentry.captureMessage.mockReset()
    state.disputes.push(
      { id: 'd_new', bookingId: 'b1', raisedByRole: 'GUEST', status: 'OPEN', createdAt: at('2027-03-10T10:00:00Z') },
      { id: 'd_old', bookingId: 'b2', raisedByRole: 'HOST', status: 'UNDER_REVIEW', createdAt: at('2027-03-07T09:00:00Z') },
      { id: 'd_done', bookingId: 'b3', raisedByRole: 'GUEST', status: 'RESOLVED', createdAt: at('2027-03-01T09:00:00Z') },
    )
  })

  it('alerts once per run for each dispute undecided after 3 days', async () => {
    const run = await runDisputeCheck({ now: at('2027-03-10T09:00:00Z') })
    expect(run).toMatchObject({ mode: 'live', open: 2, alerts: 1 })
    expect(run.overdue).toEqual([{ disputeId: 'd_old', bookingId: 'b2', raisedByRole: 'HOST', status: 'UNDER_REVIEW', daysOpen: 3 }])
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
    const [message, options] = sentry.captureMessage.mock.calls[0]
    expect(message).toBe('A dispute is still undecided after 3 days')
    expect(options).toMatchObject({ level: 'warning', tags: { area: 'disputes' }, fingerprint: ['dispute-overdue', 'd_old'] })
  })

  it('does not alert a moment before 3 days, or for decided disputes', async () => {
    const run = await runDisputeCheck({ now: at('2027-03-10T08:59:59Z') })
    expect(run.alerts).toBe(0)
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('only reports in a dry run', async () => {
    const run = await runDisputeCheck({ dryRun: true, now: at('2027-03-20T09:00:00Z') })
    expect(run).toMatchObject({ mode: 'dry-run', open: 2, alerts: 0 })
    expect(run.overdue.map((o) => o.disputeId).sort()).toEqual(['d_new', 'd_old'])
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })
})

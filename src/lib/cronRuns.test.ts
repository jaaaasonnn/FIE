import { beforeEach, describe, expect, it, vi } from 'vitest'

// Everything here runs against an in-memory stand-in for the database and a
// mocked fetch. No test may reach Paystack or a real database.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  bookings: [] as Row[], users: [] as Row[], payouts: [] as Row[],
  writes: 0,
}))
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))
vi.mock('@sentry/nextjs', () => sentry)
// Messages are covered by lib/messaging tests; here notify() is only a call that must not get in the way
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))

vi.mock('@/lib/db', async () => {
  const { Prisma } = await import('@prisma/client')

  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
      const value = row[key]
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { lt?: number; lte?: Date; gte?: Date; not?: unknown; in?: unknown[] }
        if ('in' in c && !c.in!.includes(value)) return false
        if ('lt' in c && !((value as number) < c.lt!)) return false
        if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
        if ('gte' in c && !(value instanceof Date && value >= c.gte!)) return false
        if ('not' in c && (value ?? null) === c.not) return false
        return true
      }
      return (value ?? null) === cond
    })
  const apply = (row: Row, data: Row) => {
    for (const [key, v] of Object.entries(data)) {
      row[key] = v !== null && typeof v === 'object' && 'increment' in v ? (row[key] as number) + (v as { increment: number }).increment : v
    }
  }
  // A yield between "read" and "write", so two runs really can interleave
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  type RefundClause = { refund: { is: null | { reason: { in: string[] } } } }
  const bookingMatches = (b: Row, where: Row) => {
    const { payouts, disputes, OR, ...rest } = where as {
      payouts?: { none: Row }
      disputes?: { none: { raisedByRole: string; status: { in: string[] } } }
      OR?: RefundClause[]
    } & Row
    if (payouts && state.payouts.some((p) => p.bookingId === b.id)) return false
    if (disputes) {
      const { raisedByRole, status } = disputes.none
      const held = ((b.disputes as Row[]) ?? []).some((d) => d.raisedByRole === raisedByRole && status.in.includes(d.status as string))
      if (held) return false
    }
    if (OR) {
      const refund = b.refund as { reason: string } | undefined
      const ok = OR.some((c) => (c.refund.is === null ? !refund : !!refund && c.refund.is.reason.in.includes(refund.reason)))
      if (!ok) return false
    }
    return matches(b, rest)
  }
  // instalmentSeq is 0 unless set, as the column's default has it
  const payoutRows = () => state.payouts.map((p) => (p.instalmentSeq === undefined ? Object.assign(p, { instalmentSeq: 0 }) : p))
  const openGuestDisputes = (b: Row) =>
    ((b.disputes as Row[]) ?? []).filter((d) => d.raisedByRole === 'GUEST' && ['OPEN', 'UNDER_REVIEW'].includes(d.status as string))

  return {
    db: {
      booking: {
        findMany: async ({ where }: { where: Row }) => {
          await tick()
          return state.bookings.filter((b) => bookingMatches(b, where)).map((b) => ({
            ...b, host: { ...(state.users.find((u) => u.id === b.hostId) ?? {}) },
          }))
        },
        findUnique: async ({ where }: { where: Row }) => {
          const row = state.bookings.find((b) => b.id === where.id)
          // As the real query does, only the guest's open disputes come back
          return row ? { ...row, disputes: openGuestDisputes(row) } : null
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const rows = state.bookings.filter((b) => bookingMatches(b, where))
          rows.forEach((r) => apply(r, data))
          state.writes += rows.length
          return { count: rows.length }
        },
      },
      user: { findUnique: async ({ where }: { where: Row }) => state.users.find((u) => u.id === where.id) ?? null },
      exchangeRate: { findFirst: async () => ({ usdToGhs: 15 }) },
      // None of these bookings is paid in instalments: those are covered in rentInstalments.test.ts
      instalment: { findMany: async () => [] },
      payout: {
        findFirst: async ({ where }: { where: Row }) => {
          await tick()
          const row = payoutRows().find((p) => matches(p, where))
          return row ? { ...row } : null
        },
        findMany: async ({ where }: { where: Row }) => payoutRows().filter((p) => matches(p, where)).map((p) => ({ ...p })),
        create: async ({ data }: { data: Row }) => {
          await tick()
          // The real table has a unique index on (bookingId, instalmentSeq)
          if (payoutRows().some((p) => p.bookingId === data.bookingId && p.instalmentSeq === (data.instalmentSeq ?? 0))) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
          }
          const row = {
            id: `payout_${state.payouts.length + 1}`,
            retryCount: 0, lastFailedAt: null, alertedAt: null, paystackTransferCode: null,
            failureReason: null, initiatedAt: null, completedAt: null, createdAt: new Date(),
            instalmentSeq: 0,
            ...data,
          }
          state.payouts.push(row)
          state.writes++
          return { ...row }
        },
        update: async ({ where, data }: { where: Row; data: Row }) => {
          const row = state.payouts.find((p) => p.id === where.id)!
          apply(row, data)
          state.writes++
          return { ...row }
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const rows = payoutRows().filter((p) => matches(p, where))
          rows.forEach((r) => apply(r, data))
          state.writes += rows.length
          return { count: rows.length }
        },
      },
    },
  }
})

import { OVERDUE_ALERT_HOUR_UTC, runCompletion, runPayouts, wantsDryRun } from '@/lib/cronRuns'
import { initiateHostPayout, retryFailedPayouts, STALE_CLAIM_MS } from '@/lib/payouts'
import { PayoutsOffError, payoutGate, payoutsNotBefore } from '@/lib/payoutSwitches'
import { CANCEL_CONTACT_SUPPORT, cancelNeedsSupport } from '@/lib/cancelRules'
import { notify } from '@/lib/messaging/notify'
import { HostIdNotApprovedError } from '@/lib/hostId'

// ─── Helpers ────────────────────────────────────────────────────────────────

const fetchMock = vi.fn()
const NOW = new Date('2027-03-12T12:00:00Z')
const at = (iso: string) => new Date(iso)
const paystackOk = () =>
  new Response(JSON.stringify({ status: true, data: { transfer_code: `TRF_${fetchMock.mock.calls.length}`, status: 'pending' } }), { status: 200 })

/**
 * A paid, confirmed one-night stay, 10 to 11 March 2027. Its payout falls due
 * 48 hours after check-in, which is exactly NOW; its check-out passed a day ago.
 */
function booking(over: Row = {}): Row {
  const row = {
    id: `booking_${state.bookings.length + 1}`, hostId: 'host_1', rentalMode: 'SHORT_STAY',
    status: 'CONFIRMED', paymentStatus: 'PAID', subtotal: 100,
    checkIn: at('2027-03-10T12:00:00Z'), checkOut: at('2027-03-11T12:00:00Z'),
    createdAt: at('2027-02-01T09:00:00Z'),
    ...over,
  }
  state.bookings.push(row)
  return row
}
/** An ID FieGH has approved: the flag, an APPROVED document and the admin who reviewed it (lib/hostId.ts) */
const approvedId = { isVerified: true, verification: { status: 'APPROVED', reviewedById: 'admin_1' } }
const verifiedHost = { paystackRecipientCode: 'RCP_1', payoutMethodVerifiedAt: new Date('2027-01-01'), payoutMethod: 'MOMO', ...approvedId }
const transferCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/transfer'))
const sentBody = (i = 0) => JSON.parse(transferCalls()[i][1].body as string)

function switchesOn() {
  vi.stubEnv('PAYOUTS_ENABLED', 'true')
  vi.stubEnv('PAYOUTS_NOT_BEFORE', '2027-01-15')
  vi.stubEnv('COMPLETION_ENABLED', 'true')
}

beforeEach(() => {
  state.bookings.length = 0
  state.payouts.length = 0
  state.users.length = 0
  state.users.push({ id: 'host_1', ...verifiedHost })
  state.writes = 0
  sentry.captureException.mockReset()
  sentry.captureMessage.mockReset()
  fetchMock.mockReset()
  // Paystack takes a moment to answer, as a real network call does. That
  // gap is where a second run could otherwise send the same payout.
  fetchMock.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return paystackOk()
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_cronruns')
  vi.stubEnv('PAYOUTS_ENABLED', '')
  vi.stubEnv('PAYOUTS_NOT_BEFORE', '')
  vi.stubEnv('COMPLETION_ENABLED', '')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ─── The switches ───────────────────────────────────────────────────────────

describe('safety switches', () => {
  it('are off by default', () => {
    expect(payoutGate()).toMatchObject({ live: false, reason: 'PAYOUTS_ENABLED is not set to true' })
  })

  it('need exactly "true", and a real cut-off date', () => {
    vi.stubEnv('PAYOUTS_NOT_BEFORE', '2027-01-15')
    for (const value of ['1', 'TRUE', 'yes', ' true', 'on']) {
      vi.stubEnv('PAYOUTS_ENABLED', value)
      expect(payoutGate().live).toBe(false)
    }
    vi.stubEnv('PAYOUTS_ENABLED', 'true')
    expect(payoutGate()).toEqual({ live: true, notBefore: at('2027-01-15T00:00:00Z') })

    for (const value of ['', 'soon', '2027-02-30', '15/01/2027', '2027-01-15T00:00:00Z']) {
      vi.stubEnv('PAYOUTS_NOT_BEFORE', value)
      expect(payoutsNotBefore()).toBeNull()
      expect(payoutGate()).toMatchObject({ live: false, reason: 'PAYOUTS_NOT_BEFORE is not set to a date (YYYY-MM-DD)' })
    }
  })

  it('reads ?dryRun=1 and ?dryRun=true only', () => {
    expect(wantsDryRun(new Request('http://x/api/cron/process-payouts?dryRun=1'))).toBe(true)
    expect(wantsDryRun(new Request('http://x/api/cron/process-payouts?dryRun=true'))).toBe(true)
    expect(wantsDryRun(new Request('http://x/api/cron/process-payouts'))).toBe(false)
    expect(wantsDryRun(new Request('http://x/api/cron/process-payouts?dryRun=0'))).toBe(false)
  })
})

describe('with the switches off', () => {
  it('reports what it would pay, writes nothing and calls nothing', async () => {
    booking()
    const run = await runPayouts()
    expect(run).toMatchObject({ mode: 'dry-run', reason: 'PAYOUTS_ENABLED is not set to true', checked: 1 })
    expect(run.results).toEqual([{ bookingId: 'booking_1', hostId: 'host_1', amount: 90, action: 'would-pay' }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
    expect(state.payouts).toHaveLength(0)
  })

  it('stays in dry run when enabled but the cut-off date is missing', async () => {
    vi.stubEnv('PAYOUTS_ENABLED', 'true')
    booking()
    const run = await runPayouts()
    expect(run).toMatchObject({ mode: 'dry-run', reason: 'PAYOUTS_NOT_BEFORE is not set to a date (YYYY-MM-DD)' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('stays in dry run when ?dryRun=1 is passed, even fully switched on', async () => {
    switchesOn()
    booking()
    const run = await runPayouts({ dryRun: true })
    expect(run).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested' })
    expect(run.results[0].action).toBe('would-pay')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('refuses a direct call to start a transfer', async () => {
    booking()
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toBeInstanceOf(PayoutsOffError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('does not retry failed payouts', async () => {
    state.payouts.push({
      id: 'payout_1', hostId: 'host_1', bookingId: 'booking_1', amount: 90, status: 'FAILED', retryCount: 0,
      alertedAt: null, lastFailedAt: at('2027-03-12T08:00:00Z'), failureReason: 'Network error calling Paystack: down',
      paystackTransferCode: null, paystackTransferReference: 'pyt-old',
    })
    expect(await retryFailedPayouts()).toEqual([])
    expect((await runPayouts()).retried).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts[0].status).toBe('FAILED')
  })

  it('does not complete bookings, but lists them', async () => {
    booking()
    const run = await runCompletion()
    expect(run).toEqual({ mode: 'dry-run', reason: 'COMPLETION_ENABLED is not set to true', transitioned: 0, bookingIds: ['booking_1'] })
    expect(state.bookings[0].status).toBe('CONFIRMED')
    expect(state.writes).toBe(0)
  })
})

// ─── Exactly one payout per stay ────────────────────────────────────────────

describe('one payout per paid stay', () => {
  beforeEach(switchesOn)

  it('pays a one-night stay that the completion job got to first', async () => {
    booking()
    expect((await runCompletion()).transitioned).toBe(1)
    expect(state.bookings[0].status).toBe('COMPLETED')

    const run = await runPayouts()
    expect(run).toMatchObject({ mode: 'live', checked: 1 })
    expect(run.results[0]).toMatchObject({ bookingId: 'booking_1', action: 'paid', status: 'PROCESSING' })
    expect(transferCalls()).toHaveLength(1)
    expect(state.payouts).toHaveLength(1)
  })

  it('pays it once when the payout job runs first, and never again', async () => {
    booking()
    await runPayouts()
    await runCompletion()
    await runPayouts()
    await runPayouts()
    expect(state.bookings[0].status).toBe('COMPLETED')
    expect(transferCalls()).toHaveLength(1)
    expect(state.payouts).toHaveLength(1)
  })

  it('pays it once when both jobs run at the same moment', async () => {
    booking()
    await Promise.all([runCompletion(), runPayouts()])
    await Promise.all([runCompletion(), runPayouts()])
    expect(state.bookings[0].status).toBe('COMPLETED')
    expect(transferCalls()).toHaveLength(1)
    expect(state.payouts).toHaveLength(1)
  })

  it('makes one row and one transfer when two payout runs overlap', async () => {
    booking()
    booking({ subtotal: 240 })
    const [a, b] = await Promise.all([runPayouts(), runPayouts()])
    expect(a.checked).toBe(2)
    expect(b.checked).toBe(2)
    // The run that loses the race to create a row picks up the winner's, quietly
    expect([...a.results, ...b.results].map((r) => r.action)).toEqual(['paid', 'paid', 'paid', 'paid'])
    expect(state.payouts).toHaveLength(2)
    expect(new Set(state.payouts.map((p) => p.bookingId)).size).toBe(2)
    expect(transferCalls()).toHaveLength(2)
    expect(new Set(transferCalls().map((_, i) => sentBody(i).reference)).size).toBe(2)
  })

  it('sends the host their share in pesewas, with a reason naming the booking', async () => {
    booking({ subtotal: 240 })
    await runPayouts()
    // $240 less the 10% commission is $216, at 15 cedis to the dollar
    expect(sentBody()).toMatchObject({ source: 'balance', amount: 324000, recipient: 'RCP_1' })
    expect(state.payouts[0]).toMatchObject({ amount: 216, currency: 'USD', status: 'PROCESSING' })
  })

  it('pays stays of any length once, 48 hours after check-in', async () => {
    booking({ checkIn: at('2027-03-10T12:00:00Z'), checkOut: at('2027-03-18T12:00:00Z') })
    const notYet = booking({ checkIn: at('2027-03-10T13:00:00Z'), checkOut: at('2027-03-14T12:00:00Z') })
    const run = await runPayouts()
    expect(run.results.map((r) => r.bookingId)).toEqual(['booking_1'])
    expect(transferCalls()).toHaveLength(1)

    vi.setSystemTime(at('2027-03-12T13:00:00Z'))
    await runPayouts({ now: at('2027-03-12T13:00:00Z') })
    expect(state.payouts.map((p) => p.bookingId)).toEqual(['booking_1', notYet.id])
    expect(transferCalls()).toHaveLength(2)
  })

  it('records a refused transfer as failed and does not send it again in the same run', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: false, message: 'Your balance is not enough to fulfil this request' }), { status: 400 }))
    booking()
    const run = await runPayouts()
    expect(run.results[0]).toMatchObject({ action: 'failed', status: 'FAILED' })
    expect(transferCalls()).toHaveLength(1)
    expect(state.payouts).toHaveLength(1)
  })
})

describe('bookings that are never paid by this job', () => {
  beforeEach(switchesOn)

  it('skips unpaid, cancelled, declined, monthly, long-term and not-yet-due stays', async () => {
    booking({ paymentStatus: 'UNPAID' })
    booking({ status: 'CANCELLED' })
    booking({ status: 'DECLINED' })
    booking({ status: 'PENDING' })
    booking({ rentalMode: 'TEMP_STAY' })
    booking({ rentalMode: 'PERMANENT' })
    booking({ checkIn: at('2027-03-12T12:00:00Z'), checkOut: at('2027-03-13T12:00:00Z') })
    // 24 hours after check-in is no longer enough
    booking({ checkIn: at('2027-03-11T12:00:00Z'), checkOut: at('2027-03-12T12:00:00Z') })
    const run = await runPayouts()
    expect(run.checked).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('skips every booking made before PAYOUTS_NOT_BEFORE, such as the test bookings', async () => {
    booking({ createdAt: at('2027-01-14T23:59:59Z') })
    booking({ createdAt: at('2026-08-12T23:39:40Z'), status: 'COMPLETED' })
    const onTheDay = booking({ createdAt: at('2027-01-15T00:00:00Z') })
    const run = await runPayouts()
    expect(run.results.map((r) => r.bookingId)).toEqual([onTheDay.id])
    expect(transferCalls()).toHaveLength(1)
  })

  it('refuses a direct call for a booking made before the cut-off', async () => {
    booking({ createdAt: at('2026-08-12T23:39:40Z') })
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toThrow(/before PAYOUTS_NOT_BEFORE/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('leaves a booking that already has a payout alone', async () => {
    booking()
    state.payouts.push({ id: 'payout_1', hostId: 'host_1', bookingId: 'booking_1', amount: 90, status: 'COMPLETED', paystackTransferCode: 'TRF_done', createdAt: at('2027-03-12T11:00:00Z') })
    const run = await runPayouts()
    expect(run.checked).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── Host with no payout method ─────────────────────────────────────────────

describe('a host with no payout method', () => {
  beforeEach(() => {
    switchesOn()
    state.users[0] = { id: 'host_1', paystackRecipientCode: null, payoutMethodVerifiedAt: null, ...approvedId }
  })

  it('is skipped without a row or a call, every run', async () => {
    booking()
    for (let i = 0; i < 3; i++) {
      const run = await runPayouts()
      expect(run.results).toEqual([{ bookingId: 'booking_1', hostId: 'host_1', amount: 90, action: 'waiting-for-payout-method' }])
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('is paid on the next run after adding one, even once the stay is completed', async () => {
    booking()
    await runPayouts()
    await runCompletion()
    expect(state.bookings[0].status).toBe('COMPLETED')

    state.users[0] = { id: 'host_1', ...verifiedHost }
    const later = at('2027-03-20T15:00:00Z')
    vi.setSystemTime(later)
    const run = await runPayouts({ now: later })
    expect(run.results[0]).toMatchObject({ action: 'paid' })
    expect(transferCalls()).toHaveLength(1)
    expect(state.payouts).toHaveLength(1)
  })

  it('raises one alert a day once the payout is 7 days overdue', async () => {
    booking() // fell due at 2027-03-12T12:00Z
    const run = (iso: string) => { vi.setSystemTime(at(iso)); return runPayouts({ now: at(iso) }) }

    expect((await run(`2027-03-19T0${OVERDUE_ALERT_HOUR_UTC}:00:00Z`)).overdueAlerts).toBe(0) // 6 days 21 hours
    expect((await run('2027-03-19T12:00:00Z')).overdueAlerts).toBe(0) // 7 days, but not the alert hour
    expect((await run(`2027-03-20T0${OVERDUE_ALERT_HOUR_UTC}:00:00Z`)).overdueAlerts).toBe(1)
    expect((await run('2027-03-20T10:00:00Z')).overdueAlerts).toBe(0)
    expect((await run(`2027-03-21T0${OVERDUE_ALERT_HOUR_UTC}:00:00Z`)).overdueAlerts).toBe(1)

    expect(sentry.captureMessage).toHaveBeenCalledTimes(2)
    const [message, options] = sentry.captureMessage.mock.calls[0]
    expect(message).toBe('Host payout still unpaid 7 days after it fell due')
    expect(options).toMatchObject({ level: 'warning', fingerprint: ['payout-overdue', 'booking_1'], tags: { area: 'payouts', payout_failure: 'OVERDUE' } })
    expect(options.contexts.payout).toMatchObject({ bookingId: 'booking_1', hostId: 'host_1', amount: 90, why: 'the host has no verified payout method' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('raises no overdue alert while payouts are off', async () => {
    vi.stubEnv('PAYOUTS_ENABLED', '')
    booking()
    const when = at(`2027-03-25T0${OVERDUE_ALERT_HOUR_UTC}:00:00Z`)
    vi.setSystemTime(when)
    expect((await runPayouts({ now: when })).overdueAlerts).toBe(0)
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })
})

// ─── A host whose ID is not approved ────────────────────────────────────────

describe('a host whose ID is not approved', () => {
  const notifyMock = vi.mocked(notify)
  const heldNotices = () => notifyMock.mock.calls.filter(([event]) => event === 'payout.held_for_id').map(([, ids]) => ids)
  /** The host has a payout method, so the ID is the only thing in the way */
  const hostId = (id: Row) => { state.users[0] = { id: 'host_1', ...verifiedHost, isVerified: false, verification: null, ...id } }
  const waitingRow = { bookingId: 'booking_1', hostId: 'host_1', amount: 90, action: 'waiting-for-host-id' }
  const stuck = (over: Row = {}) => {
    booking()
    state.payouts.push({
      id: 'payout_1', hostId: 'host_1', bookingId: 'booking_1', amount: 90, status: 'PENDING', retryCount: 0,
      paystackTransferCode: null, paystackTransferReference: 'pyt-original', failureReason: null,
      createdAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1000), initiatedAt: null, ...over,
    })
  }

  beforeEach(() => {
    switchesOn()
    notifyMock.mockClear()
    hostId({})
  })

  it('a short stay for a host with no approved ID is not sent and writes no payout', async () => {
    booking()
    for (let i = 0; i < 3; i++) {
      const run = await runPayouts()
      expect(run.mode).toBe('live')
      expect(run.results).toEqual([waitingRow])
      expect(run.waitingForHostId).toEqual({ count: 1, amount: 90 })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
    expect(state.writes).toBe(0)
    // Still CONFIRMED and PAID: nothing about the booking was failed or cancelled
    expect(state.bookings[0]).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
  })

  it('tells the host on a live run, and the job asks for one notice per payout', async () => {
    booking()
    await runPayouts()
    expect(heldNotices()).toEqual([{ bookingId: 'booking_1', instalmentId: undefined }])
    // Not the payout-method notice as well: the host has a method, and one message is enough
    expect(notifyMock.mock.calls.filter(([event]) => event === 'payout.waiting')).toHaveLength(0)
  })

  it('the dry run reports it as waiting for the ID, never as would-pay, and tells nobody', async () => {
    booking()
    const asked = await runPayouts({ dryRun: true })
    expect(asked.mode).toBe('dry-run')
    expect(asked.results).toEqual([waitingRow])
    expect(asked.waitingForHostId).toEqual({ count: 1, amount: 90 })

    vi.stubEnv('PAYOUTS_ENABLED', '')
    const off = await runPayouts()
    expect(off.results).toEqual([waitingRow])

    expect(heldNotices()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('is paid on the next run after the ID is approved, once, through the usual rules', async () => {
    booking()
    await runPayouts()
    expect(state.payouts).toHaveLength(0)

    hostId(approvedId)
    const run = await runPayouts()
    expect(run.results).toEqual([expect.objectContaining({ bookingId: 'booking_1', action: 'paid', status: 'PROCESSING' })])
    expect(run.waitingForHostId).toEqual({ count: 0, amount: 0 })
    expect(transferCalls()).toHaveLength(1)
    expect(sentBody().amount).toBe(90 * 15 * 100)
    expect((await runPayouts()).results).toEqual([])
    expect(transferCalls()).toHaveLength(1)
  })

  it('approval does not jump the release date, an open dispute or PAYOUTS_NOT_BEFORE', async () => {
    hostId(approvedId)
    booking({ checkIn: at('2027-03-11T12:00:00Z') })                             // 48 hours not up yet
    booking({ disputes: [{ raisedByRole: 'GUEST', status: 'OPEN' }] })           // guest's problem still open
    booking({ createdAt: at('2027-01-10T09:00:00Z') })                           // made before PAYOUTS_NOT_BEFORE
    expect((await runPayouts()).results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the flag alone, or an approval with no reviewer, does not count', async () => {
    booking()
    for (const id of [
      { isVerified: true, verification: null },                                              // a seed script or SQL set the flag
      { isVerified: true, verification: { status: 'APPROVED', reviewedById: null } },         // nobody is recorded as approving
      { isVerified: false, verification: { status: 'APPROVED', reviewedById: 'admin_1' } },  // the flag was taken away
    ]) {
      hostId(id)
      expect((await runPayouts()).results, JSON.stringify(id)).toEqual([waitingRow])
      await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toBeInstanceOf(HostIdNotApprovedError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('a rejected or waiting document does not count even with the flag on', async () => {
    booking()
    for (const status of ['PENDING', 'REJECTED']) {
      hostId({ isVerified: true, verification: { status, reviewedById: 'admin_1' } })
      expect((await runPayouts()).results, status).toEqual([waitingRow])
      await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toBeInstanceOf(HostIdNotApprovedError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('initiateHostPayout refuses a host with no approved ID before creating a row', async () => {
    booking()
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toBeInstanceOf(HostIdNotApprovedError)
    expect(state.payouts).toHaveLength(0)
    expect(state.writes).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('initiateHostPayout refuses to send a payout row that already exists, and leaves it unclaimed', async () => {
    stuck()
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toBeInstanceOf(HostIdNotApprovedError)
    expect(state.payouts[0]).toMatchObject({ status: 'PENDING', initiatedAt: null, failureReason: null, paystackTransferCode: null })
    expect(state.writes).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a PENDING payout is not resumed while the host\'s ID is not approved, and stays PENDING', async () => {
    stuck()
    for (const dryRun of [false, true]) {
      const run = await runPayouts({ dryRun })
      expect(run.resumed).toEqual([{ bookingId: 'booking_1', hostId: 'host_1', amount: 90, payoutId: 'payout_1', action: 'waiting-for-host-id', status: 'PENDING' }])
      expect(run.waitingForHostId).toEqual({ count: 1, amount: 90 })
    }
    expect(state.payouts[0]).toMatchObject({ status: 'PENDING', initiatedAt: null, failureReason: null, paystackTransferReference: 'pyt-original' })
    expect(state.writes).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()

    // Approved: the same row goes out, under the same reference
    hostId(approvedId)
    const run = await runPayouts()
    expect(run.resumed).toEqual([expect.objectContaining({ payoutId: 'payout_1', action: 'paid', status: 'PROCESSING' })])
    expect(sentBody().reference).toBe('pyt-original')
    expect(state.payouts).toHaveLength(1)
  })

  it('rejecting an approved ID holds payouts again, including one already under way', async () => {
    hostId(approvedId)
    stuck()
    booking({ id: 'booking_2' })
    // The approval is removed before the run: flag off, document REJECTED
    hostId({ isVerified: false, verification: { status: 'REJECTED', reviewedById: 'admin_1' } })
    const run = await runPayouts()
    expect(run.results).toEqual([{ ...waitingRow, bookingId: 'booking_2' }])
    expect(run.resumed).toEqual([expect.objectContaining({ payoutId: 'payout_1', action: 'waiting-for-host-id' })])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('raises one alert a day once the payout is 7 days overdue, and says why', async () => {
    booking()
    const run = (iso: string) => { vi.setSystemTime(at(iso)); return runPayouts({ now: at(iso) }) }
    expect((await run('2027-03-19T12:00:00Z')).overdueAlerts).toBe(0)
    expect((await run(`2027-03-20T0${OVERDUE_ALERT_HOUR_UTC}:00:00Z`)).overdueAlerts).toBe(1)
    const [message, options] = sentry.captureMessage.mock.calls[0]
    expect(message).toBe('Host payout still unpaid 7 days after it fell due')
    expect(options.contexts.payout).toMatchObject({ bookingId: 'booking_1', hostId: 'host_1', amount: 90, why: 'the host has no approved ID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('holds for the ID first when the host has no payout method either', async () => {
    state.users[0] = { id: 'host_1', paystackRecipientCode: null, payoutMethodVerifiedAt: null, isVerified: false, verification: null }
    booking()
    expect((await runPayouts()).results).toEqual([waitingRow])
    expect(heldNotices()).toHaveLength(1)
    // Approved, still no method: now it is the payout-method wait, as before
    state.users[0] = { id: 'host_1', paystackRecipientCode: null, payoutMethodVerifiedAt: null, ...approvedId }
    expect((await runPayouts()).results).toEqual([{ ...waitingRow, action: 'waiting-for-payout-method' }])
    expect(state.payouts).toHaveLength(0)
  })
})

// ─── A payout method that was only just saved ───────────────────────────────

describe('a payout method saved less than 24 hours ago', () => {
  const HOUR = 60 * 60 * 1000
  const savedAgo = (ms: number) => { state.users[0] = { id: 'host_1', ...verifiedHost, payoutMethodVerifiedAt: new Date(NOW.getTime() - ms) } }
  const waitingRow = { bookingId: 'booking_1', hostId: 'host_1', amount: 90, action: 'waiting-for-new-payout-method' }

  beforeEach(() => {
    switchesOn()
    savedAgo(1 * HOUR)
  })

  it('is not paid into yet: nothing is sent and no payout is written, live or dry', async () => {
    booking()
    expect((await runPayouts()).results).toEqual([waitingRow])
    expect((await runPayouts({ dryRun: true })).results).toEqual([waitingRow])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
    expect(state.writes).toBe(0)
  })

  it('is paid on the first run after the 24 hours are up', async () => {
    booking()
    savedAgo(23 * HOUR + 59 * 60 * 1000)
    expect((await runPayouts()).results).toEqual([waitingRow])
    savedAgo(24 * HOUR)
    expect((await runPayouts()).results).toEqual([expect.objectContaining({ action: 'paid', status: 'PROCESSING' })])
    expect(transferCalls()).toHaveLength(1)
  })

  it('initiateHostPayout refuses it before creating or claiming a row', async () => {
    booking()
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toThrow('changed their payout method less than 24 hours ago')
    expect(state.payouts).toHaveLength(0)
    expect(state.writes).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not resume a PENDING payout to it, and leaves the row as it was', async () => {
    booking()
    state.payouts.push({
      id: 'payout_1', hostId: 'host_1', bookingId: 'booking_1', amount: 90, status: 'PENDING', retryCount: 0,
      paystackTransferCode: null, paystackTransferReference: 'pyt-original', failureReason: null,
      createdAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1000), initiatedAt: null,
    })
    for (const dryRun of [false, true]) {
      expect((await runPayouts({ dryRun })).resumed).toEqual([expect.objectContaining({ payoutId: 'payout_1', action: 'waiting-for-new-payout-method', status: 'PENDING' })])
    }
    expect(state.payouts[0]).toMatchObject({ status: 'PENDING', initiatedAt: null, failureReason: null })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
    savedAgo(25 * HOUR)
    expect((await runPayouts()).resumed).toEqual([expect.objectContaining({ payoutId: 'payout_1', action: 'paid' })])
  })

  it('still reports a missing ID first, and a missing method as before', async () => {
    booking()
    state.users[0] = { ...state.users[0], isVerified: false, verification: null }
    expect((await runPayouts()).results).toEqual([{ ...waitingRow, action: 'waiting-for-host-id' }])
    state.users[0] = { id: 'host_1', paystackRecipientCode: null, payoutMethodVerifiedAt: null, ...approvedId }
    expect((await runPayouts()).results).toEqual([{ ...waitingRow, action: 'waiting-for-payout-method' }])
  })
})

// ─── A run that died part-way ───────────────────────────────────────────────

describe('a payout left PENDING by a run that died', () => {
  beforeEach(switchesOn)
  const stuck = (over: Row = {}) => {
    booking()
    state.payouts.push({
      id: 'payout_1', hostId: 'host_1', bookingId: 'booking_1', amount: 90, status: 'PENDING', retryCount: 0,
      paystackTransferCode: null, paystackTransferReference: 'pyt-original', failureReason: null,
      createdAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1000), initiatedAt: null, ...over,
    })
  }

  it('is sent again with the same reference', async () => {
    stuck({ initiatedAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1000) })
    const run = await runPayouts()
    expect(run.checked).toBe(0)
    expect(run.resumed).toEqual([expect.objectContaining({ payoutId: 'payout_1', action: 'paid', status: 'PROCESSING' })])
    expect(transferCalls()).toHaveLength(1)
    expect(sentBody().reference).toBe('pyt-original')
    expect(state.payouts).toHaveLength(1)
  })

  it('is left alone while another run may still be sending it', async () => {
    stuck({ initiatedAt: new Date(NOW.getTime() - 60_000) })
    const run = await runPayouts()
    expect(run.resumed).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is only reported in a dry run', async () => {
    stuck()
    const run = await runPayouts({ dryRun: true })
    expect(run.resumed).toEqual([expect.objectContaining({ payoutId: 'payout_1', action: 'would-pay' })])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })

  it('is sent once when two runs pick it up together', async () => {
    stuck()
    await Promise.all([runPayouts(), runPayouts()])
    expect(transferCalls()).toHaveLength(1)
  })
})

// ─── Cancelled or refunded stays ────────────────────────────────────────────

describe('a cancelled or refunded stay', () => {
  beforeEach(switchesOn)

  it('is refused a payout when called directly', async () => {
    for (const status of ['CANCELLED', 'DECLINED']) {
      const b = booking({ status })
      await expect(initiateHostPayout({ hostId: 'host_1', bookingId: b.id as string, amount: 90 })).rejects.toThrow(/cancelled or refunded/)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('is refused a payout once a refund is on record, whatever its status says', async () => {
    booking({ refund: { id: 'refund_1' } })
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toThrow(/cancelled or refunded/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not have a stuck payout resumed after the cancellation', async () => {
    booking({ status: 'CANCELLED', refund: { id: 'refund_1' } })
    state.payouts.push({
      id: 'payout_1', hostId: 'host_1', bookingId: 'booking_1', amount: 90, status: 'PENDING', retryCount: 0,
      paystackTransferCode: null, paystackTransferReference: 'pyt-original', failureReason: null,
      createdAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1000), initiatedAt: null,
    })
    const run = await runPayouts()
    expect(run.resumed[0]).toMatchObject({ action: 'error', error: expect.stringMatching(/cancelled or refunded/) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── Disputes ───────────────────────────────────────────────────────────────

describe('disputes and payouts', () => {
  beforeEach(switchesOn)
  const guestDispute = (status: string) => [{ raisedByRole: 'GUEST', status }]

  it("holds the payout while the guest's dispute is open or under review", async () => {
    booking({ disputes: guestDispute('OPEN') })
    booking({ disputes: guestDispute('UNDER_REVIEW') })
    for (let i = 0; i < 3; i++) expect((await runPayouts()).checked).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('refuses to start a transfer for a booking with an open guest dispute', async () => {
    booking({ disputes: guestDispute('OPEN') })
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 90 })).rejects.toThrow(/open dispute: payout on hold/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })

  it('pays in full on the next run once the dispute is decided against the guest', async () => {
    const b = booking({ disputes: guestDispute('OPEN') })
    await runPayouts()
    ;(b.disputes as Row[])[0].status = 'RESOLVED'
    const run = await runPayouts()
    expect(run.results[0]).toMatchObject({ action: 'paid', amount: 90 })
    expect(transferCalls()).toHaveLength(1)
  })

  it("is not held by a host's dispute, which is about the deposit", async () => {
    booking({ disputes: [{ raisedByRole: 'HOST', status: 'OPEN' }] })
    expect((await runPayouts()).results[0]).toMatchObject({ action: 'paid' })
  })

  it('pays the host their share of what is left after a part refund', async () => {
    booking({ subtotal: 400, paymentStatus: 'PARTIALLY_REFUNDED', disputes: guestDispute('RESOLVED'), refund: { reason: 'DISPUTE_PARTIAL', stayRefund: 150 } })
    const run = await runPayouts()
    expect(run.results[0]).toMatchObject({ action: 'paid', amount: 225 })
    // $225 at 15 cedis to the dollar
    expect(sentBody().amount).toBe(337500)
    expect(state.payouts[0]).toMatchObject({ amount: 225 })
  })

  it('pays the same share while the part refund is still on its way', async () => {
    booking({ subtotal: 400, paymentStatus: 'PAID', refund: { reason: 'DISPUTE_PARTIAL', stayRefund: 150 } })
    expect((await runPayouts()).results[0]).toMatchObject({ action: 'paid', amount: 225 })
  })

  it('pays in full when only the deposit went back to the guest', async () => {
    booking({ subtotal: 400, paymentStatus: 'PARTIALLY_REFUNDED', refund: { reason: 'DISPUTE_DEPOSIT', stayRefund: 0 } })
    expect((await runPayouts()).results[0]).toMatchObject({ action: 'paid', amount: 360 })
  })

  it('never pays after a full refund from a dispute', async () => {
    booking({ subtotal: 400, paymentStatus: 'REFUNDED', refund: { reason: 'DISPUTE_FULL', stayRefund: 400 } })
    booking({ subtotal: 400, paymentStatus: 'PAID', refund: { reason: 'DISPUTE_FULL', stayRefund: 400 } })
    expect((await runPayouts()).checked).toBe(0)
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_2', amount: 0 })).rejects.toThrow(/cancelled or refunded/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a transfer bigger than the host's share of what is left", async () => {
    booking({ subtotal: 400, refund: { reason: 'DISPUTE_PARTIAL', stayRefund: 150 } })
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_1', amount: 360 })).rejects.toThrow(/more than the host's share/)
    booking({ subtotal: 400 })
    await expect(initiateHostPayout({ hostId: 'host_1', bookingId: 'booking_2', amount: 400 })).rejects.toThrow(/more than the host's share/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.payouts).toHaveLength(0)
  })
})

// ─── Completion ─────────────────────────────────────────────────────────────

describe('completion', () => {
  beforeEach(switchesOn)

  it('completes paid, confirmed stays whose check-out has passed, and only those', async () => {
    const done = booking()
    booking({ paymentStatus: 'UNPAID' })
    booking({ status: 'CANCELLED' })
    booking({ status: 'PENDING' })
    booking({ checkOut: at('2027-03-12T13:00:00Z') })
    const run = await runCompletion()
    expect(run).toEqual({ mode: 'live', transitioned: 1, bookingIds: [done.id] })
    expect(state.bookings.map((b) => b.status)).toEqual(['COMPLETED', 'CONFIRMED', 'CANCELLED', 'PENDING', 'CONFIRMED'])
    expect((await runCompletion()).transitioned).toBe(0)
  })

  it('changes nothing in a dry run', async () => {
    booking()
    const run = await runCompletion({ dryRun: true })
    expect(run).toEqual({ mode: 'dry-run', reason: 'dryRun was requested', transitioned: 0, bookingIds: ['booking_1'] })
    expect(state.bookings[0].status).toBe('CONFIRMED')
  })

  it('never calls Paystack', async () => {
    booking()
    await runCompletion()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── Guest cancellation ─────────────────────────────────────────────────────

describe('guest cancellation', () => {
  const checkIn = at('2027-03-11T12:00:00Z')

  it('is allowed up to the day before check-in, with no payout', () => {
    expect(cancelNeedsSupport(checkIn, false, at('2027-03-01T10:00:00Z'))).toBe(false)
    expect(cancelNeedsSupport(checkIn, false, at('2027-03-10T23:59:59Z'))).toBe(false)
  })

  it('goes to support from the check-in day in Ghana onwards', () => {
    expect(cancelNeedsSupport(checkIn, false, at('2027-03-11T00:00:00Z'))).toBe(true)
    expect(cancelNeedsSupport(checkIn, false, at('2027-03-11T12:00:00Z'))).toBe(true)
    expect(cancelNeedsSupport(checkIn, false, at('2027-03-15T09:00:00Z'))).toBe(true)
  })

  it('goes to support whenever a payout exists', () => {
    expect(cancelNeedsSupport(checkIn, true, at('2027-03-01T10:00:00Z'))).toBe(true)
  })

  it('tells the guest to contact support', () => {
    expect(CANCEL_CONTACT_SUPPORT).toMatch(/contact support/)
  })
})

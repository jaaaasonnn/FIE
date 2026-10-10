import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real templates, notify and sending job, run against an in-memory
// stand-in for the database and two fake provider adapters. No test may
// reach a real provider, a real database or the network.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  logs: [] as Row[], notifications: [] as Row[], users: [] as Row[],
  booking: null as Row | null, refund: null as Row | null, payout: null as Row | null,
  dispute: null as Row | null, disputeEvent: null as Row | null, message: null as Row | null,
  listing: null as Row | null, verification: null as Row | null, review: null as Row | null,
  instalment: null as Row | null, listingCheck: null as Row | null,
  breakOn: '' as string, writes: 0,
}))
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(), captureMessage: vi.fn(),
  withMonitor: (_name: string, fn: () => unknown) => fn(),
}))
const fake = vi.hoisted(() => ({ email: vi.fn(), sms: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'hash', compare: async () => true } }))
// The only adapters the code under test can find are these two fakes
vi.mock('@/lib/messaging/providers', () => ({
  PROVIDERS: {
    'fake-email': { name: 'fake-email', channel: 'EMAIL', send: fake.email },
    'fake-sms': { name: 'fake-sms', channel: 'SMS', send: fake.sms },
  },
}))

vi.mock('@/lib/db', async () => {
  const { Prisma } = await import('@prisma/client')
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' })
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
      const value = row[key] ?? null
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; lte?: Date }
        if ('in' in c && !c.in!.includes(value)) return false
        if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
        return true
      }
      return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond
    })
  const apply = (row: Row, data: Row) => {
    for (const [key, v] of Object.entries(data)) {
      row[key] = v !== null && typeof v === 'object' && 'increment' in v ? (row[key] as number) + (v as { increment: number }).increment : v
    }
    state.writes++
  }
  const one = (name: 'booking' | 'refund' | 'payout' | 'dispute' | 'disputeEvent' | 'message' | 'listing' | 'verification' | 'review' | 'instalment' | 'listingCheck') => ({
    findUnique: async () => {
      if (state.breakOn === name) throw new Error(`${name} table is down`)
      return state[name] ? { ...state[name] } : null
    },
  })
  return {
    db: {
      booking: one('booking'), refund: one('refund'), payout: one('payout'), dispute: one('dispute'),
      disputeEvent: one('disputeEvent'), message: one('message'), listing: one('listing'),
      verification: one('verification'), review: one('review'), instalment: one('instalment'), listingCheck: one('listingCheck'),
      exchangeRate: { findFirst: async () => ({ usdToGhs: 15.5 }) },
      user: {
        findMany: async ({ where }: { where: Row }) => state.users.filter((u) => matches(u, where)).map((u) => ({ ...u })),
        findUnique: async ({ where }: { where: Row }) => {
          const row = state.users.find((u) => matches(u, where))
          return row ? { ...row } : null
        },
        create: async ({ data }: { data: Row }) => {
          const row = { id: `user_${state.users.length + 1}`, role: 'GUEST', optionalEmails: true, ...data }
          state.users.push(row)
          return { ...row }
        },
      },
      notification: {
        create: async ({ data }: { data: Row }) => { state.notifications.push({ ...data }); return data },
      },
      messageLog: {
        create: async ({ data }: { data: Row }) => {
          if (state.breakOn === 'messageLog') throw new Error('messageLog table is down')
          // The unique index on dedupeKey
          if (state.logs.some((l) => l.dedupeKey === data.dedupeKey)) throw known('P2002')
          const row = {
            id: `msg_${state.logs.length + 1}`, attempts: 0, claimedAt: null, nextAttemptAt: null, sentAt: null,
            alertedAt: null, providerMessageId: null, createdAt: new Date(), ...data,
          }
          state.logs.push(row)
          return { ...row }
        },
        findMany: async ({ where, take }: { where: Row; take?: number }) => {
          await tick()
          return state.logs.filter((l) => matches(l, where)).slice(0, take).map((l) => ({ ...l }))
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const rows = state.logs.filter((l) => matches(l, where))
          rows.forEach((r) => apply(r, data))
          return { count: rows.length }
        },
        update: async ({ where, data }: { where: Row; data: Row }) => {
          const row = state.logs.find((l) => l.id === where.id)!
          apply(row, data)
          return { ...row }
        },
      },
    },
  }
})

import { normalizeEmail } from '@/lib/utils'
import { channelGate } from '@/lib/messaging/config'
import { ghanaDate, ghanaTime, ghs, maskEmail, maskPhone, scrub, sms, smsGhs, smsSafe } from '@/lib/messaging/format'
import { EVENT_NAMES, SAMPLE_FACTS, TEMPLATES, emailFooter, emailText, type Facts, type Piece, type Template } from '@/lib/messaging/templates'
import { MESSAGE_ALERT_WINDOW_MS } from '@/lib/messaging/events'
import { notify, writeMessages } from '@/lib/messaging/notify'
import { MAX_ATTEMPTS, runMessages } from '@/lib/messaging/deliver'
import { emailHtml } from '@/lib/messaging/emailHtml'
import { GET as sendMessagesCron } from '@/app/api/cron/send-messages/route'
import { POST as signup } from '@/app/api/auth/signup/route'

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2027-03-01T10:00:00Z')
const MIN = 60 * 1000
const GUEST_EMAIL = 'ama.owusu@example.test'
const HOST_EMAIL = 'kwame.mensah@example.test'
const GUEST_PHONE = '+233241234567'
const HOST_PHONE = '+233209876543'

const render = (event: string, facts: Facts = SAMPLE_FACTS): Piece[] => (TEMPLATES as Record<string, Template>)[event].render(facts)
const allText = (piece: Piece): string[] => [
  ...(piece.email ? [piece.email.subject, ...piece.email.lines, piece.email.link?.label ?? ''] : []),
  ...(piece.sms ? [piece.sms] : []),
  ...(piece.inApp ? [piece.inApp.title, piece.inApp.body] : []),
]
const log = (where: Row = {}) => state.logs.filter((l) => Object.entries(where).every(([k, v]) => l[k] === v))
const one = (where: Row) => {
  const rows = log(where)
  expect(rows).toHaveLength(1)
  return rows[0]
}
const live = () => {
  vi.stubEnv('MESSAGING_ENABLED', 'true')
  vi.stubEnv('EMAIL_PROVIDER', 'fake-email')
  vi.stubEnv('SMS_PROVIDER', 'fake-sms')
}
const at = (ms: number) => new Date(NOW.getTime() + ms)
const alerts = () => sentry.captureMessage.mock.calls.map(([, options]) => options.tags.messaging_issue)

/** A paid booking of $386 (598,300 pesewas) between a guest and a host who both have an email and a phone. */
function world(over: { guest?: Row; host?: Row; booking?: Row } = {}) {
  state.users.push(
    { id: 'guest_1', name: 'Ama Owusu', email: GUEST_EMAIL, phone: GUEST_PHONE, role: 'GUEST', optionalEmails: true, ...over.guest },
    { id: 'host_1', name: 'Kwame Mensah', email: HOST_EMAIL, phone: HOST_PHONE, role: 'HOST', optionalEmails: true, ...over.host },
    { id: 'admin_1', name: 'Admin One', email: null, phone: null, role: 'ADMIN', optionalEmails: true },
    { id: 'admin_2', name: 'Admin Two', email: 'second.admin@example.test', phone: null, role: 'ADMIN', optionalEmails: true },
  )
  state.booking = {
    id: 'booking_1', guestId: 'guest_1', hostId: 'host_1', status: 'CONFIRMED', paymentStatus: 'PAID',
    checkIn: new Date('2027-03-09T12:00:00Z'), checkOut: new Date('2027-03-12T12:00:00Z'),
    subtotal: 300, totalPrice: 386, payBy: new Date('2027-03-02T15:45:00Z'), cancelReason: null,
    listing: { id: 'listing_1', title: 'Sea-view apartment in Labadi' },
    guest: { id: 'guest_1', name: 'Ama Owusu' },
    host: { id: 'host_1', name: 'Kwame Mensah', paystackRecipientCode: 'RCP_1', payoutMethodVerifiedAt: NOW },
    payments: [{ amountPesewas: 598_300 }],
    refund: null,
    instalments: [],
    ...over.booking,
  }
}

beforeEach(() => {
  for (const key of ['logs', 'notifications', 'users'] as const) state[key].length = 0
  for (const key of ['booking', 'refund', 'payout', 'dispute', 'disputeEvent', 'message', 'listing', 'verification', 'review', 'instalment', 'listingCheck'] as const) state[key] = null
  state.breakOn = ''
  state.writes = 0
  sentry.captureException.mockReset()
  sentry.captureMessage.mockReset()
  fake.email.mockReset()
  fake.sms.mockReset()
  fake.email.mockResolvedValue({ ok: true, providerMessageId: 'em_1' })
  fake.sms.mockResolvedValue({ ok: true, providerMessageId: 'sm_1' })
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_URL', 'https://fiegh.com')
  vi.stubEnv('CRON_SECRET', 'cron_secret')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

// ─── Templates ──────────────────────────────────────────────────────────────

/** Facts built to break things: a very long title with accents and symbols, big amounts, long names. */
const WORST: Facts = {
  ...SAMPLE_FACTS,
  appUrl: 'https://www.fiegh.com',
  title: 'Très élégante villa “Akwaaba” — 6 chambres, piscine & jardin ₵ ✨ à côté de la plage de Labadi, Accra, Ghana, with a very long name indeed',
  totalUsd: 123_456.78, paidPesewas: 191_358_009, refundUsd: 123_456.78, refundPesewas: 191_358_009,
  payoutUsd: 98_765.43, payoutPesewas: 153_086_417,
  guestName: 'Nana Akosua Zebedee Quartey-Papafio', hostName: 'Yaaba Xylophone Agyeman-Duah',
  bookingId: 'cmzzzzzzzzzzzzzzzzzzzzzzz9',
}

describe('templates', () => {
  it.each(EVENT_NAMES)('%s renders with nothing missing', (event) => {
    for (const facts of [SAMPLE_FACTS, WORST, { ...SAMPLE_FACTS, raisedByRole: 'HOST' as const, expiredFor: 'NO_HOST_RESPONSE' as const, verificationStatus: 'REJECTED', reviewPublished: false, refundUsd: null, refundPesewas: null, payBy: null, paidPesewas: null }]) {
      const pieces = render(event, facts)
      expect(pieces.length).toBeGreaterThan(0)
      for (const piece of pieces) {
        expect(piece.email || piece.sms || piece.inApp).toBeTruthy()
        for (const text of allText(piece)) expect(text).not.toMatch(/undefined|null|NaN|\[object/)
      }
    }
  })

  it('keeps every SMS to one plain segment, even with the longest title and amounts', () => {
    let seen = 0
    for (const event of EVENT_NAMES) {
      for (const facts of [SAMPLE_FACTS, WORST]) {
        for (const piece of render(event, facts)) {
          if (!piece.sms) continue
          seen++
          expect(piece.sms.length, `${event}: ${piece.sms}`).toBeLessThanOrEqual(160)
          expect(piece.sms, event).toMatch(/^[\x20-\x7E]+$/)
          // The cedi sign would force the costly encoding
          expect(piece.sms).not.toContain('₵')
          expect(piece.sms.startsWith('FieGH: ')).toBe(true)
        }
      }
    }
    expect(seen).toBeGreaterThan(10)
  })

  it('sends SMS for the agreed events only', () => {
    const withSms = EVENT_NAMES.flatMap((event) => render(event).filter((p) => p.sms).map((p) => `${event} > ${p.to}`))
    expect(withSms.sort()).toEqual([
      'booking.accepted > guest',
      'booking.cancelled_by_guest > host',
      'booking.cancelled_by_host > guest',
      'booking.confirmed > guest',
      'booking.confirmed > host',
      'booking.requested > host',
      'payout.sent > host',
      'payout.waiting > host',
      'payout_method.changed > user',
      // Rent reminders, to the tenant
      'rent.due_soon > guest',
      'rent.due_today > guest',
      'rent.overdue > guest',
    ])
    // ID outcomes are email (and in-app) only
    expect(render('verification.decided')[0].sms).toBeUndefined()
  })

  it('keeps names, phone numbers and account details out of every SMS', () => {
    const facts = { ...WORST, payoutMethodLabel: 'MTN Mobile Money, ending 4567', cancelReason: 'Call me on 0241234567' }
    for (const event of EVENT_NAMES) {
      for (const piece of render(event, facts)) {
        if (!piece.sms) continue
        expect(piece.sms).not.toMatch(/Zebedee|Quartey|Akosua|Yaaba|Xylophone|Agyeman/)
        expect(piece.sms).not.toMatch(/4567|0241234567|\+233/)
      }
    }
  })

  it('marks only the agreed events as optional', () => {
    const optional = EVENT_NAMES.filter((event) => (TEMPLATES as Record<string, Template>)[event].optional)
    expect(optional.sort()).toEqual(['account.became_host', 'account.welcome', 'booking.completed', 'message.received', 'review.received'])
  })

  it('writes what was paid in the cedis charged, and what is not yet paid in dollars with cedis as a guide', () => {
    const [guest] = render('booking.confirmed')
    expect(guest.email!.lines.join(' ')).toContain('GH₵ 5,983.00 ($386.00)')
    expect(guest.sms).toContain('We received GHS 5,983.00.')
    const [host] = render('booking.requested')
    expect(host.email!.lines.join(' ')).toContain('$386.00 (about GH₵ 5,983)')
    // The stored cedis are used, not today's rate: a different rate changes nothing that was paid
    expect(render('booking.confirmed', { ...SAMPLE_FACTS, usdToGhs: 99 })[0].email!.lines.join(' ')).toContain('GH₵ 5,983.00 ($386.00)')
    expect(render('payout.sent')[0].sms).toContain('GHS 4,278.00')
    expect(render('payout.sent', { ...SAMPLE_FACTS, payoutPesewas: null })[0].sms).toContain('$276.00')
  })

  it('writes dates as Ghana dates, the same in every time zone', () => {
    expect(render('booking.confirmed')[0].email!.lines[1]).toContain('from Tue 9 Mar 2027 to Fri 12 Mar 2027')
    expect(render('booking.confirmed')[0].sms).toContain('9 Mar-12 Mar')
    expect(render('booking.accepted')[0].email!.lines.join(' ')).toContain('Please pay by Tue 2 Mar 2027 at 3:45 pm (Ghana time)')
    expect(render('booking.accepted')[0].sms).toContain('Pay by 2 Mar 3:45 pm GMT')
    expect(ghanaDate(new Date('2027-12-31T23:59:59Z'))).toBe('Fri 31 Dec 2027')
    expect(ghanaTime(new Date('2027-03-01T00:05:00Z'))).toBe('12:05 am')
    expect(ghanaTime(new Date('2027-03-01T12:00:00Z'))).toBe('12:00 pm')
  })

  it('uses plain, friendly wording: no em-dashes, no emoji', () => {
    for (const event of EVENT_NAMES) {
      for (const piece of render(event)) {
        for (const text of allText(piece)) expect(text, event).not.toMatch(/[–—]|\p{Extended_Pictographic}/u)
      }
    }
  })

  it('says how to turn an optional email off, and that the others are always sent', () => {
    const facts = { appUrl: 'https://fiegh.com', supportEmail: 'support@fiegh.com' }
    expect(emailFooter(facts, true)).toContain('https://fiegh.com/profile/edit')
    expect(emailFooter(facts, false)).toContain('always sent')
    const text = emailText(render('account.welcome')[0].email!, facts.appUrl, emailFooter(facts, true))
    expect(text).toContain('Find a home: https://fiegh.com/search')
    const html = emailHtml('Welcome to FieGH', text)
    expect(html).toContain('href="https://fiegh.com/search"')
    expect(html).toContain('#C9932E')
    // Text from a listing title can never become markup
    expect(emailHtml('<b>x</b>', 'A <script>alert(1)</script> home\n\nfooter')).not.toContain('<script>')
  })
})

describe('formatting', () => {
  it('writes cedis from pesewas', () => {
    expect(ghs(123_456_789)).toBe('GH₵ 1,234,567.89')
    expect(smsGhs(50)).toBe('GHS 0.50')
  })

  it('makes any text safe for a plain SMS', () => {
    expect(smsSafe('Café “Akwaaba” — ₵50 ✨')).toBe('Cafe "Akwaaba" - GHS50')
    expect(sms('A'.repeat(300), (t) => `FieGH: "${t}" ${'x'.repeat(100)}`).length).toBeLessThanOrEqual(160)
    expect(sms(undefined, (t) => `FieGH: ${t}`)).toBe('FieGH: your booking')
    expect(sms('✨', (t) => `FieGH: ${t}`)).toBe('FieGH: your booking')
  })

  it('masks addresses and scrubs them out of provider errors', () => {
    expect(maskEmail('kofi.mensah@gmail.com')).toBe('k***@gmail.com')
    expect(maskPhone('+233241234567')).toBe('+233 24 *** **67')
    expect(scrub('550 mailbox kofi.mensah@gmail.com unavailable, tried +233 24 123 4567')).toBe('550 mailbox [email] unavailable, tried [number]')
    expect(scrub('x'.repeat(1000))).toHaveLength(300)
  })

  it('accepts only plausible email addresses, trimmed and lower-cased', () => {
    expect(normalizeEmail('  Ama.Owusu@Example.COM ')).toBe('ama.owusu@example.com')
    for (const bad of ['', 'ama', 'ama@', '@example.com', 'ama@example', 'ama owusu@example.com', 'ama@exa mple.com', null, 42, `${'a'.repeat(250)}@example.com`]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull()
    }
  })
})

// ─── The switch ─────────────────────────────────────────────────────────────

describe('the messaging switch', () => {
  it.each(['', '1', 'TRUE', 'yes', 'on'])('is off with MESSAGING_ENABLED=%j', (value) => {
    vi.stubEnv('MESSAGING_ENABLED', value)
    vi.stubEnv('EMAIL_PROVIDER', 'fake-email')
    expect(channelGate('EMAIL')).toMatchObject({ live: false, provider: 'log', reason: 'MESSAGING_ENABLED is not set to true' })
  })

  it('stays log-only when switched on with no provider, the log provider, or a name with no adapter', () => {
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    for (const provider of ['', 'log', 'postmark', 'fake-sms']) {
      vi.stubEnv('EMAIL_PROVIDER', provider)
      expect(channelGate('EMAIL')).toMatchObject({ live: false, provider: 'log' })
    }
    // Each says why, so the admin page can
    vi.stubEnv('EMAIL_PROVIDER', '')
    expect(channelGate('EMAIL')).toMatchObject({ reason: 'EMAIL_PROVIDER is not set, so messages are only logged' })
    vi.stubEnv('EMAIL_PROVIDER', 'postmark')
    expect(channelGate('EMAIL')).toMatchObject({ reason: 'EMAIL_PROVIDER names no email adapter' })
  })

  it('goes live per channel, so email can be on while SMS is not', () => {
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    vi.stubEnv('EMAIL_PROVIDER', 'fake-email')
    expect(channelGate('EMAIL')).toEqual({ live: true, provider: 'fake-email' })
    expect(channelGate('SMS')).toMatchObject({ live: false, provider: 'log' })
  })
})

// ─── notify ─────────────────────────────────────────────────────────────────

describe('recording an event', () => {
  it('logs every message and sends none while messaging is off', async () => {
    world({ booking: { status: 'PENDING', paymentStatus: 'UNPAID', payments: [] } })
    expect(await writeMessages('booking.requested', { bookingId: 'booking_1' })).toEqual({ written: 4, failed: false })

    expect(one({ userId: 'host_1', channel: 'EMAIL' })).toMatchObject({
      event: 'booking.requested', recipientRole: 'HOST', status: 'LOGGED', provider: 'log', bookingId: 'booking_1',
      subject: 'New booking request for Sea-view apartment in Labadi', recipientMasked: 'k***@example.test',
    })
    expect(one({ userId: 'host_1', channel: 'SMS' })).toMatchObject({ status: 'LOGGED', recipientMasked: '+233 20 *** **43' })
    expect(one({ userId: 'guest_1', channel: 'EMAIL' })).toMatchObject({ status: 'LOGGED', recipientRole: 'GUEST' })
    // The in-app notice is new for this event, and written once
    expect(one({ userId: 'host_1', channel: 'IN_APP' })).toMatchObject({ status: 'SENT', provider: 'in-app' })
    expect(state.notifications).toEqual([expect.objectContaining({ userId: 'host_1', type: 'BOOKING_REQUESTED', title: 'New booking request' })])

    expect(fake.email).not.toHaveBeenCalled()
    expect(fake.sms).not.toHaveBeenCalled()
  })

  it('never stores a real address or number in the log', async () => {
    world()
    await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
    const stored = JSON.stringify(state.logs)
    for (const secret of [GUEST_EMAIL, HOST_EMAIL, GUEST_PHONE, HOST_PHONE, '241234567', '209876543']) expect(stored).not.toContain(secret)
  })

  it.each(['', '1', 'TRUE'])('queues nothing with MESSAGING_ENABLED=%j', async (value) => {
    vi.stubEnv('MESSAGING_ENABLED', value)
    vi.stubEnv('EMAIL_PROVIDER', 'fake-email')
    vi.stubEnv('SMS_PROVIDER', 'fake-sms')
    world()
    await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
    expect(log({ status: 'QUEUED' })).toHaveLength(0)
    expect(log({ status: 'LOGGED' })).toHaveLength(4)
  })

  it('queues for sending only on a channel that is live', async () => {
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    vi.stubEnv('EMAIL_PROVIDER', 'fake-email')
    world()
    await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
    expect(log({ channel: 'EMAIL' }).map((l) => l.status)).toEqual(['QUEUED', 'QUEUED'])
    expect(log({ channel: 'SMS' }).map((l) => l.status)).toEqual(['LOGGED', 'LOGGED'])
  })

  it('writes nothing the second time the same event is raised', async () => {
    world({ booking: { status: 'PENDING', paymentStatus: 'UNPAID', payments: [] } })
    await writeMessages('booking.requested', { bookingId: 'booking_1' })
    expect(await writeMessages('booking.requested', { bookingId: 'booking_1' })).toEqual({ written: 0, failed: false })
    await Promise.all([writeMessages('booking.requested', { bookingId: 'booking_1' }), writeMessages('booking.requested', { bookingId: 'booking_1' })])
    expect(state.logs).toHaveLength(4)
    expect(state.notifications).toHaveLength(1)
    expect(new Set(state.logs.map((l) => l.dedupeKey)).size).toBe(4)
  })

  it('skips a channel the person cannot be reached on, and says why', async () => {
    world({ guest: { phone: null }, host: { email: null, phone: '0241' } })
    await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
    expect(one({ userId: 'guest_1', channel: 'SMS' })).toMatchObject({ status: 'SKIPPED', error: 'no phone number', recipientMasked: null })
    expect(one({ userId: 'guest_1', channel: 'EMAIL' })).toMatchObject({ status: 'LOGGED' })
    expect(one({ userId: 'host_1', channel: 'EMAIL' })).toMatchObject({ status: 'SKIPPED', error: 'no email address' })
    expect(one({ userId: 'host_1', channel: 'SMS' })).toMatchObject({ status: 'SKIPPED', error: 'the stored phone number is not a valid Ghana number' })
    // The in-app notice still reaches the host
    expect(state.notifications).toHaveLength(1)
  })

  it('still records a person with neither an email nor a phone, and reaches them in the app', async () => {
    world({ host: { email: null, phone: null }, booking: { status: 'PENDING', paymentStatus: 'UNPAID', payments: [] } })
    expect((await writeMessages('booking.requested', { bookingId: 'booking_1' })).failed).toBe(false)
    expect(log({ userId: 'host_1' }).map((l) => `${l.channel} ${l.status}`).sort()).toEqual(['EMAIL SKIPPED', 'IN_APP SENT', 'SMS SKIPPED'])
  })

  describe('admin messages', () => {
    const cancelled = () => world({ booking: { status: 'CANCELLED', cancelReason: 'OTHER: call me on 0241234567', refund: { id: 'refund_1', amount: 386, amountPesewas: 598_300, stayRefund: 300 } } })

    it('fall back to each admin who has an email address when ADMIN_ALERT_EMAIL is unset', async () => {
      cancelled()
      await writeMessages('booking.cancelled_by_host', { bookingId: 'booking_1' })
      // admin_1 has no email; admin_2 does
      expect(log({ recipientRole: 'ADMIN', channel: 'EMAIL' })).toHaveLength(1)
      expect(one({ recipientRole: 'ADMIN', channel: 'EMAIL' })).toMatchObject({ status: 'LOGGED', userId: 'admin_2', recipientMasked: 's***@example.test' })
      // Raised again, it writes nothing more
      expect((await writeMessages('booking.cancelled_by_host', { bookingId: 'booking_1' })).written).toBe(0)
    })

    it('are skipped, with the reason, when there is no inbox and no admin has an email', async () => {
      cancelled()
      state.users.find((u) => u.id === 'admin_2')!.email = null
      await writeMessages('booking.cancelled_by_host', { bookingId: 'booking_1' })
      expect(one({ recipientRole: 'ADMIN', channel: 'EMAIL' })).toMatchObject({
        status: 'SKIPPED', error: 'ADMIN_ALERT_EMAIL is not set and no admin has an email address', userId: null, recipientMasked: null,
      })
    })

    it('never go to the admins\' own addresses when the shared inbox is set', async () => {
      vi.stubEnv('ADMIN_ALERT_EMAIL', 'ops@fiegh.com')
      cancelled()
      await writeMessages('booking.cancelled_by_host', { bookingId: 'booking_1' })
      expect(log({ recipientRole: 'ADMIN', channel: 'EMAIL' }).map((l) => l.userId)).toEqual([null])
    })

    it('go to the one shared inbox when it is set', async () => {
      vi.stubEnv('ADMIN_ALERT_EMAIL', ' Ops@FieGH.com ')
      cancelled()
      await writeMessages('booking.cancelled_by_host', { bookingId: 'booking_1' })
      expect(one({ recipientRole: 'ADMIN', channel: 'EMAIL' })).toMatchObject({ status: 'LOGGED', userId: null, recipientMasked: 'o***@fiegh.com' })
    })

    it('carry the reason from the list only, never the host\'s own note', async () => {
      cancelled()
      await writeMessages('booking.cancelled_by_host', { bookingId: 'booking_1' })
      const body = one({ recipientRole: 'ADMIN', channel: 'EMAIL' }).body as string
      expect(body).toContain('Reason given: Another reason.')
      expect(JSON.stringify(state.logs)).not.toContain('0241234567')
    })

    it('reach every admin in the app when the event has an in-app notice', async () => {
      world({ booking: { status: 'CANCELLED', refund: { id: 'refund_1', amount: 386, amountPesewas: 598_300, stayRefund: 300 } } })
      await writeMessages('payment.late_refund', { bookingId: 'booking_1' })
      expect(log({ channel: 'IN_APP', recipientRole: 'ADMIN' }).map((l) => l.userId).sort()).toEqual(['admin_1', 'admin_2'])
      expect(state.notifications.map((n) => n.userId).sort()).toEqual(['admin_1', 'admin_2'])
    })
  })

  describe('optional emails', () => {
    const message = () => {
      state.message = {
        senderId: 'host_1', receiverId: 'guest_1', bookingId: null, listingId: 'listing_1', createdAt: NOW, content: 'THE SECRET TEXT OF THE MESSAGE',
        sender: { name: 'Kwame Mensah' }, receiver: { name: 'Ama Owusu', role: 'GUEST' }, listing: { title: 'Sea-view apartment in Labadi' }, booking: null,
      }
    }

    it('are skipped for someone who turned them off', async () => {
      world({ guest: { optionalEmails: false } })
      message()
      await writeMessages('message.received', { messageId: 'message_1' })
      expect(one({ event: 'message.received' })).toMatchObject({ status: 'SKIPPED', error: 'optional emails are turned off' })
    })

    it('do not switch off anything about a booking or a payment', async () => {
      world({ guest: { optionalEmails: false }, host: { optionalEmails: false } })
      await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
      expect(log({ channel: 'EMAIL' }).map((l) => l.status)).toEqual(['LOGGED', 'LOGGED'])
    })

    it('tell someone about a new message without the message itself, once per half hour', async () => {
      world()
      message()
      await writeMessages('message.received', { messageId: 'message_1' })
      const row = one({ event: 'message.received' })
      expect(row).toMatchObject({ channel: 'EMAIL', userId: 'guest_1', status: 'LOGGED', subject: 'You have a new message on FieGH' })
      expect(row.body).toContain('Kwame sent you a message about Sea-view apartment in Labadi.')
      expect(row.body).not.toContain('SECRET')
      expect(row.body).toContain('https://fiegh.com/dashboard/guest/messages')

      // Another message a few minutes later in the same half hour: no second email
      state.message!.createdAt = at(10 * MIN)
      await writeMessages('message.received', { messageId: 'message_2' })
      expect(log({ event: 'message.received' })).toHaveLength(1)
      state.message!.createdAt = at(MESSAGE_ALERT_WINDOW_MS + MIN)
      await writeMessages('message.received', { messageId: 'message_3' })
      expect(log({ event: 'message.received' })).toHaveLength(2)
    })
  })

  describe('rent on a stay paid in instalments', () => {
    // A year at $12,000 with a $500 deposit: $3,000 and the deposit up front, then $1,000 a month from 9 June
    const first = { sequence: 1, status: 'PAID', amount: 3000, depositAmount: 500, coveredFromDeposit: 0, periodEnd: new Date('2027-06-09T12:00:00Z'), dueDate: new Date('2027-03-09T12:00:00Z') }
    const second = { id: 'inst_2', bookingId: 'booking_1', sequence: 2, status: 'PENDING', amount: 1000, depositAmount: 0, coveredFromDeposit: 0, periodStart: new Date('2027-06-09T12:00:00Z'), periodEnd: new Date('2027-07-09T12:00:00Z'), dueDate: new Date('2027-06-09T12:00:00Z') }
    function tenancy(over: Row = {}) {
      world({ booking: { subtotal: 12_000, totalPrice: 12_500, damageDeposit: 500, checkOut: new Date('2028-03-09T12:00:00Z'), payments: [{ amountPesewas: 5_425_000 }], instalments: [first, second] } })
      state.instalment = {
        ...second, payments: [],
        booking: { status: 'CONFIRMED', paymentStatus: 'PAID', damageDeposit: 500, refund: null, instalments: [first, second] },
        ...over,
      }
    }

    it('tells the guest and the host what the first payment is and what follows, not the price of the whole year', async () => {
      tenancy()
      await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
      const guest = one({ userId: 'guest_1', channel: 'EMAIL' }).body as string
      expect(guest).toContain('We received your payment of GH₵ 54,250.00 ($3,500.00).')
      expect(guest).toContain('That first payment covers the rent to Wed 9 Jun 2027 and the damage deposit. After that the rent is $1,000.00 a month, due from Wed 9 Jun 2027.')
      expect(guest).not.toContain('12,500')
      const host = one({ userId: 'host_1', channel: 'EMAIL' }).body as string
      expect(host).toContain('Your payout for the first payment is sent 48 hours after move-in.')
      expect(host).not.toContain('For a short stay')
    })

    it('reminds the tenant by email and SMS, and only logs both while messaging is off', async () => {
      vi.setSystemTime(new Date('2027-06-09T08:00:00Z'))
      tenancy()
      expect(await writeMessages('rent.due_today', { instalmentId: 'inst_2' })).toEqual({ written: 2, failed: false })
      expect(log({}).map((l) => `${l.userId} ${l.channel} ${l.status}`).sort()).toEqual(['guest_1 EMAIL LOGGED', 'guest_1 SMS LOGGED'])
      expect(one({ channel: 'EMAIL' })).toMatchObject({ subject: 'Rent for Sea-view apartment in Labadi is due today', bookingId: 'booking_1', recipientRole: 'GUEST' })
      expect(one({ channel: 'EMAIL' }).body).toContain('Your rent of $1,000.00 (about GH₵ 15,500) for Sea-view apartment in Labadi is due today.')
      expect(one({ channel: 'EMAIL' }).body).toContain('Pay your rent: https://fiegh.com/checkout/booking_1?instalment=inst_2')
      expect(one({ channel: 'SMS' }).body).toBe('FieGH: Rent of $1,000.00 for "Sea-view apartment in Labadi" is due today. Pay from your booking: https://fiegh.com/bookings/booking_1')
      expect(fake.email).not.toHaveBeenCalled()
      expect(fake.sms).not.toHaveBeenCalled()
    })

    it('writes the daily reminder once a day, however often the job runs', async () => {
      vi.setSystemTime(new Date('2027-06-12T08:00:00Z'))
      tenancy()
      expect((await writeMessages('rent.overdue', { instalmentId: 'inst_2', day: '2027-06-12' })).written).toBe(2)
      expect((await writeMessages('rent.overdue', { instalmentId: 'inst_2', day: '2027-06-12' })).written).toBe(0)
      expect((await writeMessages('rent.overdue', { instalmentId: 'inst_2', day: '2027-06-13' })).written).toBe(2)
      expect(state.logs).toHaveLength(4)
      expect(one({ channel: 'SMS', dedupeKey: 'rent.overdue:inst_2:2027-06-12:guest_1:SMS' }).body).toBe(
        'FieGH: Rent of $1,000.00 for "Sea-view apartment in Labadi" was due on 9 Jun and is late. Please pay today: https://fiegh.com/bookings/booking_1',
      )
    })

    it('tells the host and the admins once that rent is late, and the admins once that reminders have stopped', async () => {
      vi.stubEnv('ADMIN_ALERT_EMAIL', 'ops@fiegh.com')
      vi.setSystemTime(new Date('2027-06-12T08:00:00Z'))
      tenancy()
      expect((await writeMessages('rent.overdue_notice', { instalmentId: 'inst_2' })).written).toBe(2)
      expect((await writeMessages('rent.overdue_notice', { instalmentId: 'inst_2' })).written).toBe(0)
      expect(log({ event: 'rent.overdue_notice' }).map((l) => `${l.recipientRole} ${l.channel}`).sort()).toEqual(['ADMIN EMAIL', 'HOST EMAIL'])
      vi.setSystemTime(new Date('2027-06-24T08:00:00Z'))
      // One email to the shared inbox and an in-app notice for each admin, once
      expect((await writeMessages('rent.reminders_stopped', { instalmentId: 'inst_2' })).written).toBe(3)
      expect((await writeMessages('rent.reminders_stopped', { instalmentId: 'inst_2' })).written).toBe(0)
      expect(log({ event: 'rent.reminders_stopped' }).map((l) => `${l.recipientRole} ${l.channel}`).sort()).toEqual(['ADMIN EMAIL', 'ADMIN IN_APP', 'ADMIN IN_APP'])
    })

    it('says the last reminder is the last', async () => {
      tenancy()
      vi.setSystemTime(new Date('2027-06-22T08:00:00Z'))   // 13 days after
      await writeMessages('rent.overdue', { instalmentId: 'inst_2', day: '2027-06-22' })
      vi.setSystemTime(new Date('2027-06-23T08:00:00Z'))   // 14 days after
      await writeMessages('rent.overdue', { instalmentId: 'inst_2', day: '2027-06-23' })
      const [before, last] = log({ channel: 'EMAIL' }).map((l) => (l.body as string).includes('This is our last reminder.'))
      expect([before, last]).toEqual([false, true])
    })

    it('reminds nobody about rent that is paid, cancelled, or on a tenancy that no longer stands', async () => {
      for (const over of [{ status: 'PAID' }, { status: 'COVERED' }, { status: 'CANCELLED' }, { booking: { status: 'CANCELLED', paymentStatus: 'PAID', instalments: [] } }, { booking: { status: 'CONFIRMED', paymentStatus: 'REFUNDED', instalments: [] } }]) {
        state.users.length = 0
        tenancy(over)
        for (const event of ['rent.due_soon', 'rent.due_today', 'rent.overdue_notice', 'rent.reminders_stopped'] as const) {
          expect((await writeMessages(event, { instalmentId: 'inst_2' })).written, `${event} ${JSON.stringify(over)}`).toBe(0)
        }
        expect((await writeMessages('rent.overdue', { instalmentId: 'inst_2', day: '2027-06-12' })).written).toBe(0)
      }
    })

    it('gives the tenant a receipt in the cedis charged, and tells the host', async () => {
      tenancy({ status: 'PAID', payments: [{ amount: 1000, amountPesewas: 1_580_000 }] })
      expect((await writeMessages('rent.paid', { instalmentId: 'inst_2' })).written).toBe(2)
      expect(one({ userId: 'guest_1', channel: 'EMAIL' }).body).toContain('We received your rent payment of GH₵ 15,800.00 ($1,000.00) for Sea-view apartment in Labadi.')
      expect(one({ userId: 'host_1', channel: 'EMAIL' }).subject).toBe('Rent received for Sea-view apartment in Labadi')
      expect(log({ channel: 'SMS' })).toHaveLength(0)
    })

    it('tells the tenant, the host and the admins what was taken from the deposit and what is still owed', async () => {
      const covered = { ...second, status: 'PART_COVERED', coveredFromDeposit: 500 }
      tenancy({ ...covered, booking: { status: 'CONFIRMED', paymentStatus: 'PAID', damageDeposit: 500, refund: null, instalments: [first, covered] } })
      expect((await writeMessages('rent.covered_from_deposit', { instalmentId: 'inst_2' })).written).toBe(4)
      const guest = one({ userId: 'guest_1', channel: 'EMAIL' }).body as string
      expect(guest).toContain('$500.00 has been taken from your damage deposit')
      expect(guest).toContain('$500.00 is still owed for that period.')
      expect(guest).toContain('$0.00 of your deposit is left.')
      expect(log({ recipientRole: 'ADMIN', channel: 'IN_APP' })).toHaveLength(2)
    })

    it('tells both sides when a tenancy is ended early, and only then', async () => {
      tenancy()
      expect((await writeMessages('tenancy.ended_early', { bookingId: 'booking_1' })).written).toBe(0)
      Object.assign(state.booking!, { endedEarlyAt: NOW, endedEarlyBy: 'HOST', checkOut: new Date('2027-06-09T12:00:00Z') })
      expect((await writeMessages('tenancy.ended_early', { bookingId: 'booking_1' })).written).toBe(4)
      expect(one({ userId: 'guest_1', channel: 'EMAIL' }).subject).toBe('Your tenancy at Sea-view apartment in Labadi ends on Wed 9 Jun 2027')
      expect(one({ userId: 'guest_1', channel: 'EMAIL' }).body).toContain('nothing already paid is refunded')
    })

    it('keys a waiting payout on the instalment, so each month gets its own notice', async () => {
      tenancy({ status: 'PAID' })
      ;(state.booking!.host as Row).paystackRecipientCode = null
      expect((await writeMessages('payout.waiting', { bookingId: 'booking_1', instalmentId: 'inst_2' })).written).toBe(2)
      expect((await writeMessages('payout.waiting', { bookingId: 'booking_1', instalmentId: 'inst_2' })).written).toBe(0)
      expect(one({ channel: 'EMAIL' }).dedupeKey).toBe('payout.waiting:inst_2:host_1:EMAIL')
      expect(one({ channel: 'EMAIL' }).body).toContain('Your payout of $900.00 for the rent at Sea-view apartment in Labadi for the period starting Wed 9 Jun 2027 is ready')
    })
  })

  describe('a listing\'s address and photos check', () => {
    const check = (over: Row = {}, listing: Row = {}) => {
      world()
      state.listingCheck = {
        id: 'check_1', expiresAt: new Date('2028-03-12T10:00:00Z'), revokedAt: null, revokeReason: null, revokeNote: null,
        // The private note is on the row; it must never reach a message
        note: 'PRIVATE: host seemed nervous on the call',
        listing: { id: 'listing_1', title: 'Sea-view apartment in Labadi', hostId: 'host_1', isActive: true, moderationHold: false, host: { name: 'Kwame Mensah' }, ...listing },
        ...over,
      }
    }
    const body = () => one({ channel: 'EMAIL' }).body as string

    it('tells the host it was checked, in the approved words, by email only', async () => {
      check()
      expect(await writeMessages('listing.checked', { checkId: 'check_1' })).toEqual({ written: 1, failed: false })
      expect(one({ channel: 'EMAIL' })).toMatchObject({ userId: 'host_1', recipientRole: 'HOST', status: 'LOGGED', subject: 'We have checked the address and photos of Sea-view apartment in Labadi' })
      expect(body()).toContain('We have checked the address and photos of Sea-view apartment in Labadi. It now shows "Address and photos checked" to guests until Sun 12 Mar 2028.')
      expect(body()).toContain('If you change the address or the photos, it is removed until we check again.')
      expect(log({ channel: 'SMS' })).toHaveLength(0)
    })

    it.each([
      ['PHOTOS_CHANGED', null, 'Reason: the photos were changed.'],
      ['ADDRESS_CHANGED', null, 'Reason: the address was changed.'],
      ['DETAILS_CHANGED', null, 'Reason: the property type or the number of bedrooms was changed.'],
      ['ADMIN', 'The photos are of a different flat', 'Reason: removed by our team: The photos are of a different flat.'],
    ])('tells the host it was removed and why (%s)', async (revokeReason, revokeNote, sentence) => {
      check({ revokedAt: NOW, revokeReason, revokeNote })
      expect((await writeMessages('listing.check_removed', { checkId: 'check_1' })).written).toBe(1)
      expect(one({ channel: 'EMAIL' }).subject).toBe('Sea-view apartment in Labadi no longer shows "Address and photos checked"')
      expect(body()).toContain(`Sea-view apartment in Labadi no longer shows "Address and photos checked". ${sentence}`)
      expect(body()).toContain('Your listing is still live. Write to support@fiegh.com to arrange a new check.')
    })

    it('does not say the listing is still live when it was put on hold', async () => {
      check({ revokedAt: NOW, revokeReason: 'LISTING_HELD' }, { isActive: false, moderationHold: true })
      await writeMessages('listing.check_removed', { checkId: 'check_1' })
      expect(body()).toContain('Reason: the listing was put on hold.')
      expect(body()).not.toContain('still live')
    })

    it('says nothing was removed when a check was only replaced by a newer one, or still stands', async () => {
      check({ revokedAt: NOW, revokeReason: 'REPLACED' })
      expect((await writeMessages('listing.check_removed', { checkId: 'check_1' })).written).toBe(0)
      state.users.length = 0
      check()
      expect((await writeMessages('listing.check_removed', { checkId: 'check_1' })).written).toBe(0)
    })

    it('reminds the host once that it is running out, and not if it has gone', async () => {
      check({ expiresAt: new Date(NOW.getTime() + 20 * 86_400_000) })
      expect((await writeMessages('listing.check_expiring', { checkId: 'check_1' })).written).toBe(1)
      expect((await writeMessages('listing.check_expiring', { checkId: 'check_1' })).written).toBe(0)
      expect(body()).toMatch(/^Hello Kwame,\n\nThe check on Sea-view apartment in Labadi runs out on /)
      expect(body()).toContain('After that date the listing stays live without "Address and photos checked".')
      for (const gone of [{ revokedAt: NOW, revokeReason: 'ADMIN' }, { expiresAt: new Date(NOW.getTime() - 1000) }]) {
        state.users.length = 0
        state.logs.length = 0
        check(gone)
        expect((await writeMessages('listing.check_expiring', { checkId: 'check_1' })).written, JSON.stringify(gone)).toBe(0)
        expect((await writeMessages('listing.checked', { checkId: 'check_1' })).written).toBe(gone.revokedAt ? 0 : 1)
      }
    })

    it('never passes on the admin\'s private note, and never says "verified"', async () => {
      for (const [event, over] of [['listing.checked', {}], ['listing.check_expiring', {}], ['listing.check_removed', { revokedAt: NOW, revokeReason: 'ADMIN', revokeNote: 'Photos do not match' }]] as const) {
        state.users.length = 0
        state.logs.length = 0
        check(over)
        await writeMessages(event, { checkId: 'check_1' })
        expect(JSON.stringify(state.logs), event).not.toMatch(/PRIVATE|nervous|verified|verif|guarantee|owner/i)
      }
    })
  })

  describe('events that only make sense in one state', () => {
    it('says nothing about a stay that did not complete', async () => {
      world()
      expect((await writeMessages('booking.completed', { bookingId: 'booking_1' })).written).toBe(0)
      state.booking!.status = 'COMPLETED'
      expect((await writeMessages('booking.completed', { bookingId: 'booking_1' })).written).toBe(2)
    })

    it('says nothing about a payout waiting once the host has a payout method', async () => {
      world()
      expect((await writeMessages('payout.waiting', { bookingId: 'booking_1' })).written).toBe(0)
      ;(state.booking!.host as Row).paystackRecipientCode = null
      expect((await writeMessages('payout.waiting', { bookingId: 'booking_1' })).written).toBe(2)
      // The host's share of the $300 stay price after the commission
      expect(one({ event: 'payout.waiting', channel: 'EMAIL' }).body).toContain('Your payout of $270.00 for the stay')
      expect(one({ event: 'payout.waiting', channel: 'SMS' }).body).toBe('FieGH: A payout for "Sea-view apartment in Labadi" is waiting. Add a payout method in FieGH to be paid: https://fiegh.com/dashboard/host/payouts')
    })

    it('passes on a correction to both parties, and never an admin\'s private note', async () => {
      world()
      state.dispute = { id: 'dispute_1', bookingId: 'booking_1', raisedByRole: 'GUEST', reason: 'NOT_CLEAN', outcome: null, resolution: null }
      state.disputeEvent = { id: 'event_1', type: 'ADMIN_NOTE', note: 'I think the guest is lying' }
      expect((await writeMessages('dispute.correction', { disputeId: 'dispute_1', eventId: 'event_1' })).written).toBe(0)
      state.disputeEvent = { id: 'event_2', type: 'CORRECTION', note: 'The refund is $95.00, not $59.00.' }
      expect((await writeMessages('dispute.correction', { disputeId: 'dispute_1', eventId: 'event_2' })).written).toBe(2)
      expect(JSON.stringify(state.logs)).not.toContain('lying')
    })

    it('writes the payout in the cedis Paystack sent when the webhook carries them', async () => {
      world()
      state.payout = { id: 'payout_1', bookingId: 'booking_1', amount: 276, failureReason: null }
      await writeMessages('payout.sent', { payoutId: 'payout_1', pesewas: 427_800 })
      expect(one({ event: 'payout.sent', channel: 'SMS' }).body).toContain('Your payout of GHS 4,278.00 for')
      state.logs.length = 0
      for (const pesewas of [undefined, 'abc', -5, 12.5]) {
        state.logs.length = 0
        await writeMessages('payout.sent', { payoutId: 'payout_1', pesewas })
        expect(one({ event: 'payout.sent', channel: 'SMS' }).body).toContain('Your payout of $276.00 for')
      }
    })
  })

  describe('never breaks the action that raised it', () => {
    it.each(['booking', 'messageLog'])('does not throw when the %s table is down, and reports it with IDs only', async (table) => {
      world()
      state.breakOn = table
      await expect(writeMessages('booking.confirmed', { bookingId: 'booking_1' })).resolves.toEqual({ written: 0, failed: true })
      expect(sentry.captureException).toHaveBeenCalledTimes(1)
      const [, options] = sentry.captureException.mock.calls[0]
      expect(options.contexts.message).toEqual({ event: 'booking.confirmed', bookingId: 'booking_1' })
    })

    it('does not throw even when reporting the failure fails', async () => {
      world()
      state.breakOn = 'booking'
      sentry.captureException.mockImplementation(() => { throw new Error('Sentry is down too') })
      await expect(writeMessages('booking.confirmed', { bookingId: 'booking_1' })).resolves.toMatchObject({ failed: true })
    })

    it('returns at once from notify, with nothing for the caller to wait on or catch', async () => {
      world()
      state.breakOn = 'booking'
      expect(notify('booking.confirmed', { bookingId: 'booking_1' })).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(sentry.captureException).toHaveBeenCalledTimes(1)
    })

    it('does nothing for something that no longer exists', async () => {
      world()
      state.booking = null
      expect(await writeMessages('booking.confirmed', { bookingId: 'gone' })).toEqual({ written: 0, failed: false })
    })
  })
})

// ─── Sending ────────────────────────────────────────────────────────────────

describe('the send-messages job', () => {
  const queued = async () => {
    live()
    world()
    await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
  }

  it('finds nothing to send while messaging is off', async () => {
    world()
    await writeMessages('booking.confirmed', { bookingId: 'booking_1' })
    const run = await runMessages()
    expect(run).toMatchObject({ mode: 'live', checked: 0, results: [], email: { live: false, provider: 'log' }, sms: { live: false, provider: 'log' } })
    // Switched on afterwards: what was logged while off is never sent later
    live()
    expect((await runMessages()).checked).toBe(0)
    expect(fake.email).not.toHaveBeenCalled()
    expect(fake.sms).not.toHaveBeenCalled()
    expect(log({ status: 'LOGGED' })).toHaveLength(4)
  })

  it('sends each queued message once, to the real address, from the configured sender', async () => {
    vi.stubEnv('EMAIL_FROM', 'FieGH Bookings <hello@mail.fiegh.com>')
    vi.stubEnv('SUPPORT_EMAIL', 'help@fiegh.com')
    vi.stubEnv('SMS_SENDER_ID', 'FieHome')
    await queued()
    const run = await runMessages()
    expect(run.results.map((r) => r.action)).toEqual(['sent', 'sent', 'sent', 'sent'])
    expect(fake.email).toHaveBeenCalledTimes(2)
    expect(fake.sms).toHaveBeenCalledTimes(2)

    const email = fake.email.mock.calls.find(([m]) => m.to === GUEST_EMAIL)![0]
    expect(email).toMatchObject({
      from: 'FieGH Bookings <hello@mail.fiegh.com>', replyTo: 'help@fiegh.com',
      subject: 'Booking confirmed: Sea-view apartment in Labadi', idempotencyKey: 'booking.confirmed:booking_1:guest_1:EMAIL',
    })
    expect(email.text).toContain('We received your payment of GH₵ 5,983.00 ($386.00).')
    expect(email.html).toContain('Booking confirmed: Sea-view apartment in Labadi')
    expect(email.signal).toBeInstanceOf(AbortSignal)
    const text = fake.sms.mock.calls.find(([m]) => m.to === HOST_PHONE)![0]
    expect(text).toMatchObject({ from: 'FieHome', idempotencyKey: 'booking.confirmed:booking_1:host_1:SMS' })
    expect(text.subject).toBeUndefined()

    expect(one({ userId: 'guest_1', channel: 'EMAIL' })).toMatchObject({ status: 'SENT', sentAt: NOW, provider: 'fake-email', providerMessageId: 'em_1', attempts: 1 })
  })

  it('uses sensible sender defaults when nothing is configured', async () => {
    await queued()
    await runMessages()
    expect(fake.email.mock.calls[0][0]).toMatchObject({ from: 'FieGH <support@fiegh.com>', replyTo: 'support@fiegh.com' })
    expect(fake.sms.mock.calls[0][0].from).toBe('FieGH')
  })

  it('does not send again on the next run, or when two runs overlap', async () => {
    await queued()
    await Promise.all([runMessages(), runMessages()])
    await runMessages()
    expect(fake.email).toHaveBeenCalledTimes(2)
    expect(fake.sms).toHaveBeenCalledTimes(2)
    expect(log({ status: 'SENT' }).filter((l) => l.channel !== 'IN_APP')).toHaveLength(4)
  })

  it('only reports on a dry run', async () => {
    await queued()
    const res = await sendMessagesCron(new Request('http://x/api/cron/send-messages?dryRun=1', { headers: { authorization: 'Bearer cron_secret' } }))
    expect(await res.json()).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested', checked: 4, results: [{ action: 'would-send' }, { action: 'would-send' }, { action: 'would-send' }, { action: 'would-send' }] })
    expect(fake.email).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
    expect(log({ status: 'QUEUED' })).toHaveLength(4)
  })

  it('is refused without the cron secret', async () => {
    await queued()
    for (const headers of [{}, { authorization: 'Bearer wrong' }] as Record<string, string>[]) {
      expect((await sendMessagesCron(new Request('http://x/api/cron/send-messages', { headers }))).status).toBe(401)
    }
    vi.stubEnv('CRON_SECRET', '')
    expect((await sendMessagesCron(new Request('http://x/api/cron/send-messages', { headers: { authorization: 'Bearer ' } }))).status).toBe(401)
    expect(fake.email).not.toHaveBeenCalled()
  })

  describe('when the provider refuses a message', () => {
    const emailOnly = async () => {
      vi.stubEnv('MESSAGING_ENABLED', 'true')
      vi.stubEnv('EMAIL_PROVIDER', 'fake-email')
      world()
      await writeMessages('refund.sent', { refundId: 'refund_1' })
    }
    beforeEach(() => { state.refund = { id: 'refund_1', bookingId: 'booking_1', failureReason: null } })

    it('retries after 5 minutes, 30 minutes and 2 hours, then gives up with one alert', async () => {
      fake.email.mockResolvedValue({ ok: false, retryable: true, error: 'rate limited for ama.owusu@example.test' })
      await emailOnly()

      expect((await runMessages({ now: NOW })).results[0]).toMatchObject({ action: 'will-retry', attempts: 1 })
      const row = () => one({ event: 'refund.sent' })
      expect(row()).toMatchObject({ status: 'FAILED', attempts: 1, nextAttemptAt: at(5 * MIN), error: 'rate limited for [email]' })

      // Not before its time
      expect((await runMessages({ now: at(4 * MIN) })).checked).toBe(0)
      expect((await runMessages({ now: at(5 * MIN) })).results[0]).toMatchObject({ action: 'will-retry', attempts: 2 })
      expect(row().nextAttemptAt).toEqual(at(35 * MIN))
      expect((await runMessages({ now: at(35 * MIN) })).results[0]).toMatchObject({ action: 'will-retry', attempts: 3 })
      expect(row().nextAttemptAt).toEqual(at(155 * MIN))
      expect(sentry.captureMessage).not.toHaveBeenCalled()

      expect((await runMessages({ now: at(155 * MIN) })).results[0]).toMatchObject({ action: 'gave-up', attempts: MAX_ATTEMPTS })
      expect(row()).toMatchObject({ status: 'GAVE_UP', attempts: 4, nextAttemptAt: null })
      expect(alerts()).toEqual(['GAVE_UP'])
      expect((await runMessages({ now: at(600 * MIN) })).checked).toBe(0)
      expect(fake.email).toHaveBeenCalledTimes(4)
    })

    it('gives up at once on a refusal that will not fix itself', async () => {
      fake.email.mockResolvedValue({ ok: false, retryable: false, error: 'address rejected' })
      await emailOnly()
      await runMessages()
      expect(one({ event: 'refund.sent' })).toMatchObject({ status: 'GAVE_UP', attempts: 1 })
      expect(alerts()).toEqual(['GAVE_UP'])
    })

    it('alerts with IDs only: no address, number or message text', async () => {
      fake.email.mockResolvedValue({ ok: false, retryable: false, error: 'rejected ama.owusu@example.test' })
      await emailOnly()
      await runMessages()
      const context = JSON.stringify(sentry.captureMessage.mock.calls[0][1].contexts)
      expect(context).toContain('"userId":"guest_1"')
      expect(context).not.toMatch(/example\.test|\+233|refund of|Hello/)
    })

    it('is sent on a later try once the provider recovers', async () => {
      fake.email.mockResolvedValueOnce({ ok: false, retryable: true, error: 'down' })
      await emailOnly()
      await runMessages({ now: NOW })
      await runMessages({ now: at(5 * MIN) })
      expect(one({ event: 'refund.sent' })).toMatchObject({ status: 'SENT', attempts: 2, error: null })
      expect(sentry.captureMessage).not.toHaveBeenCalled()
    })
  })

  describe('when it cannot be sure a message went', () => {
    const queuedEmail = async () => {
      vi.stubEnv('MESSAGING_ENABLED', 'true')
      vi.stubEnv('EMAIL_PROVIDER', 'fake-email')
      world()
      state.refund = { id: 'refund_1', bookingId: 'booking_1', failureReason: null }
      await writeMessages('refund.sent', { refundId: 'refund_1' })
    }

    it('never retries after the adapter throws', async () => {
      fake.email.mockRejectedValue(new Error('socket hang up while talking to ama.owusu@example.test'))
      await queuedEmail()
      expect((await runMessages()).results[0]).toMatchObject({ action: 'unknown' })
      expect(one({ event: 'refund.sent' })).toMatchObject({ status: 'UNKNOWN', attempts: 1 })
      expect(one({ event: 'refund.sent' }).error).not.toContain('example.test')
      expect(alerts()).toEqual(['UNKNOWN'])
      await runMessages({ now: at(600 * MIN) })
      expect(fake.email).toHaveBeenCalledTimes(1)
    })

    it('never retries after the provider takes too long to answer', async () => {
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(), 5)
        return controller.signal
      })
      fake.email.mockImplementation(() => new Promise(() => {}))
      await queuedEmail()
      expect((await runMessages()).results[0]).toMatchObject({ action: 'unknown' })
      expect(one({ event: 'refund.sent' })).toMatchObject({ status: 'UNKNOWN' })
      await runMessages({ now: at(600 * MIN) })
      expect(fake.email).toHaveBeenCalledTimes(1)
    })

    it('closes a message a dead run left half-sent, without sending it again', async () => {
      await queuedEmail()
      Object.assign(one({ event: 'refund.sent' }), { status: 'SENDING', claimedAt: at(-11 * MIN), attempts: 1 })
      const run = await runMessages()
      expect(run).toMatchObject({ stale: 1, checked: 0 })
      expect(one({ event: 'refund.sent' })).toMatchObject({ status: 'UNKNOWN' })
      expect(alerts()).toEqual(['UNKNOWN'])
      expect(fake.email).not.toHaveBeenCalled()
      // A claim made a moment ago belongs to a run that is still going
      Object.assign(one({ event: 'refund.sent' }), { status: 'SENDING', claimedAt: at(-2 * MIN) })
      expect((await runMessages()).stale).toBe(0)
    })
  })

  it('does not send a message queued before messaging was switched off', async () => {
    await queued()
    vi.stubEnv('MESSAGING_ENABLED', '')
    const run = await runMessages()
    expect(run.results.map((r) => r.action)).toEqual(['closed', 'closed', 'closed', 'closed'])
    expect(log({ status: 'LOGGED' })).toHaveLength(4)
    live()
    await runMessages()
    expect(fake.email).not.toHaveBeenCalled()
    expect(fake.sms).not.toHaveBeenCalled()
  })

  it('drops a message that has waited more than a day rather than send it late', async () => {
    await queued()
    const run = await runMessages({ now: at(25 * 60 * MIN) })
    expect(run.results.map((r) => r.action)).toEqual(['gave-up', 'gave-up', 'gave-up', 'gave-up'])
    expect(fake.email).not.toHaveBeenCalled()
    expect(log({ status: 'GAVE_UP' })).toHaveLength(4)
  })

  it('looks the address up when it sends, and skips someone who can no longer be reached', async () => {
    await queued()
    Object.assign(state.users.find((u) => u.id === 'guest_1')!, { email: 'New.Address@Example.Test', phone: null })
    await runMessages()
    expect(fake.email.mock.calls.map(([m]) => m.to).sort()).toEqual([HOST_EMAIL, 'new.address@example.test'])
    expect(one({ userId: 'guest_1', channel: 'SMS' })).toMatchObject({ status: 'SKIPPED', error: 'no valid phone number when it came to be sent' })
    expect(fake.sms).toHaveBeenCalledTimes(1)
  })

  it('sends an admin email to each admin\'s own address when there is no shared inbox', async () => {
    live()
    world()
    state.refund = { id: 'refund_1', bookingId: 'booking_1', failureReason: 'Paystack returned HTTP 400' }
    await writeMessages('refund.needs_attention', { refundId: 'refund_1' })
    await runMessages()
    expect(fake.email.mock.calls.map(([m]) => m.to)).toEqual(['second.admin@example.test'])
  })

  it('sends an admin email to the shared inbox', async () => {
    live()
    vi.stubEnv('ADMIN_ALERT_EMAIL', 'ops@fiegh.com')
    world()
    state.refund = { id: 'refund_1', bookingId: 'booking_1', failureReason: 'Paystack returned HTTP 400' }
    await writeMessages('refund.needs_attention', { refundId: 'refund_1' })
    await runMessages()
    expect(fake.email).toHaveBeenCalledTimes(1)
    expect(fake.email.mock.calls[0][0].to).toBe('ops@fiegh.com')
  })
})

// ─── Email addresses at sign-up ─────────────────────────────────────────────

describe('signing up', () => {
  const post = (body: Row) => signup(new Request('http://x/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Ama', password: 'long-enough', ...body }) }))

  it('stores the email trimmed and lower-cased, and records a welcome', async () => {
    const res = await post({ email: '  Ama.Owusu@Example.COM ' })
    expect(res.status).toBe(201)
    expect(state.users[0]).toMatchObject({ email: 'ama.owusu@example.com' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(one({ event: 'account.welcome' })).toMatchObject({ channel: 'EMAIL', status: 'LOGGED', recipientMasked: 'a***@example.com' })
  })

  it('refuses the same address in different capitals', async () => {
    await post({ email: 'ama@example.com' })
    expect((await post({ email: 'AMA@Example.com' })).status).toBe(409)
  })

  it.each(['ama', 'ama@', 'ama@example', 'ama owusu@example.com'])('refuses %j as an email address', async (email) => {
    const res = await post({ email })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/valid email address/)
    expect(state.users).toHaveLength(0)
  })

  it('still allows an account with a phone number and no email', async () => {
    expect((await post({ phone: '0241234567' })).status).toBe(201)
    expect(state.users[0]).toMatchObject({ email: null, phone: '+233241234567' })
  })
})

// ─── Where notify is called ─────────────────────────────────────────────────

describe('call sites', () => {
  const calls = (file: string) => [...fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8').matchAll(/\bnotify\(([^)]*)\)/g)].map((m) => m[1])

  it('adds exactly one call at each place in the payout and refund code, and nothing else', () => {
    expect(calls('src/lib/refunds.ts')).toEqual([
      "'refund.needs_attention', { refundId }",
      "'refund.needs_attention', { refundId: refund.id }",
      "status === 'PROCESSED' ? 'refund.arrived' : 'refund.sent', { refundId }",
    ])
    expect(calls('src/lib/payouts.ts')).toEqual(["'payout.held', { payoutId: held.id }", "'payout.failed', { payoutId }"])
    expect(calls('src/lib/cronRuns.ts')).toEqual(["'payout.waiting', { bookingId: booking.id, instalmentId: item.instalmentId }", "'booking.completed', { bookingId }"])
    expect(calls('src/lib/disputeDecisions.ts')).toEqual(["'dispute.decided', { disputeId: dispute.id }"])
    expect(calls('src/app/api/webhooks/paystack/route.ts')).toEqual(["'payout.sent', { payoutId: payout.id, pesewas: data.amount }"])
  })

  it('tells a host about a waiting payout only on a live run', () => {
    expect(fs.readFileSync(path.resolve(__dirname, '../cronRuns.ts'), 'utf8')).toContain("if (live) notify('payout.waiting'")
  })

  it('has a call for every event, somewhere in the app', () => {
    const source = (dir: string): string => fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return full.includes(`${path.sep}messaging`) ? '' : source(full)
      return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? fs.readFileSync(full, 'utf8') : ''
    }).join('\n')
    const app = source(path.resolve(__dirname, '../..'))
    for (const event of EVENT_NAMES) expect(app, event).toContain(`'${event}'`)
  })

  it('leaves the five older in-app notices where they were', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8')
    expect(read('src/app/api/bookings/[id]/route.ts')).toContain("type: 'HOST_CANCELLED_BOOKING'")
    expect(read('src/app/api/bookings/[id]/disputes/route.ts')).toContain("'DISPUTE_RAISED'")
    expect(read('src/app/api/disputes/[id]/route.ts')).toContain("'DISPUTE_REPLIED'")
    expect(read('src/lib/disputeDecisions.ts')).toContain("type: 'DISPUTE_RESOLVED'")
    expect(read('src/app/api/users/me/payout-method/route.ts')).toContain("type: 'PAYOUT_METHOD_CHANGED'")
    // And notify adds no second in-app notice for those events
    for (const event of ['dispute.raised', 'dispute.replied', 'dispute.decided', 'payout_method.changed']) {
      expect(render(event).some((piece) => piece.inApp)).toBe(false)
    }
    expect(render('booking.cancelled_by_host').some((piece) => piece.to === 'admin' && piece.inApp)).toBe(false)
  })
})

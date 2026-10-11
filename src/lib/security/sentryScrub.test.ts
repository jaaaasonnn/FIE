import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { SCRUBBING, scrubBreadcrumb, scrubEvent, scrubText } from '@/lib/sentryScrub'

// What is taken out of an error report before it leaves for Sentry.

const TOKEN = 'k3J9xQ2mVb7Lr0TzYw8HcN5sFpD1aGeU4oXiZ6uPtRq'

describe('text', () => {
  it('takes out single-use links, payment references, emails and phone numbers', () => {
    expect(scrubText(`https://fiegh.com/auth/reset-password?token=${TOKEN}`)).toBe('https://fiegh.com/auth/reset-password?token=[removed]')
    expect(scrubText(`/auth/confirm-email?x=1&token=${TOKEN}&next=/`)).toBe('/auth/confirm-email?x=1&token=[removed]&next=/')
    expect(scrubText('/api/payments/verify?trxref=FIE-abc-123&reference=FIE-abc-123')).toBe('/api/payments/verify?trxref=[removed]&reference=[removed]')
    expect(scrubText('Unique constraint failed for ama.owusu@example.com')).toBe('Unique constraint failed for [email]')
    expect(scrubText('call 0241234567 or +233 24 123 4567 or 233241234567')).toBe('call [phone] or [phone] or [phone]')
    // IDs, amounts and dates are left alone: they are what a report is for
    expect(scrubText('Booking cmv47zdo20001yjdq4frv1l7z: 45000 pesewas on 2027-03-09')).toBe('Booking cmv47zdo20001yjdq4frv1l7z: 45000 pesewas on 2027-03-09')
  })
})

describe('an event', () => {
  const event = () => ({
    message: `Reset failed for ama@example.com with token=${TOKEN}`,
    request: {
      method: 'POST',
      url: `https://fiegh.com/auth/reset-password?token=${TOKEN}`,
      query_string: `token=${TOKEN}&x=1`,
      cookies: { fiegh_session: 'a'.repeat(64) },
      data: { password: 'hunter2hunter2', email: 'ama@example.com' },
      headers: { Cookie: `fiegh_session=${'a'.repeat(64)}`, authorization: 'Bearer cron-secret', 'x-paystack-signature': 'abc', 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0', referer: `https://fiegh.com/auth/reset-password?token=${TOKEN}` },
    },
    user: { id: 'user_1', email: 'ama@example.com', ip_address: '203.0.113.7', username: 'Ama Owusu' },
    exception: { values: [{ type: 'Error', value: 'No user with phone 0241234567', stacktrace: { frames: [{ filename: 'app/api/x.ts', vars: { password: 'hunter2hunter2', bookingId: 'booking_1' } }] } }] },
    extra: { payout: { hostId: 'host_1', momoNumber: '0241234567', amount: 90 }, note: 'write to kofi@example.com' },
    breadcrumbs: [{ category: 'navigation', data: { to: `/auth/reset-password?token=${TOKEN}` } }],
  })

  it('loses its cookies, its body and the headers that identify a person', () => {
    const cleaned = scrubEvent(event())
    expect(cleaned.request).not.toHaveProperty('cookies')
    expect(cleaned.request).not.toHaveProperty('data')
    expect(Object.keys(cleaned.request.headers)).toEqual(['user-agent', 'referer'])
    expect(cleaned.request.method).toBe('POST')
  })

  it('keeps the user\'s id and nothing else about them', () => {
    expect(scrubEvent(event()).user).toEqual({ id: 'user_1' })
    expect(scrubEvent({ user: { email: 'ama@example.com' } }).user).toEqual({})
  })

  it('carries no token, email, phone number, password or session anywhere', () => {
    const text = JSON.stringify(scrubEvent(event()))
    for (const secret of [TOKEN, 'ama@example.com', 'kofi@example.com', '0241234567', 'hunter2hunter2', 'a'.repeat(64), 'cron-secret', '203.0.113.7', 'Ama Owusu']) {
      expect(text, secret).not.toContain(secret)
    }
    // What is useful is still there
    for (const kept of ['user_1', 'host_1', 'booking_1', 'app/api/x.ts', '"amount":90', 'reset-password?token=[removed]']) expect(text, kept).toContain(kept)
  })

  it('cleans a breadcrumb the same way', () => {
    const crumb = scrubBreadcrumb({ category: 'fetch', message: 'GET /api/x?email=ama@example.com', data: { url: `/api/auth/confirm-email?token=${TOKEN}`, status_code: 200 } })
    expect(crumb).toEqual({ category: 'fetch', message: 'GET /api/x?email=[removed]', data: { url: '/api/auth/confirm-email?token=[removed]', status_code: 200 } })
  })

  it('copes with an event that has none of these', () => {
    expect(scrubEvent({})).toEqual({})
    expect(scrubEvent({ request: {} })).toEqual({ request: {} })
  })
})

describe('the three Sentry set-ups', () => {
  it('all scrub, and none sends personal data by default', () => {
    expect(SCRUBBING.sendDefaultPii).toBe(false)
    expect(SCRUBBING.beforeSend({ user: { id: 'u', email: 'a@b.co' } })).toEqual({ user: { id: 'u' } })
    for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts', 'instrumentation-client.ts']) {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
      expect(source, file).toContain('...SCRUBBING,')
      expect(source, file).not.toContain('sendDefaultPii: true')
    }
  })
})

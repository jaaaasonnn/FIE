import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real route handlers, run against a mocked session and a mocked
// database. Nothing here reaches a real database, Supabase or Paystack.

type Row = Record<string, unknown>
type Identity = { id: string; role: string } | null
const state = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
  listingWhere: null as Row | null,
  writes: [] as string[],
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
// Messages are covered by lib/messaging tests; here notify() is only a call that must not get in the way
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => state.user }))
vi.mock('bcryptjs', () => ({ default: { compare: async () => true, hash: async () => 'hash' } }))
vi.mock('@/lib/supabase', () => ({
  LISTING_PHOTOS_BUCKET: 'listing-photos', AVATARS_BUCKET: 'avatars', VERIFICATION_DOCS_BUCKET: 'verification-docs', DISPUTE_EVIDENCE_BUCKET: 'dispute-evidence',
  supabaseAdmin: { storage: { from: () => ({
    upload: async () => ({ error: null }),
    remove: async () => ({ error: null }),
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/listing-photos/${path}` } }),
  }) } },
}))

const PHOTO = 'https://x.supabase.co/storage/v1/object/public/listing-photos/listing_1/a.jpg'
vi.mock('@/lib/db', () => {
  const wrote = (what: string) => { state.writes.push(what) }
  const listing = {
    id: 'listing_1', hostId: 'host_1', title: 'A home', photos: JSON.stringify(['https://x.supabase.co/storage/v1/object/public/listing-photos/listing_1/a.jpg']),
    isActive: true, moderationHold: false, description: 'A plain description', rentalModes: '["SHORT_STAY"]', cancellationPolicy: 'MODERATE',
  }
  const booking = {
    id: 'booking_1', listingId: 'listing_1', guestId: 'guest_1', hostId: 'host_1', status: 'PENDING', paymentStatus: 'UNPAID',
    rentalMode: 'SHORT_STAY', checkIn: new Date('2099-03-10T12:00:00Z'), checkOut: new Date('2099-03-12T12:00:00Z'),
    subtotal: 200, serviceFee: 24, damageDeposit: 0, pricePerUnit: 100, cancellationPolicy: 'MODERATE',
    listing: { title: 'A home', cancellationPolicy: 'MODERATE' }, payments: [], instalments: [],
  }
  const db: Record<string, Record<string, (...args: never[]) => unknown>> = {
    listing: {
      findUnique: async () => ({ ...listing }),
      findMany: async ({ where }: { where: Row }) => { state.listingWhere = where; return [] },
      count: async () => 0,
      create: async () => { wrote('listing.create'); return { id: 'listing_new' } },
      update: async () => { wrote('listing.update'); return { ...listing } },
    },
    booking: {
      findUnique: async () => ({ ...booking }),
      findMany: async () => [],
      findFirst: async () => null,
      update: async ({ data }: { data: Row }) => { wrote('booking.update'); return { ...booking, ...data } },
    },
    blockedDate: {
      findMany: async () => [],
      createMany: async () => { wrote('blockedDate.createMany'); return { count: 1 } },
      deleteMany: async () => { wrote('blockedDate.deleteMany'); return { count: 1 } },
    },
    payout: { findMany: async () => [], findFirst: async () => null },
    instalment: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    // No listing here has a check: those are covered in listingChecks.test.ts
    listingCheck: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    user: {
      findUnique: async () => ({ id: 'someone', passwordHash: 'hash', payoutMethod: null, paystackRecipientCode: null, payoutMethodVerifiedAt: null }),
      findMany: async () => [],
      update: async () => { wrote('user.update'); return { payoutMethod: 'MOMO' } },
    },
    notification: { create: async () => { wrote('notification.create'); return {} }, createMany: async () => ({ count: 0 }) },
    refund: { create: async () => ({ id: 'refund_1' }) },
    exchangeRate: { findFirst: async () => ({ usdToGhs: 15 }) },
  }
  ;(db as unknown as { $transaction: unknown }).$transaction = async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: unknown) => unknown)(db) : Promise.all(arg as Promise<unknown>[]))
  return { db }
})

import { ADMINS_ONLY_MESSAGE, HOSTS_ONLY_MESSAGE, SIGN_IN_MESSAGE, hostAreaRedirect, requireAdmin, requireHost } from '@/lib/roles'
import * as listings from '@/app/api/listings/route'
import * as listingById from '@/app/api/listings/[id]/route'
import * as photos from '@/app/api/listings/[id]/photos/route'
import * as blockedDates from '@/app/api/listings/[id]/blocked-dates/route'
import * as bookings from '@/app/api/bookings/route'
import * as bookingById from '@/app/api/bookings/[id]/route'
import * as payouts from '@/app/api/payouts/route'
import * as payoutMethod from '@/app/api/users/me/payout-method/route'
import * as payoutBanks from '@/app/api/payout-banks/route'

// ─── The five people ────────────────────────────────────────────────────────

const WHO: Record<string, Identity> = {
  'signed out': null,
  'a guest': { id: 'guest_1', role: 'GUEST' },
  'the owning host': { id: 'host_1', role: 'HOST' },
  'another host': { id: 'host_2', role: 'HOST' },
  'an admin': { id: 'admin_1', role: 'ADMIN' },
}
type Who = keyof typeof WHO

const fetchMock = vi.fn()
const params = { params: Promise.resolve({ id: 'listing_1' }) }
const bookingParams = { params: Promise.resolve({ id: 'booking_1' }) }
const json = (url: string, method: string, body?: unknown) =>
  new Request(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })
const form = (url: string) => {
  const fd = new FormData()
  fd.append('photos', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
  return new Request(`http://x${url}`, { method: 'POST', body: fd })
}
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

beforeEach(() => {
  state.user = null
  state.listingWhere = null
  state.writes.length = 0
  fetchMock.mockReset()
  // Paystack as the handlers expect it, should a test ever let a call through
  fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes('/bank?') ? { status: true, data: [{ name: 'GCB Bank', code: '040', type: 'ghipss' }] }
      : String(url).includes('/bank/resolve') ? { status: true, data: { account_name: 'Test Host' } }
      : { status: true, data: { recipient_code: 'RCP_test' } },
  ), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_roles')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ─── The helper ─────────────────────────────────────────────────────────────

describe('requireHost', () => {
  const as = async (who: Who, opts?: { allowAdmin?: boolean }) => { state.user = WHO[who]; return requireHost(opts) }
  const refusal = async (gate: Awaited<ReturnType<typeof requireHost>>) => ({ status: gate.error!.status, body: await gate.error!.json() })

  it('refuses a signed-out caller with 401', async () => {
    expect(await refusal(await as('signed out'))).toEqual({ status: 401, body: { error: SIGN_IN_MESSAGE } })
  })
  it('refuses a guest with a clear 403', async () => {
    const gate = await as('a guest')
    expect(gate.user).toBeNull()
    expect(await refusal(gate)).toEqual({ status: 403, body: { error: 'Only hosts can do this. Become a host first.' } })
  })
  it('lets a host through', async () => {
    expect(await as('the owning host')).toEqual({ user: WHO['the owning host'], error: null })
  })
  it('refuses an admin unless the route allows admins', async () => {
    expect((await as('an admin')).error!.status).toBe(403)
    expect(await as('an admin', { allowAdmin: true })).toEqual({ user: WHO['an admin'], error: null })
  })
  it('never lets a guest through, even where admins are allowed', async () => {
    expect((await as('a guest', { allowAdmin: true })).error!.status).toBe(403)
    expect((await as('signed out', { allowAdmin: true })).error!.status).toBe(401)
  })
  it('does not treat an unknown or oddly cased role as a host', async () => {
    for (const role of ['host', 'Host', 'SUPERHOST', '', 'GUEST ']) {
      state.user = { id: 'x', role }
      expect((await requireHost()).error!.status).toBe(403)
    }
  })
})

describe('requireAdmin', () => {
  it('lets only an admin through', async () => {
    const status = async (who: Who) => { state.user = WHO[who]; const g = await requireAdmin(); return g.error ? g.error.status : 200 }
    expect(await status('signed out')).toBe(401)
    expect(await status('a guest')).toBe(403)
    expect(await status('the owning host')).toBe(403)
    expect(await status('an admin')).toBe(200)
    state.user = WHO['a guest']
    expect(await (await requireAdmin()).error!.json()).toEqual({ error: ADMINS_ONLY_MESSAGE })
  })
})

describe('opening a page under /dashboard/host', () => {
  it('sends each kind of visitor to the right place', () => {
    expect(hostAreaRedirect(null)).toBe('/login?redirect=/dashboard/host')
    expect(hostAreaRedirect({ role: 'GUEST' })).toBe('/become-a-host')
    expect(hostAreaRedirect({ role: 'ADMIN' })).toBe('/admin')
    expect(hostAreaRedirect({ role: 'HOST' })).toBeNull()
  })
  it('treats anything that is not exactly HOST or ADMIN as a guest', () => {
    for (const role of ['host', '', 'OWNER']) expect(hostAreaRedirect({ role })).toBe('/become-a-host')
  })
})

// ─── Every host route, as each of the five ─────────────────────────────────

type Case = {
  name: string
  call: () => Promise<Response>
  /** Expected for: signed out, a guest, the owning host, another host, an admin. 'ok' is any 2xx. */
  expect: [number, number, 'ok', number | 'ok', number | 'ok']
  /** When true, a refusal must not have called Paystack */
  paystack?: boolean
}

const newListing = { title: 'New home', region: 'Greater Accra', city: 'Accra', propertyType: 'Apartment', bedrooms: 1, bathrooms: 1, maxGuests: 2, description: 'A plain description of a home.', rentalModes: ['SHORT_STAY'], priceNightly: 50, amenities: [], photos: [] }

const CASES: Case[] = [
  // "another host" creates their own listing, so there is no ownership to fail
  { name: 'POST /api/listings (create a listing)', call: () => listings.POST(json('/api/listings', 'POST', newListing)), expect: [401, 403, 'ok', 'ok', 403] },
  { name: 'PATCH /api/listings/[id] (edit)', call: () => listingById.PATCH(json('/api/listings/listing_1', 'PATCH', { title: 'Renamed home' }), params), expect: [401, 403, 'ok', 403, 'ok'] },
  { name: 'DELETE /api/listings/[id] (switch off)', call: () => listingById.DELETE(json('/api/listings/listing_1', 'DELETE'), params), expect: [401, 403, 'ok', 403, 'ok'] },
  { name: 'POST /api/listings/[id]/photos (add photos)', call: () => photos.POST(form('/api/listings/listing_1/photos'), params), expect: [401, 403, 'ok', 403, 403] },
  { name: 'DELETE /api/listings/[id]/photos (remove a photo)', call: () => photos.DELETE(json('/api/listings/listing_1/photos', 'DELETE', { url: PHOTO }), params), expect: [401, 403, 'ok', 403, 403] },
  { name: 'GET /api/listings/[id]/blocked-dates (calendar)', call: () => blockedDates.GET(json('/api/listings/listing_1/blocked-dates', 'GET'), params), expect: [401, 403, 'ok', 403, 'ok'] },
  { name: 'POST /api/listings/[id]/blocked-dates (block dates)', call: () => blockedDates.POST(json('/api/listings/listing_1/blocked-dates', 'POST', { start: day(10), end: day(11) }), params), expect: [401, 403, 'ok', 403, 'ok'] },
  { name: 'DELETE /api/listings/[id]/blocked-dates (unblock dates)', call: () => blockedDates.DELETE(json('/api/listings/listing_1/blocked-dates', 'DELETE', { start: day(10), end: day(11) }), params), expect: [401, 403, 'ok', 403, 'ok'] },
  { name: 'GET /api/bookings?hostId (a host\'s bookings)', call: () => bookings.GET(json('/api/bookings?hostId=host_1', 'GET')), expect: [401, 403, 'ok', 403, 'ok'] },
  { name: 'PATCH /api/bookings/[id] accept', call: () => bookingById.PATCH(json('/api/bookings/booking_1', 'PATCH', { action: 'accept' }), bookingParams), expect: [401, 403, 'ok', 403, 403] },
  { name: 'PATCH /api/bookings/[id] decline', call: () => bookingById.PATCH(json('/api/bookings/booking_1', 'PATCH', { action: 'decline' }), bookingParams), expect: [401, 403, 'ok', 403, 403] },
  // The booking here is still a request, so the owning host is told to accept or decline it instead (409): past the gate
  { name: 'PATCH /api/bookings/[id] host-cancel', call: () => bookingById.PATCH(json('/api/bookings/booking_1', 'PATCH', { action: 'host-cancel', reason: 'EMERGENCY' }), bookingParams), expect: [401, 403, 'ok', 403, 403] },
  { name: 'GET /api/payouts?hostId (payout history)', call: () => payouts.GET(json('/api/payouts?hostId=host_1', 'GET')), expect: [401, 403, 'ok', 403, 403] },
  // A payout method is always the caller's own, so another host reads and saves theirs
  { name: 'GET /api/users/me/payout-method', call: () => payoutMethod.GET(), expect: [401, 403, 'ok', 'ok', 403], paystack: true },
  { name: 'POST /api/users/me/payout-method (save)', call: () => payoutMethod.POST(json('/api/users/me/payout-method', 'POST', { password: 'pw', payoutMethod: 'MOMO', payoutMomoNetwork: 'MTN', payoutMomoNumber: '0241234567' })), expect: [401, 403, 'ok', 'ok', 403], paystack: true },
  { name: 'GET /api/payout-banks (bank list)', call: () => payoutBanks.GET(), expect: [401, 403, 'ok', 'ok', 403], paystack: true },
]

describe('host-only routes', () => {
  const people = Object.keys(WHO) as Who[]
  for (const c of CASES) {
    describe(c.name, () => {
      people.forEach((who, i) => {
        const want = c.expect[i]
        it(`${who}: ${want === 'ok' ? 'works' : want}`, async () => {
          state.user = WHO[who]
          const res = await c.call()
          if (want === 'ok') {
            // host-cancel on a pending request is the one case past the gate that is not a 2xx
            const passed = c.name.includes('host-cancel') ? res.status === 409 : res.status >= 200 && res.status < 300
            expect({ status: res.status, passed }).toEqual({ status: res.status, passed: true })
          } else {
            expect(res.status).toBe(want)
            const body = await res.json()
            expect(typeof body.error).toBe('string')
            // A refusal changes nothing and never reaches Paystack
            expect(state.writes).toEqual([])
            if (c.paystack) expect(fetchMock).not.toHaveBeenCalled()
          }
        })
      })

      it('tells a guest plainly why', async () => {
        state.user = WHO['a guest']
        expect((await (await c.call()).json()).error).toBe(HOSTS_ONLY_MESSAGE)
      })
    })
  }
})

// ─── Shared routes keep working for guests ──────────────────────────────────

describe('routes shared by guests and hosts', () => {
  it('still lets a guest withdraw their own request', async () => {
    state.user = WHO['a guest']
    const res = await bookingById.PATCH(json('/api/bookings/booking_1', 'PATCH', { action: 'cancel' }), bookingParams)
    expect(res.status).toBe(200)
  })
  it('still lets a guest list their own bookings', async () => {
    state.user = WHO['a guest']
    expect((await bookings.GET(json('/api/bookings?guestId=guest_1', 'GET'))).status).toBe(200)
  })
  it('does not let a guest read host bookings by naming themselves as the host', async () => {
    state.user = WHO['a guest']
    const res = await bookings.GET(json('/api/bookings?hostId=guest_1', 'GET'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(HOSTS_ONLY_MESSAGE)
  })
  it('does not let a guest cancel as the host, or a host cancel as the guest', async () => {
    state.user = WHO['the owning host']
    expect((await bookingById.PATCH(json('/api/bookings/booking_1', 'PATCH', { action: 'cancel' }), bookingParams)).status).toBe(403)
  })
})

// ─── The public listings query ──────────────────────────────────────────────

describe('GET /api/listings?hostId (a host\'s listings)', () => {
  const whereFor = async (who: Identity, hostId = 'host_1') => {
    state.user = who
    const res = await listings.GET(json(`/api/listings?hostId=${hostId}&limit=50`, 'GET'))
    expect(res.status).toBe(200)
    return state.listingWhere!
  }
  const PUBLIC = { hostId: 'host_1', isActive: true, moderationHold: false }

  it('gives the host themselves everything, including switched-off and held listings', async () => {
    const where = await whereFor(WHO['the owning host'])
    expect(where.hostId).toBe('host_1')
    expect(where).not.toHaveProperty('isActive')
    expect(where).not.toHaveProperty('moderationHold')
  })
  it('gives an admin everything', async () => {
    const where = await whereFor(WHO['an admin'])
    expect(where).not.toHaveProperty('isActive')
    expect(where).not.toHaveProperty('moderationHold')
  })
  it('gives a signed-out visitor only what is public', async () => {
    expect(await whereFor(null)).toMatchObject(PUBLIC)
  })
  it('gives a guest and another host only what is public', async () => {
    expect(await whereFor(WHO['a guest'])).toMatchObject(PUBLIC)
    expect(await whereFor(WHO['another host'])).toMatchObject(PUBLIC)
  })
  it('gives a former host who is now a guest only what is public, even for their own id', async () => {
    expect(await whereFor({ id: 'host_1', role: 'GUEST' })).toMatchObject(PUBLIC)
  })
  it('leaves ordinary search as it was: active and not held', async () => {
    state.user = null
    await listings.GET(json('/api/listings?limit=20', 'GET'))
    expect(state.listingWhere).toMatchObject({ isActive: true, moderationHold: false })
    expect(state.listingWhere).not.toHaveProperty('hostId')
  })
})

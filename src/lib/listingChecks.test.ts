import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Address and photos checked" end to end: the real routes and the reminder
// job, run against an in-memory stand-in for the database. Nothing here can
// reach a real database, storage, Paystack or an email provider: notify() is
// a spy and storage is a stub.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  listings: [] as Row[], checks: [] as Row[], users: [] as Row[], bookings: [] as Row[], wishlists: [] as Row[],
  user: null as Row | null, writes: 0,
}))
const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn(), withMonitor: vi.fn((_n: string, fn: () => unknown) => fn()) }))
const notify = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => sentry)
vi.mock('@/lib/messaging/notify', () => ({ notify }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/supabase', () => ({
  LISTING_PHOTOS_BUCKET: 'listing-photos',
  supabaseAdmin: { storage: { from: () => ({
    upload: async () => ({ error: null }),
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.test/object/public/listing-photos/${p}` } }),
    remove: async () => ({ error: null }),
  }) } },
}))

vi.mock('@/lib/db', async () => {
  const { Prisma } = await import('@prisma/client')
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' })
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key] ?? null
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; gt?: Date; gte?: Date; lte?: Date; contains?: string }
        if ('in' in c && !c.in!.includes(value)) return false
        if ('gt' in c && !(value instanceof Date && value > c.gt!)) return false
        if ('gte' in c && !(value instanceof Date && value >= c.gte!)) return false
        if ('lte' in c && !(value instanceof Date && value <= c.lte!)) return false
        if ('contains' in c && !String(value ?? '').includes(c.contains!)) return false
        return true
      }
      return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond
    })
  const hostOf = (l: Row) => ({ ...(state.users.find((u) => u.id === l.hostId) ?? { id: l.hostId, name: 'Host' }) })
  const checksOf = (l: Row, spec?: { where?: Row; take?: number }) =>
    state.checks.filter((c) => c.listingId === l.id && matches(c, spec?.where))
      .sort((a, b) => (b.checkedAt as Date).getTime() - (a.checkedAt as Date).getTime())
      .slice(0, spec?.take)
      .map((c) => ({ ...c, checkedBy: { name: state.users.find((u) => u.id === c.checkedById)?.name ?? null }, revokedBy: c.revokedById ? { name: 'Admin' } : null }))
  const listingMatches = (l: Row, where: Row = {}): boolean => {
    const { checks, host, AND: _and, ...rest } = where as { checks?: { some: Row }; host?: Row; AND?: unknown } & Row
    if (checks && !state.checks.some((c) => c.listingId === l.id && matches(c, checks.some))) return false
    if (host && !matches(hostOf(l), host)) return false
    return matches(l, rest)
  }
  // Like the real thing: only what is asked for comes back with a listing
  const listingView = (l: Row, shape: Row = {}) => ({
    ...l,
    ...(shape.host ? { host: hostOf(l) } : {}),
    ...(shape.checks ? { checks: checksOf(l, shape.checks as { where?: Row; take?: number }) } : {}),
    ...(shape.reviews ? { reviews: [] } : {}),
    ...(shape.blockedDates ? { blockedDates: [] } : {}),
  })

  const db = {
    listing: {
      findUnique: async ({ where, include, select }: { where: Row; include?: Row; select?: Row }) => {
        const row = state.listings.find((l) => l.id === where.id)
        return row ? listingView(row, include ?? select) : null
      },
      findMany: async ({ where, include, select }: { where?: Row; include?: Row; select?: Row }) =>
        state.listings.filter((l) => listingMatches(l, where)).map((l) => listingView(l, include ?? select)),
      count: async ({ where }: { where?: Row }) => state.listings.filter((l) => listingMatches(l, where)).length,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.listings.find((l) => l.id === where.id)!
        Object.assign(row, data)
        state.writes++
        return { ...row }
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `listing_${state.listings.length + 1}`, ...data }
        state.listings.push(row)
        state.writes++
        return { ...row }
      },
    },
    listingCheck: {
      findMany: async ({ where }: { where: Row }) => {
        const { listing, ...rest } = where as { listing?: Row } & Row
        return state.checks.filter((c) => matches(c, rest) && (!listing || matches(state.listings.find((l) => l.id === c.listingId)!, listing)))
          .sort((a, b) => (a.expiresAt as Date).getTime() - (b.expiresAt as Date).getTime()).map((c) => ({ ...c }))
      },
      findFirst: async ({ where }: { where: Row }) => {
        const row = state.checks.filter((c) => matches(c, where)).sort((a, b) => (b.checkedAt as Date).getTime() - (a.checkedAt as Date).getTime())[0]
        return row ? { ...row } : null
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        // A yield, so two callers really can read before either writes
        await tick()
        const rows = state.checks.filter((c) => matches(c, where))
        rows.forEach((r) => Object.assign(r, data))
        state.writes += rows.length
        return { count: rows.length }
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `check_${state.checks.length + 1}`, revokedAt: null, revokedById: null, revokeReason: null, revokeNote: null, ...data }
        state.checks.push(row)
        state.writes++
        return { ...row }
      },
    },
    booking: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = state.bookings.find((b) => b.id === where.id)
        if (!row) return null
        const l = state.listings.find((x) => x.id === row.listingId)!
        // The route's own select: no digital address in it
        return { ...row, listing: { id: l.id, title: l.title, photos: l.photos, city: l.city, neighbourhood: l.neighbourhood, hostId: l.hostId }, payments: [], disputes: [], instalments: [], refund: null }
      },
    },
    wishlist: { findMany: async ({ where }: { where: Row }) => state.wishlists.filter((w) => matches(w, where)).map((w) => ({ ...w, listing: listingView(state.listings.find((l) => l.id === w.listingId)!, { host: true, checks: {} }) })) },
    user: { findMany: async () => [] },
    notification: { createMany: async () => ({ count: 0 }) },
  }

  // One transaction at a time, and a thrown error puts everything back
  let queue: Promise<unknown> = Promise.resolve()
  ;(db as unknown as { $transaction: unknown }).$transaction = (fn: (tx: unknown) => unknown) => {
    const run = queue.then(async () => {
      const before = { listings: state.listings.map((r) => ({ ...r })), checks: state.checks.map((r) => ({ ...r })) }
      try {
        return await fn(db)
      } catch (error) {
        state.listings.splice(0, state.listings.length, ...before.listings)
        state.checks.splice(0, state.checks.length, ...before.checks)
        throw error
      }
    })
    queue = run.catch(() => {})
    return run
  }
  return { db }
})

import { publicListing } from '@/lib/listingChecks'
import { runListingCheckReminders } from '@/lib/listingCheckReminders'
import { CHECK_ITEM_KEYS } from '@/lib/listingCheckRules'
import * as adminChecks from '@/app/api/admin/listing-checks/route'
import { POST as adminAction } from '@/app/api/admin/route'
import { GET as searchListings, POST as createListing } from '@/app/api/listings/route'
import { GET as getListing, PATCH as editListing } from '@/app/api/listings/[id]/route'
import { POST as addPhotos, DELETE as removePhoto } from '@/app/api/listings/[id]/photos/route'
import { GET as getWishlist } from '@/app/api/wishlists/route'
import { GET as getBookings } from '@/app/api/bookings/route'
import * as reminderCron from '@/app/api/cron/listing-check-reminders/route'

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2027-03-12T10:00:00Z')
const DAY = 86_400_000
const at = (iso: string) => { vi.setSystemTime(new Date(iso)) }
const as = (id: string | null, role = 'GUEST') => { state.user = id ? { id, role, email: `${id}@example.test`, emailVerifiedAt: NOW } : null }
const listing = (id = 'home') => state.listings.find((l) => l.id === id)!
const params = (id = 'home') => ({ params: Promise.resolve({ id }) })
const notified = (event: string) => notify.mock.calls.filter(([e]) => e === event).map(([, ids]) => ids)
const GOOD = { method: 'VIDEO_CALL', checks: [...CHECK_ITEM_KEYS], note: 'Video call on 12 March; walked through every room with the host.' }

const admin = (body: Row) => adminChecks.POST(new Request('http://x/api/admin/listing-checks', { method: 'POST', body: JSON.stringify(body) }))
const mark = (over: Row = {}, listingId = 'home') => admin({ action: 'mark', listingId, ...GOOD, ...over })
const revoke = (reason: unknown = 'The photos are of a different flat', listingId = 'home') => admin({ action: 'revoke', listingId, reason })
const edit = (body: Row, id = 'home') => editListing(new Request(`http://x/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), params(id))
const search = async (query = '') => (await (await searchListings(new Request(`http://x/api/listings${query}`))).json()) as { listings: Row[]; total: number }
const view = async (id = 'home') => (await (await getListing(new Request('http://x'), params(id))).json()).listing as Row
const hasBadge = async (id = 'home') => !!(await view(id)).check
const live = () => state.checks.filter((c) => !c.revokedAt && (c.expiresAt as Date) > new Date())

/** Marks the home as checked, as an admin, and signs the host back in. */
async function checked() {
  as('admin_1', 'ADMIN')
  expect((await mark()).status).toBe(200)
  notify.mockClear()
  as('host_1', 'HOST')
}

beforeEach(() => {
  for (const key of ['listings', 'checks', 'users', 'bookings', 'wishlists'] as const) state[key].length = 0
  state.users.push({ id: 'host_1', name: 'Kwame Mensah', isVerified: true, isSuperhost: false }, { id: 'admin_1', name: 'Admin One' }, { id: 'admin_2', name: 'Admin Two' })
  state.listings.push({
    id: 'home', hostId: 'host_1', title: 'Sea-view apartment', description: 'Bright and quiet.', propertyType: 'Apartment',
    region: 'Greater Accra', city: 'Accra', neighbourhood: 'Labadi', lat: 5.56, lng: -0.15, digitalAddress: 'GA-183-8164',
    bedrooms: 2, bathrooms: 1, maxGuests: 4, amenities: '[]', rentalModes: '["SHORT_STAY"]', priceNightly: 100, priceMonthly: null, priceAnnual: null,
    advanceMonthsRequired: null, photos: '["https://storage.test/object/public/listing-photos/home/a.jpg","https://storage.test/object/public/listing-photos/home/b.jpg"]',
    rules: '[]', cancellationPolicy: 'MODERATE', instantBook: false, minStayNights: 1, isActive: true, moderationHold: false, isFeatured: false,
    avgRating: 0, reviewCount: 0, welcomeMessage: null, damageDeposit: null, createdAt: new Date('2027-01-01T00:00:00Z'), updatedAt: new Date('2027-01-01T00:00:00Z'),
  })
  state.writes = 0
  notify.mockReset()
  sentry.withMonitor.mockClear()
  vi.unstubAllEnvs()
  vi.stubEnv('CRON_SECRET', 'cron_secret')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  as('admin_1', 'ADMIN')
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

// ─── Marking a listing as checked ───────────────────────────────────────────

describe('marking a listing as checked', () => {
  it('is for admins only', async () => {
    for (const [id, role] of [['host_1', 'HOST'], ['guest_1', 'GUEST']] as const) {
      as(id, role)
      expect((await mark()).status, role).toBe(403)
      expect((await revoke()).status, role).toBe(403)
      expect((await adminChecks.GET()).status, role).toBe(403)
    }
    as(null)
    expect((await mark()).status).toBe(401)
    expect((await adminChecks.GET()).status).toBe(401)
    expect(state.checks).toHaveLength(0)
    expect(await hasBadge()).toBe(false)
  })

  it('records who checked, when, how, the note, and what the listing was at the time', async () => {
    const res = await mark()
    expect(res.status).toBe(200)
    expect(state.checks).toHaveLength(1)
    expect(state.checks[0]).toMatchObject({
      listingId: 'home', checkedById: 'admin_1', checkedAt: NOW, expiresAt: new Date('2028-03-12T10:00:00Z'), method: 'VIDEO_CALL',
      checks: JSON.stringify(['ADDRESS_MATCHES', 'PHOTOS_MATCH', 'HOST_HAD_ACCESS']), note: GOOD.note,
      digitalAddress: 'GA-183-8164', photos: listing().photos, revokedAt: null,
    })
    expect(await hasBadge()).toBe(true)
    expect(notified('listing.checked')).toEqual([{ checkId: 'check_1' }])
  })

  it('records the admin who is signed in, never one named in the request', async () => {
    await mark({ adminId: 'admin_2', checkedById: 'admin_2', expiresAt: '2099-01-01T00:00:00Z', checkedAt: '2020-01-01T00:00:00Z' })
    expect(state.checks[0]).toMatchObject({ checkedById: 'admin_1', checkedAt: NOW, expiresAt: new Date('2028-03-12T10:00:00Z') })
  })

  it('is refused unless every item is confirmed, with a method and a note', async () => {
    for (const bad of [{ checks: ['ADDRESS_MATCHES', 'PHOTOS_MATCH'] }, { checks: [] }, { method: '' }, { method: 'PHONE' }, { note: 'too short' }, { note: '' }]) {
      const res = await mark(bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    expect(state.checks).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('can never be given to a listing with no photos', async () => {
    for (const photos of ['[]', '', '[""]']) {
      listing().photos = photos
      const res = await mark()
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/no photos/)
    }
    expect(state.checks).toHaveLength(0)
    expect(await hasBadge()).toBe(false)
  })

  it('can never be given to a listing with no digital address, on hold, or switched off', async () => {
    listing().digitalAddress = null
    expect((await (await mark()).json()).error).toMatch(/no digital address/)
    Object.assign(listing(), { digitalAddress: 'GA-183-8164', moderationHold: true })
    expect((await (await mark()).json()).error).toMatch(/on hold/)
    Object.assign(listing(), { moderationHold: false, isActive: false })
    expect((await (await mark()).json()).error).toMatch(/switched off/)
    expect((await mark({}, 'no-such-listing')).status).toBe(404)
    expect(state.checks).toHaveLength(0)
  })

  it('leaves a listing with one check standing, however many times it is marked', async () => {
    await mark()
    at('2027-06-01T09:00:00Z')
    await mark({ method: 'VISIT', note: 'Visited in person on 1 June and saw each room in the photos.' })
    expect(state.checks).toHaveLength(2)
    expect(live()).toHaveLength(1)
    expect(state.checks[0]).toMatchObject({ revokeReason: 'REPLACED', revokedById: 'admin_1', revokedAt: new Date('2027-06-01T09:00:00Z') })
    expect((await view()).check).toEqual({ checkedAt: '2027-06-01T09:00:00.000Z', expiresAt: '2028-06-01T09:00:00.000Z' })
  })

  it('makes one standing check when two admins click at the same moment', async () => {
    const results = await Promise.all([mark(), mark(), mark()])
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true)
    expect(live()).toHaveLength(1)
  })

  it('is the only thing in the code that can create a check', () => {
    const root = path.resolve(__dirname, '..')
    const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(dir, e.name)] : [])
    const creators = sources(root).filter((f) => /listingCheck\.(create|createMany|upsert)\b/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f))
    expect(creators).toEqual(['lib/listingChecks.ts'])
    // And the seed script gives no listing one
    expect(fs.readFileSync(path.resolve(root, '../prisma/seed.mjs'), 'utf8')).not.toMatch(/listingCheck/i)
  })
})

// ─── What the public can see ────────────────────────────────────────────────

describe('what anyone can see of a listing', () => {
  const PRIVATE = /GA-183-8164|walked through every room|admin_1|checkedById|digitalAddress"|"note"|"method"|VIDEO_CALL/

  it('never includes the digital address, the note, the checklist or who checked', async () => {
    await mark()
    state.wishlists.push({ id: 'w1', userId: 'guest_1', listingId: 'home' })
    for (const viewer of [null, ['guest_1', 'GUEST'], ['host_2', 'HOST']] as const) {
      as(viewer ? viewer[0] : null, viewer ? viewer[1] : undefined)
      expect(JSON.stringify(await view()), String(viewer)).not.toMatch(PRIVATE)
      expect(JSON.stringify(await search()), String(viewer)).not.toMatch(PRIVATE)
      expect(JSON.stringify(await search('?hostId=host_1')), String(viewer)).not.toMatch(PRIVATE)
    }
    as('guest_1')
    const wishlist = JSON.stringify(await (await getWishlist(new Request('http://x/api/wishlists'))).json())
    expect(wishlist).toContain('Sea-view apartment')
    expect(wishlist).not.toMatch(PRIVATE)
  })

  it('says only that there is a digital address, and the two dates of the check', async () => {
    await mark()
    as(null)
    const seen = await view()
    expect(seen.hasDigitalAddress).toBe(true)
    expect(seen.check).toEqual({ checkedAt: '2027-03-12T10:00:00.000Z', expiresAt: '2028-03-12T10:00:00.000Z' })
    expect((await search()).listings[0]).toMatchObject({ hasDigitalAddress: true, check: seen.check, host: { name: 'Kwame Mensah' } })
    listing().digitalAddress = null
    expect((await view()).hasDigitalAddress).toBe(false)
  })

  it('gives the digital address to the host of the listing and to an admin, to edit it', async () => {
    as('host_1', 'HOST')
    expect((await view()).digitalAddress).toBe('GA-183-8164')
    expect((await search('?hostId=host_1')).listings[0].digitalAddress).toBe('GA-183-8164')
    as('admin_1', 'ADMIN')
    expect((await view()).digitalAddress).toBe('GA-183-8164')
  })

  it('keeps a column private until it is named as public on purpose', () => {
    const row = { ...listing(), internalRiskScore: 7, hostBankAccount: '0241234567', checks: [] } as never
    const seen = publicListing(row)
    expect(seen).not.toHaveProperty('internalRiskScore')
    expect(seen).not.toHaveProperty('hostBankAccount')
    expect(seen).not.toHaveProperty('digitalAddress')
    expect(seen).not.toHaveProperty('checks')
    expect(seen).toMatchObject({ id: 'home', title: 'Sea-view apartment', city: 'Accra', lat: 5.56, priceNightly: 100 })
  })

  it('shows the admin queue everything needed to do the check', async () => {
    const queue = (await (await adminChecks.GET()).json()) as { queue: Row[]; checked: Row[]; items: Row }
    expect(queue.queue).toMatchObject([{ id: 'home', digitalAddress: 'GA-183-8164', photoCount: 2, check: null, blocked: null }])
    expect(Object.keys(queue.items)).toEqual(['ADDRESS_MATCHES', 'PHOTOS_MATCH', 'HOST_HAD_ACCESS'])
    listing().photos = '[]'
    expect((await (await adminChecks.GET()).json()).queue[0].blocked).toMatch(/no photos/)
  })
})

describe('the full digital address on a booking', () => {
  const booking = (over: Row = {}) => { state.bookings.push({ id: 'b1', listingId: 'home', guestId: 'guest_1', hostId: 'host_1', status: 'CONFIRMED', paymentStatus: 'PAID', ...over }) }
  const seen = async () => (await getBookings(new Request('http://x/api/bookings?id=b1'))).json()

  it('is shown to the guest once the booking is confirmed and paid, and not before', async () => {
    as('guest_1')
    for (const before of [{ status: 'PENDING', paymentStatus: 'UNPAID' }, { status: 'CONFIRMED', paymentStatus: 'UNPAID' }, { status: 'CANCELLED', paymentStatus: 'PAID' }, { status: 'DECLINED', paymentStatus: 'UNPAID' }, { status: 'CONFIRMED', paymentStatus: 'REFUNDED' }]) {
      state.bookings.length = 0
      booking(before)
      expect((await seen()).booking.listing.digitalAddress, JSON.stringify(before)).toBeNull()
    }
    for (const paid of [{}, { status: 'COMPLETED' }, { paymentStatus: 'PARTIALLY_REFUNDED' }]) {
      state.bookings.length = 0
      booking(paid)
      expect((await seen()).booking.listing.digitalAddress).toBe('GA-183-8164')
    }
  })

  it('is shown to the host and to an admin, and to nobody else', async () => {
    booking({ status: 'PENDING', paymentStatus: 'UNPAID' })
    as('host_1', 'HOST')
    expect((await seen()).booking.listing.digitalAddress).toBe('GA-183-8164')
    as('admin_1', 'ADMIN')
    expect((await seen()).booking.listing.digitalAddress).toBe('GA-183-8164')
    as('guest_2')
    const res = await getBookings(new Request('http://x/api/bookings?id=b1'))
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain('GA-183')
  })
})

// ─── Expiry ─────────────────────────────────────────────────────────────────

describe('expiry', () => {
  it('takes the badge away at the expiry moment, with nothing running', async () => {
    await mark()
    as(null)
    at('2028-03-12T09:59:59Z')
    expect(await hasBadge()).toBe(true)
    expect((await search('?checked=true')).total).toBe(1)
    at('2028-03-12T10:00:00Z')
    expect(await hasBadge()).toBe(false)
    expect((await search('?checked=true')).total).toBe(0)
    expect((await search()).listings[0].check).toBeNull()
    // Nothing was written to make that happen
    expect(state.checks[0].revokedAt).toBeNull()
  })

  it('puts the listing back in the admin queue for its last 30 days, and after', async () => {
    await mark()
    const queueAt = async (iso: string) => { at(iso); const d = await (await adminChecks.GET()).json(); return [d.queue.length, d.checked.length] }
    expect(await queueAt('2027-06-01T00:00:00Z')).toEqual([0, 1])
    expect(await queueAt('2028-02-15T00:00:00Z')).toEqual([1, 0])
    expect(await queueAt('2028-04-01T00:00:00Z')).toEqual([1, 0])
  })
})

describe('the search filter', () => {
  it('returns only listings whose check stands, and counts them rightly', async () => {
    state.listings.push({ ...listing(), id: 'other', title: 'Another home' })
    await mark()
    as(null)
    expect((await search()).total).toBe(2)
    const only = await search('?checked=true')
    expect(only.total).toBe(1)
    expect(only.listings.map((l) => l.id)).toEqual(['home'])
    as('admin_1', 'ADMIN')
    await revoke()
    as(null)
    expect((await search('?checked=true')).total).toBe(0)
  })

  it('still filters by hosts whose ID was checked, under the new name and the old', async () => {
    as(null)
    expect((await search('?hostIdChecked=true')).total).toBe(1)
    expect((await search('?verified=true')).total).toBe(1)
    state.users[0].isVerified = false
    expect((await search('?hostIdChecked=true')).total).toBe(0)
  })
})

// ─── Edits that take it away ────────────────────────────────────────────────

describe('editing a checked listing', () => {
  beforeEach(checked)

  it.each([
    ['the digital address', { digitalAddress: 'GA-183-8165' }, 'ADDRESS_CHANGED'],
    ['removing the digital address', { digitalAddress: '' }, 'ADDRESS_CHANGED'],
    ['the region', { region: 'Ashanti' }, 'ADDRESS_CHANGED'],
    ['the city', { city: 'Tema' }, 'ADDRESS_CHANGED'],
    ['the neighbourhood', { neighbourhood: 'Osu' }, 'ADDRESS_CHANGED'],
    ['the map position', { lat: 5.6, lng: -0.2 }, 'ADDRESS_CHANGED'],
    ['the property type', { propertyType: 'Villa' }, 'DETAILS_CHANGED'],
    ['the number of bedrooms', { bedrooms: 3 }, 'DETAILS_CHANGED'],
  ])('removes the check when the host changes %s', async (_what, change, reason) => {
    const res = await edit(change)
    expect(res.status).toBe(200)
    expect((await res.json()).checkRemoved).toBe(true)
    expect(state.checks[0]).toMatchObject({ revokeReason: reason, revokedById: null })
    expect(state.checks[0].revokedAt).toBeInstanceOf(Date)
    expect(await hasBadge()).toBe(false)
    expect(notified('listing.check_removed')).toEqual([{ checkId: 'check_1' }])
  })

  it('keeps the check through a save that changes nothing it covers', async () => {
    // What the edit form sends on every save: every field, most of them unchanged
    const res = await edit({
      title: 'Sea-view apartment with balcony', description: 'Even brighter.', propertyType: 'Apartment', region: 'Greater Accra', city: 'Accra',
      neighbourhood: 'Labadi', digitalAddress: 'ga 183 8164', bedrooms: 2, bathrooms: 2, maxGuests: 5, rentalModes: ['SHORT_STAY'],
      priceNightly: 120, amenities: ['WiFi'], rules: [], cancellationPolicy: 'STRICT', instantBook: true, minStayNights: 2, damageDeposit: 50,
      welcomeMessage: 'Akwaaba', isActive: true,
    })
    expect((await res.json()).checkRemoved).toBe(false)
    expect(await hasBadge()).toBe(true)
    expect(notify).not.toHaveBeenCalled()
    expect(listing().priceNightly).toBe(120)
  })

  it('keeps the check when the host pauses and unpauses the listing', async () => {
    await edit({ isActive: false })
    await edit({ isActive: true })
    expect(state.checks[0].revokedAt).toBeNull()
    expect(await hasBadge()).toBe(true)
  })

  it('removes it when an admin makes the same kind of edit', async () => {
    as('admin_1', 'ADMIN')
    await edit({ city: 'Kumasi' })
    expect(state.checks[0]).toMatchObject({ revokeReason: 'ADDRESS_CHANGED' })
    expect(await hasBadge()).toBe(false)
  })

  it('removes it when a photo is added', async () => {
    const form = new FormData()
    form.append('photos', new File([new Uint8Array([1, 2, 3])], 'c.jpg', { type: 'image/jpeg' }))
    const res = await addPhotos(new Request('http://x/api/listings/home/photos', { method: 'POST', body: form }), params())
    expect(res.status).toBe(200)
    expect(state.checks[0]).toMatchObject({ revokeReason: 'PHOTOS_CHANGED', revokedById: null })
    expect(await hasBadge()).toBe(false)
    expect(notified('listing.check_removed')).toEqual([{ checkId: 'check_1' }])
  })

  it('removes it when a photo is taken away', async () => {
    const url = 'https://storage.test/object/public/listing-photos/home/a.jpg'
    const res = await removePhoto(new Request('http://x/api/listings/home/photos', { method: 'DELETE', body: JSON.stringify({ url }) }), params())
    expect(res.status).toBe(200)
    expect(state.checks[0]).toMatchObject({ revokeReason: 'PHOTOS_CHANGED' })
    expect(await hasBadge()).toBe(false)
  })

  it('removes it when an admin puts the listing on hold', async () => {
    as('admin_1', 'ADMIN')
    const res = await adminAction(new Request('http://x/api/admin', { method: 'POST', body: JSON.stringify({ type: 'hold-listing', listingId: 'home' }) }))
    expect(res.status).toBe(200)
    expect(state.checks[0]).toMatchObject({ revokeReason: 'LISTING_HELD' })
    expect(notified('listing.check_removed')).toEqual([{ checkId: 'check_1' }])
    // Clearing the hold does not bring it back: an admin has to check again
    await adminAction(new Request('http://x/api/admin', { method: 'POST', body: JSON.stringify({ type: 'clear-hold', listingId: 'home' }) }))
    expect(await hasBadge()).toBe(false)
  })

  it('removes it when a description with contact details puts the listing on hold', async () => {
    const res = await edit({ description: 'Call me on 0241234567 to book direct' })
    expect((await res.json()).held).toBe(true)
    expect(state.checks[0]).toMatchObject({ revokeReason: 'LISTING_HELD' })
  })

  it('refuses a bad digital address and removes nothing', async () => {
    const res = await edit({ digitalAddress: '12 Oxford Street' })
    expect(res.status).toBe(400)
    expect(listing().digitalAddress).toBe('GA-183-8164')
    expect(await hasBadge()).toBe(true)
  })

  it('says nothing to the host about a check that had already run out', async () => {
    at('2028-04-01T00:00:00Z')
    await edit({ city: 'Tema' })
    expect(state.checks[0].revokeReason).toBe('ADDRESS_CHANGED')
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not let another host edit the listing, or change its check', async () => {
    as('host_2', 'HOST')
    expect((await edit({ city: 'Tema' })).status).toBe(403)
    expect(await hasBadge()).toBe(true)
  })
})

describe('the digital address on a listing', () => {
  beforeEach(() => as('host_1', 'HOST'))
  const create = (digitalAddress: unknown) => createListing(new Request('http://x/api/listings', {
    method: 'POST', body: JSON.stringify({ title: 'New home', region: 'Greater Accra', city: 'Accra', propertyType: 'Apartment', bedrooms: 1, digitalAddress }),
  }))

  it('is optional, and stored in one form when given', async () => {
    expect((await create(undefined)).status).toBe(201)
    expect(state.listings[1].digitalAddress).toBeNull()
    expect((await create(' gw 0012 3456 ')).status).toBe(201)
    expect(state.listings[2].digitalAddress).toBe('GW-0012-3456')
    await edit({ digitalAddress: 'ak0395028' })
    expect(listing().digitalAddress).toBe('AK-039-5028')
  })

  it('is refused on the server when it is not one, on a new listing and on an edit', async () => {
    for (const bad of ['Osu, Accra', 'GA-18-81', 12345]) {
      expect((await create(bad)).status, String(bad)).toBe(400)
      expect((await edit({ digitalAddress: bad })).status, String(bad)).toBe(400)
    }
    expect(state.listings).toHaveLength(1)
    expect(listing().digitalAddress).toBe('GA-183-8164')
  })

  it('gives a new listing no check', async () => {
    await create('GA-183-8164')
    expect(state.checks).toHaveLength(0)
    expect(await hasBadge(state.listings[1].id as string)).toBe(false)
  })
})

// ─── Removing a check ───────────────────────────────────────────────────────

describe('removing a check', () => {
  it('needs a reason, records who and why, and tells the host', async () => {
    await mark()
    notify.mockClear()
    for (const bad of ['', '   ', null, 5, ['x']]) expect((await revoke(bad)).status).toBe(400)
    expect(await hasBadge()).toBe(true)
    as('admin_2', 'ADMIN')
    expect((await revoke()).status).toBe(200)
    expect(state.checks[0]).toMatchObject({ revokedById: 'admin_2', revokeReason: 'ADMIN', revokeNote: 'The photos are of a different flat', revokedAt: NOW })
    expect(await hasBadge()).toBe(false)
    expect(notified('listing.check_removed')).toEqual([{ checkId: 'check_1' }])
  })

  it('does nothing the second time, or when there is no check', async () => {
    expect((await revoke()).status).toBe(409)
    await mark()
    const results = await Promise.all([revoke(), revoke()])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await revoke()).status).toBe(409)
    expect(notified('listing.check_removed')).toHaveLength(1)
  })

  it('never changes a record except to close it, once', async () => {
    await mark()
    const before = { ...state.checks[0] }
    await revoke()
    const after = { ...state.checks[0] }
    for (const key of ['listingId', 'checkedById', 'checkedAt', 'expiresAt', 'method', 'checks', 'note', 'digitalAddress', 'photos']) expect(after[key]).toEqual(before[key])
    await revoke('again')
    expect(state.checks[0]).toEqual(after)
  })
})

// ─── The 30-day reminder ────────────────────────────────────────────────────

describe('the reminder that a check is running out', () => {
  const cron = (query = '', secret: string | null = 'cron_secret', method: 'GET' | 'POST' = 'GET') =>
    reminderCron[method](new Request(`http://x/api/cron/listing-check-reminders${query}`, { method, headers: secret ? { authorization: `Bearer ${secret}` } : {} }))
  beforeEach(async () => { await mark(); notify.mockClear() })

  it('starts 30 days before the expiry and not a day sooner', async () => {
    at('2028-02-11T09:59:00Z')
    expect((await runListingCheckReminders()).results).toEqual([])
    at('2028-02-11T10:00:00Z')
    expect(await runListingCheckReminders()).toMatchObject({ mode: 'live', checked: 1, results: [{ checkId: 'check_1', listingId: 'home', action: 'reminded' }] })
    expect(notified('listing.check_expiring')).toEqual([{ checkId: 'check_1' }])
  })

  it('is keyed on the check, so a month of daily runs is one reminder', async () => {
    for (let d = 30; d >= 1; d--) {
      vi.setSystemTime(new Date(new Date('2028-03-12T10:00:00Z').getTime() - d * DAY + 60_000))
      await runListingCheckReminders()
    }
    // notify() is asked every day; it writes once, because every call names the same check and nothing else
    expect(new Set(notified('listing.check_expiring').map((ids) => JSON.stringify(ids))).size).toBe(1)
    expect(notified('listing.check_expiring')[0]).toEqual({ checkId: 'check_1' })
  })

  it('says nothing once the check has run out, been removed, or its listing is not live', async () => {
    at('2028-03-12T10:00:00Z')
    expect((await runListingCheckReminders()).results).toEqual([])
    at('2028-03-01T00:00:00Z')
    for (const hidden of [{ isActive: false }, { moderationHold: true }]) {
      Object.assign(listing(), hidden)
      expect((await runListingCheckReminders()).results, JSON.stringify(hidden)).toEqual([])
      Object.assign(listing(), { isActive: true, moderationHold: false })
    }
    await revoke()
    notify.mockClear()
    expect((await runListingCheckReminders()).results).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it('writes nothing on a dry run', async () => {
    at('2028-03-01T00:00:00Z')
    expect(await runListingCheckReminders({ dryRun: true })).toMatchObject({ mode: 'dry-run', reason: 'dryRun was requested', results: [{ action: 'would-remind' }] })
    expect(notify).not.toHaveBeenCalled()
    expect(await (await cron('?dryRun=1')).json()).toMatchObject({ mode: 'dry-run', results: [{ action: 'would-remind' }] })
    expect(notify).not.toHaveBeenCalled()
  })

  it('needs the cron secret, on GET and on POST', async () => {
    at('2028-03-01T00:00:00Z')
    expect((await cron('', null)).status).toBe(401)
    expect((await cron('', 'wrong')).status).toBe(401)
    expect((await cron('', null, 'POST')).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await cron('', '')).status).toBe(401)
    expect(notify).not.toHaveBeenCalled()
    expect(sentry.withMonitor).not.toHaveBeenCalled()
  })

  it('runs under a Sentry monitor on the schedule vercel.json gives it', async () => {
    expect((await cron('', 'cron_secret', 'POST')).status).toBe(200)
    expect(sentry.withMonitor).toHaveBeenCalledWith('listing-check-reminders-cron', expect.any(Function), expect.objectContaining({ schedule: { type: 'crontab', value: '15 8 * * *' }, timezone: 'UTC' }))
    const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8'))
    expect(vercel.crons).toContainEqual({ path: '/api/cron/listing-check-reminders', schedule: '15 8 * * *' })
  })

  it('never changes a check or a listing: the badge does not depend on it', async () => {
    at('2028-03-01T00:00:00Z')
    const before = JSON.stringify([state.checks, state.listings])
    await runListingCheckReminders()
    expect(JSON.stringify([state.checks, state.listings])).toBe(before)
  })
})

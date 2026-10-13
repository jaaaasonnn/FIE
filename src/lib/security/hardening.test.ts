import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Row } from '@/lib/testing/fakeDb'
import type { State } from './harness'

// Uploads checked by what they contain, the exchange rate an admin types,
// how much one request may ask for, and what the payment routes give away.

const state = vi.hoisted(() => ({ tables: {}, user: null } as State))
const stored = vi.hoisted(() => [] as { bucket: string; path: string; contentType: string; bytes: number }[])
const removed = vi.hoisted(() => [] as string[])
/** Something to run while a file is being taken out of storage, to put two requests in a known order */
const hooks = vi.hoisted(() => ({ duringRemove: null as null | (() => Promise<unknown>) }))
vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => (state.user ? { ...state.user } : null) }))
vi.mock('@/lib/messaging/notify', () => ({ notify: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  AVATARS_BUCKET: 'avatars', LISTING_PHOTOS_BUCKET: 'listing-photos', VERIFICATION_DOCS_BUCKET: 'verification-docs', DISPUTE_EVIDENCE_BUCKET: 'dispute-evidence',
  supabaseAdmin: { storage: { from: (bucket: string) => ({
    upload: async (p: string, body: Buffer, options: { contentType: string }) => { stored.push({ bucket, path: p, contentType: options.contentType, bytes: body.length }); return { error: null } },
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.test/object/public/${bucket}/${p}` } }),
    remove: async (paths: string[]) => { removed.push(...paths); const during = hooks.duringRemove; hooks.duringRemove = null; await during?.(); return { error: null } },
  }) } },
}))

import { NOW, as, home, json, params, person, reset, stay } from './harness'
import { NOT_AN_IMAGE, sniffImage } from '@/lib/imageBytes'
import { MAX_MANUAL_RATE_STEP, manualRateRefusal } from '@/lib/exchangeRate'
import { MAX_PAGE_SIZE, clampWhole } from '@/lib/validate'
import { POST as uploadAvatar } from '@/app/api/users/me/photo/route'
import { DELETE as removeListingPhoto, POST as uploadListingPhotos } from '@/app/api/listings/[id]/photos/route'
import { POST as uploadId } from '@/app/api/verifications/route'
import { POST as uploadEvidence } from '@/app/api/disputes/[id]/evidence/route'
import { POST as adminAction } from '@/app/api/admin/route'
import { GET as searchListings } from '@/app/api/listings/route'
import { GET as getReviews, POST as postReview } from '@/app/api/reviews/route'
import { POST as startPayment } from '@/app/api/payments/route'

const root = path.resolve(__dirname, '../../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]
const HTML = [...Buffer.from('<html><script>alert(document.cookie)</script></html>')]
const SVG = [...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')]
const file = (bytes: number[], type: string, name = 'photo.jpg') => new File([new Uint8Array(bytes)], name, { type })
const form = (fields: Record<string, File | string | File[]>) => {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v)
  return new Request('http://localhost/api/x', { method: 'POST', body: fd })
}

beforeEach(() => {
  reset(state)
  stored.length = 0
  removed.length = 0
  hooks.duringRemove = null
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const method of ['error', 'log', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  person(state, 'host', 'HOST')
  person(state, 'guest')
  person(state, 'admin', 'ADMIN')
  home(state, 'home', 'host')
})

describe('what a file really is', () => {
  it('is read from its first bytes', () => {
    expect(sniffImage(new Uint8Array(JPEG))).toBe('image/jpeg')
    expect(sniffImage(new Uint8Array(PNG))).toBe('image/png')
    expect(sniffImage(new Uint8Array(WEBP))).toBe('image/webp')
    for (const bytes of [HTML, SVG, [], [0xff, 0xd8], [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20], [...Buffer.from('GIF89a')], [0x25, 0x50, 0x44, 0x46]]) {
      expect(sniffImage(new Uint8Array(bytes))).toBeNull()
    }
  })
})

describe('uploads', () => {
  const routes: [string, (f: File) => Promise<Response>, string][] = [
    ['a profile photo', async (f) => { as(state, 'guest'); return uploadAvatar(form({ photo: f })) }, 'avatars'],
    ['a listing photo', async (f) => { as(state, 'host'); return uploadListingPhotos(form({ photos: f }), params('home')) }, 'listing-photos'],
    ['an ID document', async (f) => { as(state, 'guest'); return uploadId(form({ idType: 'GHANA_CARD', idPhoto: f })) }, 'verification-docs'],
    ['a selfie with an ID', async (f) => { as(state, 'guest'); return uploadId(form({ idType: 'GHANA_CARD', idPhoto: file(JPEG, 'image/jpeg'), selfie: f })) }, 'verification-docs'],
    ['dispute evidence', async (f) => {
      stay(state, 'booking', 'home', 'guest', 'host')
      ;(state.tables.dispute ??= []).push({ id: 'dispute', bookingId: 'booking', status: 'OPEN', raisedByRole: 'GUEST' })
      as(state, 'guest')
      return uploadEvidence(form({ photos: f }), params('dispute'))
    }, 'dispute-evidence'],
  ]

  it.each(routes)('%s: a file that only claims to be an image is refused', async (name, upload) => {
    // A web page, a script-carrying SVG and a PNG, each sent in saying it is a JPEG
    for (const bytes of [HTML, SVG, PNG]) {
      stored.length = 0
      const res = await upload(file(bytes, 'image/jpeg'))
      expect(res.status, name).toBe(400)
      expect((await res.json()).error).toBe(NOT_AN_IMAGE)
      // Nothing of it was stored (the selfie case stores nothing either: both are checked first)
      expect(stored).toEqual([])
    }
    expect(state.tables.verification ?? []).toHaveLength(0)
    expect(state.tables.disputeEvidence ?? []).toHaveLength(0)
  })

  it.each(routes)('%s: a real image is stored as what it is', async (_name, upload, bucket) => {
    const res = await upload(file(WEBP, 'image/webp', 'photo.webp'))
    expect(res.status).toBeLessThan(300)
    expect(stored.at(-1)).toMatchObject({ bucket, contentType: 'image/webp', bytes: WEBP.length })
  })

  it('checks every listing photo before storing any of them', async () => {
    as(state, 'host')
    const res = await uploadListingPhotos(form({ photos: [file(JPEG, 'image/jpeg'), file(HTML, 'image/jpeg')] }), params('home'))
    expect(res.status).toBe(400)
    expect(stored).toEqual([])
    expect(state.tables.listing[0].photos).toBe('[]')
  })

  describe('listing photos changed at the same moment', () => {
    const photos = () => JSON.parse(state.tables.listing[0].photos as string) as string[]
    const upload = (count = 1) => uploadListingPhotos(form({ photos: Array.from({ length: count }, (_, i) => file(JPEG, 'image/jpeg', `p${i}.jpg`)) }), params('home'))
    beforeEach(() => as(state, 'host'))

    it('five uploads at the same moment are all kept', async () => {
      const replies = await Promise.all(Array.from({ length: 5 }, () => upload()))
      expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
      expect(photos()).toHaveLength(5)
      expect(new Set(photos()).size).toBe(5)
      // Every file that was stored is on the listing
      expect(stored.map((s) => `https://storage.test/object/public/listing-photos/${s.path}`).sort()).toEqual([...photos()].sort())
    })

    it('a photo added while another is being removed is kept, and the one removed is gone', async () => {
      await upload(2)
      const [first, second] = photos()
      // The removal has read the list; while its file is being deleted, an upload starts and finishes
      let added: Response | undefined
      hooks.duringRemove = async () => { added = await upload() }
      const gone = await removeListingPhoto(json('DELETE', { url: first }), params('home'))
      expect([gone.status, added?.status]).toEqual([200, 200])
      expect(photos()).toHaveLength(2)
      expect(photos()).not.toContain(first)
      expect(photos()[0]).toBe(second)
      expect((await gone.json()).photos).toEqual(photos())
    })

    it('uploads that together would pass 12 photos: the ones over are refused and their files taken out of storage again', async () => {
      await upload(10)
      const replies = await Promise.all([upload(2), upload(2)])
      expect(replies.map((r) => r.status).sort()).toEqual([200, 400])
      expect(photos()).toHaveLength(12)
      expect((await replies.find((r) => r.status === 400)!.json()).error).toBe('A listing can have at most 12 photos (12 already uploaded)')
      // The two files of the refused upload are not left behind with nothing pointing at them
      expect(removed).toHaveLength(2)
      for (const gone of removed) expect(photos().join(' ')).not.toContain(gone)
    })
  })
})

describe('the exchange rate an admin types', () => {
  const setRate = (body: Row) => adminAction(json('POST', { type: 'update-exchange-rate', ...body }))
  beforeEach(() => {
    ;(state.tables.exchangeRate ??= []).push({ id: 'rate_1', usdToGhs: 15.5, updatedBy: 'auto', updatedAt: NOW })
    as(state, 'admin')
  })

  it('refuses a slip of the finger, and anything that is not a rate', async () => {
    for (const usdToGhs of [1.55, 155, 0, -15.5, '15.5', null, undefined, NaN, 12.3, 18.7, { gt: 0 }]) {
      const res = await setRate({ usdToGhs })
      expect(res.status, String(usdToGhs)).toBe(400)
    }
    expect(state.tables.exchangeRate).toHaveLength(1)
  })

  it('accepts a rate within 20% of the one in force, recorded as the admin signed in', async () => {
    expect(manualRateRefusal(15.5 * (1 + MAX_MANUAL_RATE_STEP), 15.5)).toBeNull()
    expect(manualRateRefusal(15.5 * (1 - MAX_MANUAL_RATE_STEP), 15.5)).toBeNull()
    const res = await setRate({ usdToGhs: 16.2, updatedBy: 'someone_else' })
    expect(res.status).toBe(200)
    expect(state.tables.exchangeRate[1]).toMatchObject({ usdToGhs: 16.2, updatedBy: 'admin' })
  })

  it('with no rate in force yet, accepts any rate in the range rates have ever been', () => {
    expect(manualRateRefusal(15.5, null)).toBeNull()
    expect(manualRateRefusal(0.5, null)).not.toBeNull()
    expect(manualRateRefusal(101, null)).not.toBeNull()
  })

  it('is for admins only', async () => {
    as(state, 'host')
    expect((await setRate({ usdToGhs: 16 })).status).toBe(403)
    expect(state.tables.exchangeRate).toHaveLength(1)
  })
})

describe('how much one request may ask for', () => {
  it('keeps a page of listings to 50 at most, whatever is asked for', async () => {
    for (let i = 0; i < 70; i++) home(state, `extra${i}`, 'host')
    for (const limit of ['100000', '-5', '0', 'abc', '1e9', '51']) {
      const body = await (await searchListings(new Request(`http://x/api/listings?limit=${limit}`))).json()
      expect(body.listings.length, limit).toBeLessThanOrEqual(MAX_PAGE_SIZE)
      expect(body.listings.length, limit).toBeGreaterThanOrEqual(1)
    }
    expect((await (await searchListings(new Request('http://x/api/listings?limit=5&page=-3'))).json()).listings).toHaveLength(5)
    expect(clampWhole('100000', 20, 1, 50)).toBe(50)
    expect(clampWhole(null, 20, 1, 50)).toBe(20)
    expect(clampWhole('-1', 20, 1, 50)).toBe(20)
  })

  it('gives reviews of a listing or a person, never the whole table', async () => {
    for (let i = 0; i < 130; i++) (state.tables.review ??= []).push({ id: `r${i}`, bookingId: `b${i}`, listingId: 'home', reviewerId: 'guest', revieweeId: 'host', type: 'GUEST_TO_HOST', rating: 5, comment: 'Good', isPublished: true, createdAt: NOW })
    expect((await getReviews(new Request('http://x/api/reviews'))).status).toBe(400)
    const body = await (await getReviews(new Request('http://x/api/reviews?listingId=home'))).json()
    expect(body.reviews).toHaveLength(100)
  })

  it('answers "already reviewed" when two reviews of one booking arrive at the same moment', async () => {
    stay(state, 'booking', 'home', 'guest', 'host', { status: 'COMPLETED' })
    as(state, 'guest')
    const send = () => postReview(json('POST', { bookingId: 'booking', rating: 5, comment: 'A lovely stay.', type: 'GUEST_TO_HOST' }))
    const [first, second] = await Promise.all([send(), send()])
    expect([first.status, second.status].sort()).toEqual([201, 409])
    expect(state.tables.review).toHaveLength(1)
  })
})

describe('starting a payment', () => {
  const pay = (over: Record<string, unknown> = {}) => startPayment(json('POST', { bookingId: 'booking', method: 'MOMO', ...over }))
  beforeEach(() => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_hardening')
    stay(state, 'booking', 'home', 'guest', 'host', { paymentStatus: 'UNPAID', payBy: new Date(NOW.getTime() + 60 * 60 * 1000) })
    as(state, 'guest')
  })

  it('uses a reference that cannot be guessed from the booking', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const reference = JSON.parse(init.body).reference as string
      seen.push(reference)
      return new Response(JSON.stringify({ status: true, message: 'ok', data: { authorization_url: 'https://checkout.paystack.com/x', access_code: 'x', reference } }), { status: 200 })
    }))
    expect((await pay()).status).toBe(200)
    // The first attempt is closed (say the card was declined); the next one is a new payment
    state.tables.payment[0].status = 'FAILED'
    expect((await pay()).status).toBe(200)
    for (const reference of seen) expect(reference).toMatch(/^FIE-booking-\d{13}-[0-9a-f]{16}$/)
    // Same booking, same millisecond: still two different references
    expect(new Set(seen).size).toBe(2)
    expect(state.tables.payment.map((p) => p.gatewayReference)).toEqual(seen)
  })

  it('pressing Pay again while a payment is open gives back the same Paystack page, not a second payment', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      asked.push(String(url))
      // Asked what became of the open payment: nobody has paid it yet
      if (String(url).includes('/transaction/verify/')) return new Response(JSON.stringify({ status: true, data: { status: 'abandoned', amount: null, currency: null } }), { status: 200 })
      const reference = JSON.parse(init!.body!).reference as string
      return new Response(JSON.stringify({ status: true, message: 'ok', data: { authorization_url: `https://checkout.paystack.com/${reference}`, access_code: 'x', reference } }), { status: 200 })
    }))
    const first = await (await pay()).json()
    const second = await (await pay()).json()
    const third = await (await pay()).json()
    expect(second).toMatchObject({ authorizationUrl: first.authorizationUrl, reference: first.reference, reused: true })
    expect(third.reference).toBe(first.reference)
    expect(state.tables.payment).toHaveLength(1)
    expect(state.tables.payment[0]).toMatchObject({ status: 'PENDING', authorizationUrl: first.authorizationUrl })
    // Paystack was asked to start one payment only
    expect(asked.filter((u) => u.endsWith('/transaction/initialize'))).toHaveLength(1)
  })

  it('pressing Pay again after the open payment was paid settles it and starts nothing', async () => {
    let paid = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/transaction/verify/')) {
        const row = state.tables.payment[0]
        return new Response(JSON.stringify({ status: true, data: { status: paid ? 'success' : 'abandoned', amount: row.amountPesewas, currency: 'GHS' } }), { status: 200 })
      }
      const reference = JSON.parse(init!.body!).reference as string
      return new Response(JSON.stringify({ status: true, message: 'ok', data: { authorization_url: 'https://checkout.paystack.com/x', access_code: 'x', reference } }), { status: 200 })
    }))
    expect((await pay()).status).toBe(200)
    paid = true
    const again = await pay()
    expect(again.status).toBe(400)
    expect(await again.json()).toMatchObject({ code: 'ALREADY_PAID' })
    expect(state.tables.payment.map((p) => p.status)).toEqual(['SUCCESS'])
    expect(state.tables.booking[0]).toMatchObject({ paymentStatus: 'PAID' })
  })

  it('choosing another way to pay closes the open payment and starts a new one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/transaction/verify/')) return new Response(JSON.stringify({ status: true, data: { status: 'abandoned', amount: null, currency: null } }), { status: 200 })
      const reference = JSON.parse(init!.body!).reference as string
      return new Response(JSON.stringify({ status: true, message: 'ok', data: { authorization_url: `https://checkout.paystack.com/${reference}`, access_code: 'x', reference } }), { status: 200 })
    }))
    expect((await pay()).status).toBe(200)
    expect((await pay({ method: 'CARD' })).status).toBe(200)
    expect(state.tables.payment.map((p) => [p.method, p.status])).toEqual([['MOMO', 'FAILED'], ['CARD', 'PENDING']])
  })

  it('a dropped connection to Paystack closes the attempt and answers like any other failure to start', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await pay()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('The payment could not be started. Please try again in a moment.')
    expect(state.tables.payment.map((p) => p.status)).toEqual(['FAILED'])
    expect(state.tables.booking[0].paymentReference ?? null).toBeNull()
  })

  it('tells the guest when Paystack does not answer in time, and closes the attempt so they can try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }))
    const res = await pay()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Paystack is not answering. Please try again in a moment.')
    expect(state.tables.payment.map((p) => p.status)).toEqual(['FAILED'])
    expect(state.tables.booking[0].paymentReference ?? null).toBeNull()
  })

  it('keeps Paystack\'s own error wording out of the answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: false, message: 'Invalid key: sk_test_hard… for guest@example.test' }), { status: 401 })))
    const res = await pay()
    expect(res.status).toBe(502)
    const text = JSON.stringify(await res.json())
    expect(text).not.toMatch(/Invalid key|sk_test|guest@example\.test/)
    expect(text).toContain('The payment could not be started')
    // And the same on the payout method route
    const payoutMethod = read('src/app/api/users/me/payout-method/route.ts')
    expect(payoutMethod).not.toMatch(/error: (resolveJson|recipientJson)\??\.message/)
  })
})

describe('housekeeping', () => {
  it('keeps local working files out of git', () => {
    expect(read('.gitignore').split('\n')).toContain('.scratch/')
  })

  it('does not log every wishlist click', () => {
    expect(read('src/app/api/wishlists/route.ts')).not.toContain('console.log')
  })
})

describe('logging in from a link that says where to go next', () => {
  // The behaviour is tested in a browser (e2e/tests/navigation/feel.spec.ts, "deep links").
  // This holds the one line that makes it work in place.
  const page = read('src/app/login/page.tsx')
  const handler = (name: string) => page.slice(page.indexOf(`async function ${name}(`), page.indexOf('\n  }\n', page.indexOf(`async function ${name}(`)))

  it('the form says it will choose the destination before it signs in, so the "already logged in" redirect stands down', () => {
    for (const [name, call] of [['handleLogin', 'await signIn('], ['handleSignup', 'await signUp(']] as const) {
      const body = handler(name)
      const said = body.indexOf('mountedWithUser.current = true')
      expect(said, name).toBeGreaterThan(-1)
      expect(said, name).toBeLessThan(body.indexOf(call))
    }
  })

  it('follows the redirect only to a path on this site', () => {
    expect(handler('handleLogin')).toContain('isSafeRedirect(redirect) ? redirect :')
  })
})

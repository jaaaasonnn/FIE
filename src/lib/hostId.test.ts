import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The rule (what counts as an approved ID), the words about it, the admin's
// decision route, and a scan of the source for any way round the payout guard.
// Everything runs against an in-memory stand-in: no database, no storage.

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  users: [] as Row[], verifications: [] as Row[], uploads: [] as string[],
  session: null as Row | null,
}))
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/messaging/notify', () => ({ notify }))
vi.mock('@/lib/supabase', () => ({
  VERIFICATION_DOCS_BUCKET: 'verification-docs',
  supabaseAdmin: { storage: { from: () => ({ upload: async (p: string) => { state.uploads.push(p); return { error: null } } }) } },
}))
vi.mock('@/lib/session', () => ({ getSessionUser: async () => state.session }))
vi.mock('@/lib/roles', async () => {
  const { NextResponse } = await import('next/server')
  return {
    requireAdmin: async () => {
      if (!state.session) return { error: NextResponse.json({ error: 'Sign in' }, { status: 401 }) }
      if (state.session.role !== 'ADMIN') return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
      return { user: state.session }
    },
  }
})
vi.mock('@/lib/db', () => {
  const verification = {
    findUnique: async ({ where }: { where: Row }) => {
      const v = state.verifications.find((r) => (where.id ? r.id === where.id : r.userId === where.userId))
      if (!v) return null
      const u = state.users.find((x) => x.id === v.userId)!
      return { ...v, user: { isVerified: u.isVerified, trustScore: u.trustScore } }
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = state.verifications.filter((r) => r.id === where.id && r.status === where.status)
      rows.forEach((r) => Object.assign(r, data))
      return { count: rows.length }
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = state.verifications.find((r) => r.userId === where.userId)!
      return Object.assign(row, data)
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `ver_${state.verifications.length + 1}`, reviewedById: null, notes: null, ...data }
      state.verifications.push(row)
      return row
    },
  }
  const user = {
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = state.users.find((u) => u.id === where.id)!
      for (const [key, v] of Object.entries(data)) {
        row[key] = v !== null && typeof v === 'object' && 'increment' in v ? (row[key] as number) + (v as { increment: number }).increment : v
      }
      return row
    },
  }
  const db = { verification, user, $transaction: async (work: (tx: unknown) => unknown) => work({ verification, user }) }
  return { db }
})

import {
  BECOME_A_HOST_ID, HOST_ID_BANNER, HostIdNotApprovedError, LISTING_ID_NOTICE, PAYOUTS_NEED_ID, WHO_NEEDS_ID,
  hostIdApproved, hostIdState, waitingForIdLine,
} from '@/lib/hostId'
import { PATCH as decide, POST as submit } from '@/app/api/verifications/route'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
/** Every source file under src that is not a test */
const sources = (dir = path.join(root, 'src')): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) return sources(full)
  return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [full] : []
})

const approved = { isVerified: true, verification: { status: 'APPROVED', reviewedById: 'admin_1' } }

// ─── The rule ───────────────────────────────────────────────────────────────

describe('what counts as an approved ID', () => {
  it('needs the flag, an APPROVED document and a recorded reviewer, all three', () => {
    expect(hostIdApproved(approved)).toBe(true)
    expect(hostIdApproved({ ...approved, isVerified: false })).toBe(false)
    expect(hostIdApproved({ isVerified: true, verification: null })).toBe(false)
    expect(hostIdApproved({ isVerified: true })).toBe(false)
    expect(hostIdApproved({ isVerified: true, verification: { status: 'APPROVED', reviewedById: null } })).toBe(false)
    expect(hostIdApproved({ isVerified: true, verification: { status: 'APPROVED', reviewedById: '' } })).toBe(false)
    expect(hostIdApproved({ isVerified: true, verification: { status: 'PENDING', reviewedById: 'admin_1' } })).toBe(false)
    expect(hostIdApproved({ isVerified: true, verification: { status: 'REJECTED', reviewedById: 'admin_1' } })).toBe(false)
    expect(hostIdApproved({ isVerified: true, verification: { status: 'approved', reviewedById: 'admin_1' } })).toBe(false)
    expect(hostIdApproved(null)).toBe(false)
    expect(hostIdApproved(undefined)).toBe(false)
    // A truthy flag that is not exactly true (a string from somewhere) does not count
    expect(hostIdApproved({ ...approved, isVerified: 'true' as unknown as boolean })).toBe(false)
  })

  it('names where a host stands, for their pages and the admin page', () => {
    expect(hostIdState(approved)).toBe('APPROVED')
    expect(hostIdState({ isVerified: false, verification: { status: 'PENDING', reviewedById: null } })).toBe('IN_REVIEW')
    expect(hostIdState({ isVerified: false, verification: { status: 'REJECTED', reviewedById: 'admin_1' } })).toBe('REJECTED')
    expect(hostIdState({ isVerified: false, verification: null })).toBe('NONE')
    // The seed hosts: flagged, with no document at all
    expect(hostIdState({ isVerified: true, verification: null })).toBe('NONE')
    // Approved on paper with nobody recorded as approving: they must send it again
    expect(hostIdState({ isVerified: true, verification: { status: 'APPROVED', reviewedById: null } })).toBe('NONE')
    expect(hostIdState(null)).toBe('NONE')
  })

  it('has an error of its own, so a wait is never mistaken for a failure', () => {
    const error = new HostIdNotApprovedError('host_1')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('HostIdNotApprovedError')
    expect(error.message).toBe('Host host_1 has no approved ID: payout waits')
  })
})

// ─── The words ──────────────────────────────────────────────────────────────

describe('what hosts are told', () => {
  const all = [
    BECOME_A_HOST_ID.title, BECOME_A_HOST_ID.body, LISTING_ID_NOTICE, PAYOUTS_NEED_ID, WHO_NEEDS_ID, waitingForIdLine(270, 1),
    ...Object.values(HOST_ID_BANNER).flatMap((b) => [b.title, b.body, b.action ?? '']),
  ]

  it('uses the wording that was agreed', () => {
    expect(BECOME_A_HOST_ID.title).toBe('You need an approved ID before we can pay you')
    expect(BECOME_A_HOST_ID.body).toBe('You can list your home and take bookings straight away. We hold your payouts until we have checked your Ghana Card, Passport or Voter ID. It also earns the "Host ID checked" badge.')
    expect(LISTING_ID_NOTICE).toBe('Before you can be paid, we need to check your ID. You can publish now and send it later.')
    expect(HOST_ID_BANNER.NONE).toEqual({ title: 'We need to check your ID before we can pay you', body: 'Your bookings carry on as normal, and we hold your payouts until your ID is approved.', action: 'Send your ID' })
    expect(HOST_ID_BANNER.IN_REVIEW).toEqual({ title: 'We are checking your ID', body: 'This usually takes less than a day. We hold your payouts until it is approved.', action: null })
    expect(HOST_ID_BANNER.REJECTED).toEqual({ title: 'We could not approve the ID you sent', body: 'Please send a clear photo of the whole document. We hold your payouts until your ID is approved.', action: 'Send your ID again' })
    expect(waitingForIdLine(1234.5, 3)).toBe('$1,234.50 is waiting for you (3 payouts). It is sent once your ID is approved.')
    expect(waitingForIdLine(270, 1)).toBe('$270.00 is waiting for you (1 payout). It is sent once your ID is approved.')
    expect(PAYOUTS_NEED_ID).toBe('Payouts are held until the host\'s ID has been approved.')
    expect(WHO_NEEDS_ID).toBe('Guests do not need one. Hosts need one before they can be paid.')
  })

  it('never says "verified", and makes no promise about when money arrives', () => {
    for (const text of all) {
      expect(text).not.toMatch(/\bverified\b/i)
      expect(text).not.toMatch(/guarantee|promise|within \d+|immediately|instantly/i)
    }
  })

  it('is what the pages show: each takes its words from lib/hostId.ts', () => {
    expect(read('src/app/become-a-host/page.tsx')).toContain('BECOME_A_HOST_ID.title')
    expect(read('src/app/become-a-host/page.tsx')).not.toContain('It is not required to start hosting')
    expect(read('src/app/dashboard/host/page.tsx')).toContain('<HostIdNotice')
    expect(read('src/app/dashboard/host/page.tsx')).not.toContain('It is not required to host')
    expect(read('src/app/dashboard/host/payouts/page.tsx')).toContain('<HostIdNotice showWaiting')
    expect(read('src/app/dashboard/host/listings/new/page.tsx')).toContain('<HostIdNotice variant="listing"')
    for (const file of ['src/app/faq/page.tsx', 'src/app/how-it-works/page.tsx', 'src/app/terms/page.tsx']) expect(read(file), file).toContain('PAYOUTS_NEED_ID')
    expect(read('src/app/faq/page.tsx')).toContain('WHO_NEEDS_ID')
  })

  it('states the Terms as they are: ID before being paid, and rent paid out one payment at a time', () => {
    const terms = read('src/app/terms/page.tsx')
    expect(terms).toContain('FieGH requires hosts to have their ID (Ghana Card, Passport, or Voter ID) approved before they can be paid. It is not needed to make bookings or list properties.')
    expect(terms).not.toContain('before you can make bookings or list properties')
    expect(terms).toContain('Payouts for monthly and long-term rentals are made one rent payment at a time: the first 48 hours after move-in, and each later one once its rent has been paid and has fallen due.')
    expect(terms).not.toContain('are made by our team. A damage deposit')
  })
})

// ─── No way round the guard ─────────────────────────────────────────────────

describe('every way a payout can be sent', () => {
  it('only payouts.ts calls Paystack\'s transfer endpoint, and only cronRuns.ts calls initiateHostPayout', () => {
    const rel = (file: string) => path.relative(root, file)
    const all = sources()
    // The one place money leaves for a host. "/transferrecipient" (saving a payout method) is a different endpoint.
    const sends = all.filter((file) => /\/transfer(?![a-z])/i.test(fs.readFileSync(file, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')))
    expect(sends.map(rel)).toEqual(['src/lib/payouts.ts'])
    const callers = all.filter((file) => /\binitiateHostPayout\(/.test(fs.readFileSync(file, 'utf8')))
    expect(callers.map(rel).sort()).toEqual(['src/lib/cronRuns.ts', 'src/lib/payouts.ts'])
    // And the only things that run the job or the retry pass
    const runners = all.filter((file) => /\b(runPayouts|retryFailedPayouts)\(/.test(fs.readFileSync(file, 'utf8')))
    expect(runners.map(rel).sort()).toEqual(['src/app/api/cron/process-payouts/route.ts', 'src/lib/cronRuns.ts', 'src/lib/payouts.ts'])
  })

  it('checks the ID inside initiateHostPayout before a row is created, claimed or sent', () => {
    const source = read('src/lib/payouts.ts')
    const body = source.slice(source.indexOf('export async function initiateHostPayout'), source.indexOf('async function holdPayout'))
    const guard = body.indexOf('if (!hostIdApproved(host))')
    expect(guard).toBeGreaterThan(-1)
    expect(body.slice(guard, guard + 120)).toContain('throw new HostIdNotApprovedError(hostId)')
    for (const later of ['db.payout.findFirst', 'db.payout.create', 'db.payout.updateMany', 'holdPayout(', 'fetch(`${PAYSTACK_BASE}/transfer`']) {
      expect(body.indexOf(later), later).toBeGreaterThan(guard)
    }
    // There is one transfer call in the file, and it is inside that function
    expect(source.match(/\/transfer`/g)).toHaveLength(1)
  })

  it('has no switch that turns the rule off', () => {
    const rule = read('src/lib/hostId.ts')
    expect(rule).not.toContain('process.env')
    expect(read('.env.example')).not.toMatch(/HOST_ID|ID_REQUIRED/)
  })
})

// ─── The admin's decision ───────────────────────────────────────────────────

describe('approving and rejecting an ID', () => {
  const patch = (body: Row) => decide(new Request('http://x/api/verifications', { method: 'PATCH', body: JSON.stringify(body) }))
  const host = () => state.users.find((u) => u.id === 'host_1')!
  const doc = () => state.verifications[0]
  const facts = () => ({ isVerified: host().isVerified as boolean, verification: doc() as { status: string; reviewedById: string | null } })

  beforeEach(() => {
    state.users.length = 0
    state.verifications.length = 0
    state.uploads.length = 0
    notify.mockReset()
    state.users.push({ id: 'host_1', role: 'HOST', isVerified: false, trustScore: 10 })
    state.verifications.push({ id: 'ver_1', userId: 'host_1', status: 'PENDING', reviewedById: null, notes: null, idType: 'GHANA_CARD' })
    state.session = { id: 'admin_7', role: 'ADMIN', isVerified: false }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('makes the host payable, and records the admin signed in as the reviewer', async () => {
    expect(hostIdApproved(facts())).toBe(false)
    // An admin id in the request is ignored: the reviewer is whoever is signed in
    const res = await patch({ verificationId: 'ver_1', status: 'APPROVED', reviewedById: 'someone_else' })
    expect(res.status).toBe(200)
    expect(doc()).toMatchObject({ status: 'APPROVED', reviewedById: 'admin_7' })
    expect(host()).toMatchObject({ isVerified: true, trustScore: 50 })
    expect(hostIdApproved(facts())).toBe(true)
    expect(notify).toHaveBeenCalledWith('verification.decided', { verificationId: 'ver_1' })
  })

  it('is for admins only', async () => {
    state.session = { id: 'host_1', role: 'HOST', isVerified: false }
    expect((await patch({ verificationId: 'ver_1', status: 'APPROVED' })).status).toBe(403)
    state.session = null
    expect((await patch({ verificationId: 'ver_1', status: 'APPROVED' })).status).toBe(401)
    expect(doc().status).toBe('PENDING')
    expect(host().isVerified).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('approving twice adds the trust points once', async () => {
    expect((await patch({ verificationId: 'ver_1', status: 'APPROVED' })).status).toBe(200)
    const again = await patch({ verificationId: 'ver_1', status: 'APPROVED' })
    expect(again.status).toBe(409)
    expect(host().trustScore).toBe(50)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('cannot approve an ID that was rejected: the person sends it again first', async () => {
    await patch({ verificationId: 'ver_1', status: 'REJECTED' })
    expect((await patch({ verificationId: 'ver_1', status: 'APPROVED' })).status).toBe(409)
    expect(hostIdApproved(facts())).toBe(false)
  })

  it('rejecting an approved ID turns the badge off and holds payouts again', async () => {
    await patch({ verificationId: 'ver_1', status: 'APPROVED' })
    expect(hostIdApproved(facts())).toBe(true)

    const res = await patch({ verificationId: 'ver_1', status: 'REJECTED', notes: 'The name does not match the account.' })
    expect(res.status).toBe(200)
    expect(doc()).toMatchObject({ status: 'REJECTED', reviewedById: 'admin_7', notes: 'The name does not match the account.' })
    // The badge reads the flag: it is off, and the points it brought are gone
    expect(host()).toMatchObject({ isVerified: false, trustScore: 10 })
    expect(hostIdApproved(facts())).toBe(false)
    expect(hostIdState(facts())).toBe('REJECTED')
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('needs a note to remove an approval, and changes nothing without one', async () => {
    await patch({ verificationId: 'ver_1', status: 'APPROVED' })
    for (const notes of [undefined, '', '   ']) {
      const res = await patch({ verificationId: 'ver_1', status: 'REJECTED', notes })
      expect(res.status).toBe(400)
    }
    expect(doc().status).toBe('APPROVED')
    expect(host()).toMatchObject({ isVerified: true, trustScore: 50 })
  })

  it('rejects one waiting for review without a note, and takes no points that were never given', async () => {
    const res = await patch({ verificationId: 'ver_1', status: 'REJECTED' })
    expect(res.status).toBe(200)
    expect(doc()).toMatchObject({ status: 'REJECTED', reviewedById: 'admin_7', notes: null })
    expect(host()).toMatchObject({ isVerified: false, trustScore: 10 })
    expect((await patch({ verificationId: 'ver_1', status: 'REJECTED' })).status).toBe(409)
  })

  it('never takes the trust score below zero', async () => {
    await patch({ verificationId: 'ver_1', status: 'APPROVED' })
    host().trustScore = 25
    await patch({ verificationId: 'ver_1', status: 'REJECTED', notes: 'Sent in error.' })
    expect(host().trustScore).toBe(0)
  })

  it('refuses anything else', async () => {
    expect((await patch({ verificationId: 'ver_1', status: 'PENDING' })).status).toBe(400)
    expect((await patch({ status: 'APPROVED' })).status).toBe(400)
    expect((await patch({ verificationId: 'nope', status: 'APPROVED' })).status).toBe(404)
  })

  describe('sending an ID again', () => {
    const send = () => {
      const form = new FormData()
      form.set('idType', 'PASSPORT')
      form.set('idPhoto', new File([new Uint8Array([1, 2, 3])], 'id.jpg', { type: 'image/jpeg' }))
      return submit(new Request('http://x/api/verifications', { method: 'POST', body: form }))
    }

    it('is refused once the ID is really approved', async () => {
      await patch({ verificationId: 'ver_1', status: 'APPROVED' })
      state.session = { id: 'host_1', role: 'HOST', isVerified: true }
      expect((await send()).status).toBe(409)
      expect(state.uploads).toEqual([])
      expect(doc().status).toBe('APPROVED')
    })

    it('is allowed after a rejection, and the host waits for review again', async () => {
      await patch({ verificationId: 'ver_1', status: 'REJECTED' })
      state.session = { id: 'host_1', role: 'HOST', isVerified: false }
      expect((await send()).status).toBe(201)
      expect(doc()).toMatchObject({ status: 'PENDING', reviewedById: null, idType: 'PASSPORT' })
      expect(hostIdState(facts())).toBe('IN_REVIEW')
    })

    it('is allowed when a document says APPROVED but nobody is recorded as approving it', async () => {
      Object.assign(doc(), { status: 'APPROVED', reviewedById: null })
      host().isVerified = true
      state.session = { id: 'host_1', role: 'HOST', isVerified: true }
      expect(hostIdApproved(facts())).toBe(false)
      expect((await send()).status).toBe(201)
      expect(doc()).toMatchObject({ status: 'PENDING', reviewedById: null })
      expect(state.uploads).toEqual(['host_1/id-photo.jpg'])
    })
  })
})

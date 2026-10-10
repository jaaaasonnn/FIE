import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/roles'
import { markChecked, revokeCheck } from '@/lib/listingChecks'
import { CHECK_ITEMS, CHECK_METHODS, expiresSoon, liveCheck, markRefusal, photoList } from '@/lib/listingCheckRules'

/**
 * GET /api/admin/listing-checks
 * The queue: live listings whose address and photos have not been checked,
 * or whose check runs out within 30 days, soonest first. With each, what an
 * admin needs to do the check and the history of earlier ones. Also the
 * listings that have a check standing, so one can be removed.
 */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const now = new Date()
    const listings = await db.listing.findMany({
      where: { isActive: true, moderationHold: false },
      select: {
        id: true, title: true, region: true, city: true, neighbourhood: true, propertyType: true, bedrooms: true,
        digitalAddress: true, photos: true, isActive: true, moderationHold: true, createdAt: true,
        host: { select: { name: true } },
        checks: {
          orderBy: { checkedAt: 'desc' }, take: 5,
          select: {
            id: true, checkedAt: true, expiresAt: true, method: true, note: true, revokedAt: true, revokeReason: true, revokeNote: true,
            checkedBy: { select: { name: true } }, revokedBy: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    const rows = listings.map((l) => {
      const live = liveCheck(l.checks, now)
      const photos = photoList(l.photos)
      return {
        id: l.id, title: l.title, hostName: l.host.name, region: l.region, city: l.city, neighbourhood: l.neighbourhood,
        propertyType: l.propertyType, bedrooms: l.bedrooms, digitalAddress: l.digitalAddress, photoCount: photos.length,
        check: live ? { id: live.id, checkedAt: live.checkedAt, expiresAt: live.expiresAt, expiresSoon: expiresSoon(live, now) } : null,
        // Why it cannot be marked yet, before any checklist is filled in
        blocked: !l.digitalAddress || photos.length === 0 ? markRefusal(l, {}) : null,
        history: l.checks.map((c) => ({
          id: c.id, checkedAt: c.checkedAt, expiresAt: c.expiresAt, method: c.method, note: c.note, checkedBy: c.checkedBy.name,
          revokedAt: c.revokedAt, revokeReason: c.revokeReason, revokeNote: c.revokeNote, revokedBy: c.revokedBy?.name ?? null,
        })),
      }
    })

    const soonest = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      new Date(a.check?.expiresAt ?? 0).getTime() - new Date(b.check?.expiresAt ?? 0).getTime()
    return NextResponse.json({
      // Running out first, then never checked
      queue: [...rows.filter((r) => r.check?.expiresSoon).sort(soonest), ...rows.filter((r) => !r.check)],
      checked: rows.filter((r) => r.check && !r.check.expiresSoon).sort(soonest),
      items: CHECK_ITEMS,
      methods: CHECK_METHODS,
    })
  } catch (error) {
    console.error('Admin listing checks GET error:', error)
    return NextResponse.json({ error: 'Failed to load listing checks' }, { status: 500 })
  }
}

/**
 * POST /api/admin/listing-checks
 *   { action: 'mark', listingId, method, checks, note }   record a check
 *   { action: 'revoke', listingId, reason }               remove the standing check
 * Both are recorded with the admin who did them (lib/listingChecks.ts). The
 * admin is always the one signed in, never one named in the request.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const body = await req.json().catch(() => ({}))
    if (typeof body?.listingId !== 'string') return NextResponse.json({ error: 'listingId is required' }, { status: 400 })

    if (body.action === 'mark') {
      const result = await markChecked({ listingId: body.listingId, adminId: auth.user.id, input: { method: body.method, checks: body.checks, note: body.note } })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json({ checkId: result.checkId, expiresAt: result.expiresAt })
    }
    if (body.action === 'revoke') {
      const result = await revokeCheck({ listingId: body.listingId, adminId: auth.user.id, reason: body.reason })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json({ checkId: result.checkId })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Admin listing checks POST error:', error)
    return NextResponse.json({ error: 'The check could not be recorded' }, { status: 500 })
  }
}

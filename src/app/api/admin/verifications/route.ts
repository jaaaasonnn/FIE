import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/roles'
import { supabaseAdmin, VERIFICATION_DOCS_BUCKET } from '@/lib/supabase'
import { duePayouts } from '@/lib/cronRuns'
import { payoutGate } from '@/lib/payoutSwitches'
import { HOST_ID_SELECT, hostIdState } from '@/lib/hostId'

const SIGNED_URL_TTL_SECONDS = 10 * 60

/**
 * GET /api/admin/verifications — ADMIN only
 *
 * idPhotoUrl/selfieUrl are stored as private Storage paths (see
 * POST /api/verifications), not browsable URLs — sign a short-lived URL
 * per document here so the review UI can actually render them without the
 * bucket ever being public-read.
 */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const verifications = await db.verification.findMany({
      include: {
        user: {
          select: { id: true, name: true, profilePhoto: true, role: true, isVerified: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const signed = await Promise.all(
      verifications.map(async (v) => {
        const [idPhotoSigned, selfieSigned] = await Promise.all([
          supabaseAdmin.storage.from(VERIFICATION_DOCS_BUCKET).createSignedUrl(v.idPhotoUrl, SIGNED_URL_TTL_SECONDS),
          v.selfieUrl
            ? supabaseAdmin.storage.from(VERIFICATION_DOCS_BUCKET).createSignedUrl(v.selfieUrl, SIGNED_URL_TTL_SECONDS)
            : Promise.resolve(null),
        ])
        return {
          ...v,
          idPhotoUrl: idPhotoSigned.data?.signedUrl ?? null,
          selfieUrl: selfieSigned?.data?.signedUrl ?? null,
        }
      }),
    )

    return NextResponse.json({ verifications: signed, ...(await waitingOnHostId()) })
  } catch (error) {
    console.error('Admin verifications GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 })
  }
}

/**
 * Payouts that have fallen due and are not being sent because the host's ID
 * is not approved, added up per host. Reads only. Worked out by the same
 * query the payout job uses, so the two cannot disagree. While payouts are
 * switched off the job would not send these anyway; `payoutsLive` says so.
 */
async function waitingOnHostId() {
  const gate = payoutGate()
  const due = (await duePayouts(new Date(), gate.notBefore)).filter((p) => !p.hostIdApproved)
  const byHost = new Map<string, { count: number; amount: number }>()
  for (const p of due) {
    const sum = byHost.get(p.hostId) ?? { count: 0, amount: 0 }
    byHost.set(p.hostId, { count: sum.count + 1, amount: sum.amount + p.amount })
  }
  const hosts = byHost.size
    ? await db.user.findMany({ where: { id: { in: [...byHost.keys()] } }, select: { id: true, name: true, email: true, ...HOST_ID_SELECT } })
    : []
  return {
    payoutsLive: gate.live,
    waitingForId: hosts
      .map((h) => ({ hostId: h.id, name: h.name, email: h.email, idState: hostIdState(h), ...byHost.get(h.id)! }))
      .sort((a, b) => b.amount - a.amount),
  }
}

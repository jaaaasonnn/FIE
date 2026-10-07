// What a guest, a host or an admin is shown of a dispute. Server-only: it
// signs short-lived links to the evidence photos.

import type { Dispute, DisputeEvent, DisputeEvidence } from '@prisma/client'
import { supabaseAdmin, DISPUTE_EVIDENCE_BUCKET } from '@/lib/supabase'
import { EVIDENCE_LINK_SECONDS, disputeStatusText, outcomeLabel, reasonLabel } from '@/lib/disputes'

type Loaded = Dispute & {
  evidence: DisputeEvidence[]
  events: (DisputeEvent & { actor: { name: string | null; role: string } })[]
}

export type DisputeView = Awaited<ReturnType<typeof disputeView>>

/**
 * `forAdmin` adds the private admin notes. Everyone else gets the history
 * without them. The caller has already checked that the viewer is the guest,
 * the host or an admin.
 */
export async function disputeView(dispute: Loaded, booking: { guestId: string; hostId: string }, forAdmin: boolean) {
  const evidence = await Promise.all(
    dispute.evidence.map(async (e) => {
      const { data } = await supabaseAdmin.storage.from(DISPUTE_EVIDENCE_BUCKET).createSignedUrl(e.path, EVIDENCE_LINK_SECONDS)
      return {
        id: e.id,
        by: e.uploadedById === booking.guestId ? 'GUEST' : 'HOST',
        url: data?.signedUrl ?? null,
        createdAt: e.createdAt,
      }
    }),
  )
  return {
    id: dispute.id,
    bookingId: dispute.bookingId,
    raisedByRole: dispute.raisedByRole,
    reason: dispute.reason,
    reasonLabel: reasonLabel(dispute.raisedByRole, dispute.reason),
    description: dispute.description,
    response: dispute.response,
    respondedAt: dispute.respondedAt,
    status: dispute.status,
    statusText: disputeStatusText(dispute),
    outcome: dispute.outcome,
    outcomeLabel: dispute.outcome ? outcomeLabel(dispute.raisedByRole, dispute.outcome) : null,
    refundAmount: dispute.refundAmount,
    resolution: dispute.resolution,
    resolvedAt: dispute.resolvedAt,
    createdAt: dispute.createdAt,
    evidence,
    events: dispute.events
      .filter((e) => forAdmin || e.type !== 'ADMIN_NOTE')
      .map((e) => ({
        type: e.type,
        note: e.note,
        createdAt: e.createdAt,
        by: e.actor.role === 'ADMIN' ? 'FieGH' : e.actorId === booking.guestId ? 'Guest' : 'Host',
      })),
  }
}

export const disputeInclude = {
  evidence: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, role: true } } } },
} as const

/** A notification for each of these users. */
export function notifications(userIds: string[], type: string, title: string, body: string) {
  return [...new Set(userIds)].map((userId) => ({ userId, type, title, body }))
}

// "Address and photos checked" where it meets the database: recording a
// check, removing one, clearing it when an edit calls for it, and deciding
// what of a listing the public may see. The rules and the wording are in
// lib/listingCheckRules.ts.
//
// Nothing here moves money or sends anything. The host is told through
// notify (lib/messaging), which only logs until messaging is switched on.
//
// A ListingCheck row is written once and afterwards only ever has its revoke
// fields set, once. That makes the table the record of who checked what, who
// removed it and why.

import { Prisma, type Listing } from '@prisma/client'
import { db } from '@/lib/db'
import { notify } from '@/lib/messaging/notify'
import {
  CHECK_ITEM_KEYS, checkExpiry, liveCheck, liveCheckWhere, markRefusal, photoList, publicCheck,
  type CheckInput, type CheckRow, type PublicCheck, type RevokeReason,
} from '@/lib/listingCheckRules'

// ── What the public may see of a listing ───────────────────────────────────

/** Ask for this with a listing, and publicListing can say whether it has the badge. */
export function liveChecksInclude(now: Date = new Date()) {
  return { where: liveCheckWhere(now), orderBy: { checkedAt: 'desc' as const }, take: 1, select: { checkedAt: true, expiresAt: true, revokedAt: true } }
}

type WithChecks = Listing & { checks?: CheckRow[] }

/**
 * A listing as anyone may see it. The fields are named one by one, so a new
 * column on Listing is private until it is added here on purpose. The digital
 * address is never among them: the public learn only whether there is one.
 * A check is reduced to its two dates; the admin's note, the checklist and
 * who checked never leave the server.
 */
export function publicListing<T extends WithChecks>(listing: T, now: Date = new Date()) {
  const {
    id, hostId, title, description, propertyType, region, city, neighbourhood, lat, lng, bedrooms, bathrooms,
    maxGuests, amenities, rentalModes, priceNightly, priceMonthly, priceAnnual, advanceMonthsRequired, photos, rules,
    cancellationPolicy, instantBook, minStayNights, isActive, moderationHold, isFeatured, avgRating, reviewCount,
    welcomeMessage, damageDeposit, createdAt, updatedAt,
  } = listing
  return {
    id, hostId, title, description, propertyType, region, city, neighbourhood, lat, lng, bedrooms, bathrooms,
    maxGuests, amenities, rentalModes, priceNightly, priceMonthly, priceAnnual, advanceMonthsRequired, photos, rules,
    cancellationPolicy, instantBook, minStayNights, isActive, moderationHold, isFeatured, avgRating, reviewCount,
    welcomeMessage, damageDeposit, createdAt, updatedAt,
    hasDigitalAddress: !!listing.digitalAddress,
    check: publicCheck(liveCheck(listing.checks, now)) as PublicCheck | null,
  }
}

// ── Recording a check ──────────────────────────────────────────────────────

export type MarkResult =
  | { ok: false; status: number; error: string }
  | { ok: true; checkId: string; expiresAt: Date }

/**
 * Records that an admin has checked a listing's address and photos. Refused
 * unless the listing is live, has a digital address and photos, and every
 * item on the checklist, a method and a note are given. Any check already
 * standing is closed as REPLACED in the same transaction, so a listing never
 * has two.
 */
export async function markChecked({
  listingId, adminId, input, now = new Date(),
}: {
  listingId: string
  adminId: string
  input: CheckInput
  now?: Date
}): Promise<MarkResult> {
  const listing = await db.listing.findUnique({ where: { id: listingId } })
  if (!listing) return { ok: false, status: 404, error: 'Listing not found' }
  const refusal = markRefusal(listing, input)
  if (refusal) return { ok: false, status: 400, error: refusal }

  const expiresAt = checkExpiry(now)
  try {
    // Serializable: of two admins (or two clicks) at the same moment, one is aborted
    const check = await db.$transaction(async (tx) => {
      // The listing must still be exactly what was read and judged above
      const current = await tx.listing.findUnique({ where: { id: listingId }, select: { digitalAddress: true, photos: true, isActive: true, moderationHold: true } })
      if (!current || current.digitalAddress !== listing.digitalAddress || current.photos !== listing.photos || !current.isActive || current.moderationHold) {
        throw new Changed()
      }
      await tx.listingCheck.updateMany({
        where: { listingId, revokedAt: null },
        data: { revokedAt: now, revokedById: adminId, revokeReason: 'REPLACED' },
      })
      return tx.listingCheck.create({
        data: {
          listingId, checkedById: adminId, checkedAt: now, expiresAt,
          method: input.method as string,
          checks: JSON.stringify(CHECK_ITEM_KEYS),
          note: (input.note as string).trim(),
          // What was checked, kept as it was: the listing can change afterwards
          digitalAddress: listing.digitalAddress!,
          photos: JSON.stringify(photoList(listing.photos)),
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    console.info('[Listing checks] checked', { listingId, checkId: check.id, adminId })
    notify('listing.checked', { checkId: check.id })
    return { ok: true, checkId: check.id, expiresAt }
  } catch (error) {
    if (error instanceof Changed || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) {
      return { ok: false, status: 409, error: 'This listing changed a moment ago. Nothing was recorded. Please look at it again.' }
    }
    throw error
  }
}

class Changed extends Error {}

// ── Removing a check ───────────────────────────────────────────────────────

export const MAX_REVOKE_NOTE = 500

export type RevokeResult = { ok: false; status: number; error: string } | { ok: true; checkId: string }

/** An admin removes a listing's check, with the reason. The reason is shown to the host. */
export async function revokeCheck({
  listingId, adminId, reason, now = new Date(),
}: {
  listingId: string
  adminId: string
  reason: unknown
  now?: Date
}): Promise<RevokeResult> {
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (!why) return { ok: false, status: 400, error: 'Give the reason for removing the check. The host will see it.' }
  if (why.length > MAX_REVOKE_NOTE) return { ok: false, status: 400, error: `The reason can be at most ${MAX_REVOKE_NOTE} characters.` }

  const live = await db.listingCheck.findFirst({ where: { listingId, ...liveCheckWhere(now) }, orderBy: { checkedAt: 'desc' }, select: { id: true } })
  if (!live) return { ok: false, status: 409, error: 'This listing has no check to remove.' }
  // Part of the where: a second click changes nothing
  const done = await db.listingCheck.updateMany({
    where: { id: live.id, revokedAt: null },
    data: { revokedAt: now, revokedById: adminId, revokeReason: 'ADMIN', revokeNote: why },
  })
  if (done.count === 0) return { ok: false, status: 409, error: 'This check was removed a moment ago.' }
  console.info('[Listing checks] removed', { listingId, checkId: live.id, adminId })
  notify('listing.check_removed', { checkId: live.id })
  return { ok: true, checkId: live.id }
}

type Tx = Pick<Prisma.TransactionClient, 'listingCheck'>

/**
 * Closes every check on a listing that has not been revoked, because an edit
 * (or a hold) means what was checked is no longer what the listing shows.
 * Call it inside the same transaction as the edit. Returns the ids of the
 * checks that were still standing, so the host can be told once the edit has
 * committed (tellCleared).
 */
export async function clearChecks(tx: Tx, listingId: string, reason: RevokeReason, now: Date = new Date()): Promise<string[]> {
  const open = await tx.listingCheck.findMany({ where: { listingId, revokedAt: null }, select: { id: true, expiresAt: true } })
  if (open.length === 0) return []
  await tx.listingCheck.updateMany({
    where: { id: { in: open.map((c) => c.id) }, revokedAt: null },
    data: { revokedAt: now, revokedById: null, revokeReason: reason },
  })
  // Only one that had not already run out is news to the host
  return open.filter((c) => c.expiresAt.getTime() > now.getTime()).map((c) => c.id)
}

/** Tells the host their check was removed. Call after the edit has committed. */
export function tellCleared(checkIds: string[]): void {
  for (const checkId of checkIds) notify('listing.check_removed', { checkId })
}

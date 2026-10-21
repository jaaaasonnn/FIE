import { jsonObject, unreadableBody } from '@/lib/validate'
import { NextResponse } from 'next/server'
import { isPolicy } from '@/lib/cancellationPolicy'
import { db } from '@/lib/db'
import { parseListingDetails, parseListingMoney } from '@/lib/listingInput'
import { listingVisible } from '@/lib/privacy'
import { requireHost } from '@/lib/roles'
import { hasContactDetails } from '@/lib/moderation'
import { notify } from '@/lib/messaging/notify'
import { parseAdvanceMonths } from '@/lib/rentRules'
import { getSessionUser } from '@/lib/session'
import { parseDigitalAddress } from '@/lib/digitalAddress'
import { editRevokes } from '@/lib/listingCheckRules'
import { clearChecks, liveChecksInclude, publicListing, tellCleared } from '@/lib/listingChecks'
import { refreshHomePage } from '@/lib/homePage'

// Fields a host (or admin) may change via this route. Anything else in the
// request body — hostId, id, avgRating, reviewCount, isFeatured, etc. — is
// silently ignored rather than being spread straight into the Prisma
// update. photos is deliberately excluded: it's managed exclusively via
// /api/listings/[id]/photos now, which handles Storage cleanup that a
// plain field overwrite here would bypass. isActive is handled on its own
// below, and moderationHold can never be set through this route.
// A listing is managed by the host who owns it, or by an admin (moderation)
async function requireOwnedListing(id: string) {
  const auth = await requireHost({ allowAdmin: true })
  if (auth.error) return { error: auth.error }
  const user = auth.user

  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) return { error: NextResponse.json({ error: 'Listing not found' }, { status: 404 }) }

  if (listing.hostId !== user.id && user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'You can only manage your own listings' }, { status: 403 }) }
  }
  return { listing, user }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const now = new Date()
    // Who is asking is looked up at the same time: this route is public, and
    // the answer only decides what else may be shown (one round trip less)
    const [listing, viewer] = await Promise.all([db.listing.findUnique({
      where: { id },
      include: {
        host: {
          select: { id: true, name: true, profilePhoto: true, isVerified: true, isSuperhost: true, trustScore: true, createdAt: true, suspendedAt: true }
        },
        reviews: {
          // Reviews carry the booking's listingId regardless of direction,
          // so a host's HOST_TO_GUEST review of their guest is tagged with
          // this same listingId — without this filter it would show up
          // here as if it were a review of the listing/host. isPublished
          // also matters: a review sits unpublished until both sides of
          // the booking have reviewed (or the 14-day auto-publish window
          // passes), and this relation had no such guard.
          where: { type: 'GUEST_TO_HOST', isPublished: true },
          include: {
            reviewer: { select: { id: true, name: true, profilePhoto: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        blockedDates: { select: { date: true } },
        checks: liveChecksInclude(now),
      }
    }), getSessionUser()])

    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

    // Only the fields the public may see (lib/listingChecks.ts). The host of
    // the listing, and an admin, also get the digital address, to edit it.
    const ownerView = !!viewer && (viewer.id === listing.hostId || viewer.role === 'ADMIN')

    // A listing that is switched off or on hold is not public: only its host,
    // an admin, or a guest who has booked it can open it by its link
    // Read to decide who may see the listing, and never sent to anyone
    const { suspendedAt, ...host } = listing.host
    const hostSuspended = !!suspendedAt
    if (!listing.isActive || listing.moderationHold || hostSuspended) {
      const hasBooking = !!viewer && !ownerView
        && !!(await db.booking.findFirst({ where: { listingId: id, guestId: viewer.id }, select: { id: true } }))
      if (!listingVisible({ ...listing, hostSuspended }, viewer, hasBooking)) {
        return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
      }
    }

    return NextResponse.json({
      listing: {
        ...publicListing(listing, now),
        host,
        reviews: listing.reviews,
        ...(ownerView ? { digitalAddress: listing.digitalAddress } : {}),
        amenities: JSON.parse(listing.amenities || '[]'),
        rentalModes: JSON.parse(listing.rentalModes || '[]'),
        photos: JSON.parse(listing.photos || '[]'),
        rules: listing.rules ? JSON.parse(listing.rules) : [],
        blockedDates: listing.blockedDates.map((d: { date: Date }) => d.date)
      }
    })
  } catch (error) {
    console.error('Listing GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch listing' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error, listing, user } = await requireOwnedListing(id)
    if (error) return error

    const body = await jsonObject(req)
    if (!body) return unreadableBody()
    const isAdmin = user.role === 'ADMIN'

    const data: Record<string, unknown> = {}
    if (body.cancellationPolicy !== undefined && !isPolicy(body.cancellationPolicy)) {
      return NextResponse.json({ error: 'Choose a cancellation policy: Flexible, Moderate or Strict' }, { status: 400 })
    }
    // Every word and number a host types: the right type, a sensible size,
    // and no line breaks in the title (lib/listingInput.ts). Only these
    // fields can be edited here; anything else in the request is ignored.
    const details = parseListingDetails(body, { creating: false })
    if (!details.ok) return NextResponse.json({ error: details.error }, { status: 400 })
    Object.assign(data, details.value)
    if (body.cancellationPolicy !== undefined) data.cancellationPolicy = body.cancellationPolicy
    // Prices and the deposit: real amounts, never negative (lib/listingInput.ts).
    // An admin's edit is held to the same rule.
    const money = parseListingMoney(body)
    if (!money.ok) return NextResponse.json({ error: money.error }, { status: 400 })
    Object.assign(data, money.value)
    // The advance a long-term tenant pays: 1 to 6 months, or nothing for the default
    if (body.advanceMonthsRequired !== undefined) {
      const advance = parseAdvanceMonths(body.advanceMonthsRequired)
      if (!advance.ok) return NextResponse.json({ error: advance.error }, { status: 400 })
      data.advanceMonthsRequired = advance.value
    }

    // The Ghana Post digital address is optional; if given it must be one
    if (body.digitalAddress !== undefined) {
      const address = parseDigitalAddress(body.digitalAddress)
      if (!address.ok) return NextResponse.json({ error: address.error }, { status: 400 })
      data.digitalAddress = address.value
    }

    // A host's new description gets the same contact-details check as at
    // creation. Failing it puts the listing on hold, exactly as creation does.
    const flagged = !isAdmin && typeof data.description === 'string' && hasContactDetails(data.description)
    const held = listing.moderationHold || flagged
    if (flagged) {
      data.moderationHold = true
      data.isActive = false
    }

    // Publishing and pausing stay with the host, except that a held listing
    // can never be switched on here, by anyone: an admin clears the hold from
    // the admin panel, which is the only place moderationHold is ever unset.
    if (typeof body.isActive === 'boolean') {
      if (held) data.isActive = false
      else data.isActive = body.isActive
    }

    // "Address and photos checked" stands only while the listing is what was
    // checked. An edit that changes where or what the home is said to be, or
    // a hold, removes it in the same transaction as the edit, whoever makes it.
    const revokes = flagged ? 'LISTING_HELD' : editRevokes(listing, data)
    const [updated, cleared] = await db.$transaction(async (tx) => [
      await tx.listing.update({ where: { id }, data }),
      revokes ? await clearChecks(tx, id, revokes) : [],
    ] as const)
    tellCleared(cleared)
    refreshHomePage()
    // Only when this edit is what put it on hold, not on every edit of a held listing
    if (flagged && !listing.moderationHold) notify('listing.auto_held', { listingId: id })

    return NextResponse.json({ listing: updated, flagged, held, checkRemoved: cleared.length > 0 })
  } catch (error) {
    console.error('Listing PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update listing' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error } = await requireOwnedListing(id)
    if (error) return error

    await db.listing.update({ where: { id }, data: { isActive: false } })
    refreshHomePage()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Listing DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete listing' }, { status: 500 })
  }
}

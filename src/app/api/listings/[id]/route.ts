import { NextResponse } from 'next/server'
import { isPolicy } from '@/lib/cancellationPolicy'
import { db } from '@/lib/db'
import { requireHost } from '@/lib/roles'
import { hasContactDetails } from '@/lib/moderation'

// Fields a host (or admin) may change via this route. Anything else in the
// request body — hostId, id, avgRating, reviewCount, isFeatured, etc. — is
// silently ignored rather than being spread straight into the Prisma
// update. photos is deliberately excluded: it's managed exclusively via
// /api/listings/[id]/photos now, which handles Storage cleanup that a
// plain field overwrite here would bypass. isActive is handled on its own
// below, and moderationHold can never be set through this route.
const EDITABLE_FIELDS = [
  'title', 'description', 'propertyType', 'region', 'city', 'neighbourhood',
  'lat', 'lng', 'bedrooms', 'bathrooms', 'maxGuests', 'rentalModes',
  'priceNightly', 'priceMonthly', 'priceAnnual', 'advanceMonthsRequired',
  'amenities', 'rules', 'cancellationPolicy', 'instantBook',
  'minStayNights', 'damageDeposit', 'welcomeMessage',
] as const
const JSON_ARRAY_FIELDS = new Set(['rentalModes', 'amenities', 'rules'])

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
    const listing = await db.listing.findUnique({
      where: { id },
      include: {
        host: {
          select: { id: true, name: true, profilePhoto: true, isVerified: true, isSuperhost: true, trustScore: true, createdAt: true }
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
        blockedDates: { select: { date: true } }
      }
    })

    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

    return NextResponse.json({
      listing: {
        ...listing,
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

    const body = await req.json()
    const isAdmin = user.role === 'ADMIN'

    const data: Record<string, unknown> = {}
    if (body.cancellationPolicy !== undefined && !isPolicy(body.cancellationPolicy)) {
      return NextResponse.json({ error: 'Choose a cancellation policy: Flexible, Moderate or Strict' }, { status: 400 })
    }
    for (const field of EDITABLE_FIELDS) {
      if (body[field] === undefined) continue
      data[field] = JSON_ARRAY_FIELDS.has(field) ? JSON.stringify(body[field]) : body[field]
    }

    // A host's new description gets the same contact-details check as at
    // creation. Failing it puts the listing on hold, exactly as creation does.
    const flagged = !isAdmin && typeof body.description === 'string' && hasContactDetails(body.description)
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

    const updated = await db.listing.update({ where: { id }, data })

    return NextResponse.json({ listing: updated, flagged, held })
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
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Listing DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete listing' }, { status: 500 })
  }
}

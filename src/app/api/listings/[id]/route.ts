import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

// Fields a host (or admin) may change via this route. Anything else in the
// request body — hostId, id, avgRating, reviewCount, isFeatured, etc. — is
// silently ignored rather than being spread straight into the Prisma
// update. photos is deliberately excluded: it's managed exclusively via
// /api/listings/[id]/photos now, which handles Storage cleanup that a
// plain field overwrite here would bypass.
const EDITABLE_FIELDS = [
  'title', 'description', 'propertyType', 'region', 'city', 'neighbourhood',
  'lat', 'lng', 'bedrooms', 'bathrooms', 'maxGuests', 'rentalModes',
  'priceNightly', 'priceMonthly', 'priceAnnual', 'advanceMonthsRequired',
  'amenities', 'rules', 'cancellationPolicy', 'instantBook',
  'minStayNights', 'damageDeposit', 'welcomeMessage', 'isActive',
] as const
const JSON_ARRAY_FIELDS = new Set(['rentalModes', 'amenities', 'rules'])

async function requireOwnedListing(id: string) {
  const user = await getSessionUser()
  if (!user) return { error: NextResponse.json({ error: 'You must be signed in' }, { status: 401 }) }

  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) return { error: NextResponse.json({ error: 'Listing not found' }, { status: 404 }) }

  if (listing.hostId !== user.id && user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'You can only manage your own listings' }, { status: 403 }) }
  }
  return { listing }
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
    const { error } = await requireOwnedListing(id)
    if (error) return error

    const body = await req.json()

    const data: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (body[field] === undefined) continue
      data[field] = JSON_ARRAY_FIELDS.has(field) ? JSON.stringify(body[field]) : body[field]
    }

    const updated = await db.listing.update({ where: { id }, data })

    return NextResponse.json({ listing: updated })
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

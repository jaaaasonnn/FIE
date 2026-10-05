import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { hasContactDetails } from '@/lib/moderation'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const mode = searchParams.get('mode')
    const region = searchParams.get('region')
    const city = searchParams.get('city')
    const minPrice = searchParams.get('minPrice')
    const maxPrice = searchParams.get('maxPrice')
    const bedrooms = searchParams.get('bedrooms')
    const propertyType = searchParams.get('propertyType')
    const verified = searchParams.get('verified') === 'true'
    const superhost = searchParams.get('superhost') === 'true'
    const featured = searchParams.get('featured') === 'true'
    const hostId = searchParams.get('hostId')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const where: Record<string, unknown> = { isActive: true }

    // Host dashboard: filter by owner and include inactive listings
    if (hostId) {
      where.hostId = hostId
      delete where.isActive
    }

    if (region) where.region = region
    if (city) where.city = { contains: city }
    if (propertyType) where.propertyType = propertyType
    if (bedrooms) where.bedrooms = { gte: parseInt(bedrooms) }
    if (featured) where.isFeatured = true
    if (mode) where.rentalModes = { contains: mode }

    if (verified) where.host = { isVerified: true }
    if (superhost) where.host = { ...(where.host as object || {}), isSuperhost: true }

    const [listings, total] = await Promise.all([
      db.listing.findMany({
        where,
        include: {
          host: {
            select: { id: true, name: true, profilePhoto: true, isVerified: true, isSuperhost: true, trustScore: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      db.listing.count({ where }),
    ])

    const parsed = listings.map((l) => ({
      ...l,
      amenities: JSON.parse(l.amenities || '[]'),
      rentalModes: JSON.parse(l.rentalModes || '[]'),
      photos: JSON.parse(l.photos || '[]'),
      rules: l.rules ? JSON.parse(l.rules) : []
    }))

    return NextResponse.json({ listings: parsed, total, page, pages: Math.ceil(total / limit) })
  } catch (error) {
    console.error('Listings GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  console.log('[POST /api/listings] request received')

  try {
    const user = await getSessionUser()
    if (!user) {
      console.log('[POST /api/listings] rejected — no session')
      return NextResponse.json({ error: 'You must be signed in to create a listing' }, { status: 401 })
    }

    // Only hosts can list. Guests become hosts through /become-a-host, which
    // explains what hosting involves first.
    if (user.role !== 'HOST') {
      return NextResponse.json({ error: 'Only hosts can create listings' }, { status: 403 })
    }

    const body = await req.json()
    const {
      title, description, propertyType, region, city, neighbourhood,
      lat, lng, bedrooms, bathrooms, maxGuests, rentalModes, priceNightly,
      priceMonthly, priceAnnual, advanceMonthsRequired, amenities, rules,
      cancellationPolicy, instantBook, minStayNights, damageDeposit, welcomeMessage,
      isActive: requestedIsActive,
    } = body

    // Always use the authenticated user as host — never trust client hostId
    const hostId = user.id

    if (!title?.trim() || !region || !city?.trim() || !propertyType || bedrooms == null || bedrooms === '') {
      console.log('[POST /api/listings] rejected — missing required fields', {
        hostId,
        hasTitle: !!title?.trim(),
        hasRegion: !!region,
        hasCity: !!city?.trim(),
        hasPropertyType: !!propertyType,
        bedrooms,
      })
      return NextResponse.json(
        { error: 'Missing required fields: title, property type, region, city, and bedrooms are required' },
        { status: 400 },
      )
    }

    const beds = parseInt(String(bedrooms), 10)
    const baths = parseInt(String(bathrooms ?? 1), 10)
    const guests = parseInt(String(maxGuests ?? 2), 10)
    if (Number.isNaN(beds) || beds < 1) {
      return NextResponse.json({ error: 'Bedrooms must be a valid number' }, { status: 400 })
    }

    // Auto-flag listings with contact details in description
    const isFlagged = hasContactDetails(description)

    console.log('[POST /api/listings] creating listing for host', hostId, { title, region, city, propertyType })

    const listing = await db.listing.create({
      data: {
        hostId,
        title: title.trim(),
        description: description || '',
        propertyType,
        region,
        city: city.trim(),
        neighbourhood: neighbourhood || null,
        lat: lat ?? null,
        lng: lng ?? null,
        bedrooms: beds,
        bathrooms: Number.isNaN(baths) ? 1 : baths,
        maxGuests: Number.isNaN(guests) ? 2 : guests,
        rentalModes: JSON.stringify(rentalModes || []),
        priceNightly: priceNightly ? parseFloat(String(priceNightly)) : null,
        priceMonthly: priceMonthly ? parseFloat(String(priceMonthly)) : null,
        priceAnnual: priceAnnual ? parseFloat(String(priceAnnual)) : null,
        advanceMonthsRequired: advanceMonthsRequired ? parseInt(String(advanceMonthsRequired), 10) : null,
        amenities: JSON.stringify(amenities || []),
        rules: JSON.stringify(rules || []),
        photos: JSON.stringify([]),
        cancellationPolicy: cancellationPolicy || 'FLEXIBLE',
        instantBook: !!instantBook,
        minStayNights: minStayNights ? parseInt(String(minStayNights), 10) : 1,
        damageDeposit: damageDeposit ? parseFloat(String(damageDeposit)) : null,
        welcomeMessage: welcomeMessage || null,
        // A client can request staying inactive (used by the "new listing"
        // wizard, which creates the record as a draft before its Photos
        // step) but can never force itself active — the content-flag check
        // still applies either way.
        isActive: requestedIsActive === false ? false : !isFlagged,
        // A flagged listing is held, so publishing it later cannot switch it on
        moderationHold: isFlagged,
      },
    })

    console.log('[POST /api/listings] created', listing.id, isFlagged ? '(flagged inactive)' : '')
    return NextResponse.json({ listing, flagged: isFlagged }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/listings] error:', error)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}

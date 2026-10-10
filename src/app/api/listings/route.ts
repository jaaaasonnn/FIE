import { NextResponse } from 'next/server'
import { asPolicy } from '@/lib/cancellationPolicy'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { requireHost, requireVerifiedEmail } from '@/lib/roles'
import { hasContactDetails } from '@/lib/moderation'
import { notify } from '@/lib/messaging/notify'
import { parseAdvanceMonths } from '@/lib/rentRules'
import { parseSearchRange, availabilityWhere } from '@/lib/searchDates'
import { parseDigitalAddress } from '@/lib/digitalAddress'
import { liveCheckWhere } from '@/lib/listingCheckRules'
import { liveChecksInclude, publicListing } from '@/lib/listingChecks'

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
    // Hosts whose ID FieGH has checked. ("verified" is the older name for the same filter.)
    const hostIdChecked = searchParams.get('hostIdChecked') === 'true' || searchParams.get('verified') === 'true'
    // Listings whose address and photos FieGH has checked, and the check still stands
    const checked = searchParams.get('checked') === 'true'
    const superhost = searchParams.get('superhost') === 'true'
    const featured = searchParams.get('featured') === 'true'
    const hostId = searchParams.get('hostId')
    const checkIn = searchParams.get('checkIn')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const where: Record<string, unknown> = { isActive: true }

    // A host's own listings. The host themselves (and an admin) see all of
    // them, including ones switched off or on moderation hold. Anyone else,
    // signed in or not, gets only what is public.
    let ownerView = false
    if (hostId) {
      where.hostId = hostId
      const viewer = await getSessionUser()
      ownerView = !!viewer && ((viewer.id === hostId && viewer.role === 'HOST') || viewer.role === 'ADMIN')
      if (ownerView) delete where.isActive
    }

    if (region) where.region = region
    if (city) where.city = { contains: city }
    if (propertyType) where.propertyType = propertyType
    if (bedrooms) where.bedrooms = { gte: parseInt(bedrooms) }
    if (featured) where.isFeatured = true
    if (mode) where.rentalModes = { contains: mode }

    // Search results never include a listing on moderation hold, even if a
    // stale row were somehow still marked active
    if (!ownerView) where.moderationHold = false

    // Dates: leave out listings taken on any night of the stay. Done here in
    // the query, so the count and paging describe what the guest can book.
    if (checkIn) {
      const range = parseSearchRange({
        checkIn,
        checkOut: searchParams.get('checkOut'),
        months: searchParams.get('months'),
        mode,
      })
      if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })
      where.AND = availabilityWhere(range)
      // A short stay shorter than the listing's minimum cannot be booked
      if (mode === 'SHORT_STAY') where.minStayNights = { lte: range.nights }
    }

    if (hostIdChecked) where.host = { isVerified: true }
    // Decided here, from the dates, at the moment of the search: a check that
    // expired a second ago is already left out
    const now = new Date()
    if (checked) where.checks = { some: liveCheckWhere(now) }
    if (superhost) where.host = { ...(where.host as object || {}), isSuperhost: true }

    const [listings, total] = await Promise.all([
      db.listing.findMany({
        where,
        include: {
          host: {
            select: { id: true, name: true, profilePhoto: true, isVerified: true, isSuperhost: true, trustScore: true }
          },
          checks: liveChecksInclude(now),
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      db.listing.count({ where }),
    ])

    // Only the fields the public may see (lib/listingChecks.ts). The host
    // looking at their own listings, or an admin, also gets the digital address.
    const parsed = listings.map((l) => ({
      ...publicListing(l, now),
      host: l.host,
      ...(ownerView ? { digitalAddress: l.digitalAddress } : {}),
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
    // Only hosts can list. Guests become hosts through /become-a-host, which
    // explains what hosting involves first.
    const auth = await requireHost()
    if (auth.error) return auth.error
    const user = auth.user
    // Listing a home needs a confirmed email address, once that rule is switched on
    const unverified = requireVerifiedEmail(user)
    if (unverified) return unverified

    const body = await req.json()
    const {
      title, description, propertyType, region, city, neighbourhood,
      lat, lng, bedrooms, bathrooms, maxGuests, rentalModes, priceNightly,
      priceMonthly, priceAnnual, advanceMonthsRequired, amenities, rules, digitalAddress,
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

    // The advance a long-term tenant pays: 1 to 6 months, or nothing for the default
    const advance = parseAdvanceMonths(advanceMonthsRequired)
    if (!advance.ok) return NextResponse.json({ error: advance.error }, { status: 400 })

    // The Ghana Post digital address is optional; if given it must be one
    const address = parseDigitalAddress(digitalAddress)
    if (!address.ok) return NextResponse.json({ error: address.error }, { status: 400 })

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
        digitalAddress: address.value,
        lat: lat ?? null,
        lng: lng ?? null,
        bedrooms: beds,
        bathrooms: Number.isNaN(baths) ? 1 : baths,
        maxGuests: Number.isNaN(guests) ? 2 : guests,
        rentalModes: JSON.stringify(rentalModes || []),
        priceNightly: priceNightly ? parseFloat(String(priceNightly)) : null,
        priceMonthly: priceMonthly ? parseFloat(String(priceMonthly)) : null,
        priceAnnual: priceAnnual ? parseFloat(String(priceAnnual)) : null,
        advanceMonthsRequired: advance.value,
        amenities: JSON.stringify(amenities || []),
        rules: JSON.stringify(rules || []),
        photos: JSON.stringify([]),
        cancellationPolicy: asPolicy(cancellationPolicy),
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
    if (isFlagged) notify('listing.auto_held', { listingId: listing.id })
    return NextResponse.json({ listing, flagged: isFlagged }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/listings] error:', error)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}

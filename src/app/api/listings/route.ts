import { NextResponse } from 'next/server'
import { asPolicy } from '@/lib/cancellationPolicy'
import { db } from '@/lib/db'
import { parseListingDetails, parseListingMoney } from '@/lib/listingInput'
import { MAX_PAGE_SIZE, clampWhole, jsonObject, unreadableBody, hasNullByte, unreadableQuery, wholeFromQuery } from '@/lib/validate'
import { getSessionUser } from '@/lib/session'
import { requireHost, requireVerifiedEmail } from '@/lib/roles'
import { hasContactDetails } from '@/lib/moderation'
import { notify } from '@/lib/messaging/notify'
import { parseAdvanceMonths } from '@/lib/rentRules'
import { parseSearchRange, availabilityWhere } from '@/lib/searchDates'
import { parseDigitalAddress } from '@/lib/digitalAddress'
import { liveCheckWhere } from '@/lib/listingCheckRules'
import { liveChecksInclude, publicListing } from '@/lib/listingChecks'
import { HOST_NOT_SUSPENDED } from '@/lib/suspension'
import { MAX_SEARCH_TEXT } from '@/lib/searchDates'
import { refreshHomePage } from '@/lib/homePage'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    if (hasNullByte(searchParams)) return unreadableQuery()
    const mode = searchParams.get('mode')
    const region = searchParams.get('region')
    const city = searchParams.get('city')
    // The search box's words (G2): matched here against every live home, not
    // in the browser against the first page of results
    const text = (searchParams.get('q') ?? '').trim().slice(0, MAX_SEARCH_TEXT)
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
    // A page of at most 50: nobody can ask for the whole table in one request
    const page = clampWhole(searchParams.get('page'), 1, 1, 10_000)
    const limit = clampWhole(searchParams.get('limit'), 20, 1, MAX_PAGE_SIZE)

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
    if (city) where.city = { contains: city, mode: 'insensitive' }
    if (text) {
      where.OR = (['city', 'neighbourhood', 'region', 'title'] as const).map((field) => ({ [field]: { contains: text, mode: 'insensitive' } }))
    }
    if (propertyType) where.propertyType = propertyType
    if (bedrooms) {
      // A whole number of rooms, or the filter is refused: "abc" would reach the database as not-a-number
      const atLeast = wholeFromQuery(bedrooms, 0, 100)
      if (atLeast === null) return NextResponse.json({ error: 'bedrooms must be a whole number' }, { status: 400 })
      where.bedrooms = { gte: atLeast }
    }
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

    // Nor a home whose host is suspended (lib/suspension.ts)
    if (!ownerView) where.host = { ...HOST_NOT_SUSPENDED }
    if (hostIdChecked) where.host = { ...(where.host as object || {}), isVerified: true }
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

    const body = await jsonObject(req)
    if (!body) return unreadableBody()
    const { title, propertyType, region, city, bedrooms, advanceMonthsRequired, digitalAddress, cancellationPolicy, isActive: requestedIsActive } = body

    // Always use the authenticated user as host — never trust client hostId
    const hostId = user.id

    const filled = (v: unknown) => (typeof v === 'string' ? !!v.trim() : v !== null && v !== undefined)
    if (!filled(title) || !filled(region) || !filled(city) || !filled(propertyType) || !filled(bedrooms)) {
      console.log('[POST /api/listings] rejected — missing required fields', { hostId })
      return NextResponse.json(
        { error: 'Missing required fields: title, property type, region, city, and bedrooms are required' },
        { status: 400 },
      )
    }
    // Every word and number a host types: the right type, a sensible size,
    // and no line breaks in the title (lib/listingInput.ts)
    const details = parseListingDetails(body, { creating: true })
    if (!details.ok) return NextResponse.json({ error: details.error }, { status: 400 })
    const fields = details.value

    // The advance a long-term tenant pays: 1 to 6 months, or nothing for the default
    const advance = parseAdvanceMonths(advanceMonthsRequired)
    if (!advance.ok) return NextResponse.json({ error: advance.error }, { status: 400 })

    // The Ghana Post digital address is optional; if given it must be one
    const address = parseDigitalAddress(digitalAddress)
    if (!address.ok) return NextResponse.json({ error: address.error }, { status: 400 })

    // Prices and the deposit: real amounts, never negative (lib/listingInput.ts)
    const money = parseListingMoney(body)
    if (!money.ok) return NextResponse.json({ error: money.error }, { status: 400 })

    // Auto-flag listings with contact details in description
    const isFlagged = hasContactDetails(fields.description ?? '')

    console.log('[POST /api/listings] creating listing for host', hostId)

    const listing = await db.listing.create({
      data: {
        hostId,
        title: fields.title!,
        description: fields.description ?? '',
        propertyType: fields.propertyType!,
        region: fields.region!,
        city: fields.city!,
        neighbourhood: fields.neighbourhood ?? null,
        digitalAddress: address.value,
        lat: fields.lat ?? null,
        lng: fields.lng ?? null,
        bedrooms: fields.bedrooms!,
        bathrooms: fields.bathrooms!,
        maxGuests: fields.maxGuests!,
        rentalModes: fields.rentalModes!,
        priceNightly: money.value.priceNightly ?? null,
        priceMonthly: money.value.priceMonthly ?? null,
        priceAnnual: money.value.priceAnnual ?? null,
        advanceMonthsRequired: advance.value,
        amenities: fields.amenities!,
        rules: fields.rules!,
        photos: JSON.stringify([]),
        cancellationPolicy: asPolicy(cancellationPolicy),
        instantBook: fields.instantBook!,
        minStayNights: fields.minStayNights!,
        damageDeposit: money.value.damageDeposit ?? null,
        welcomeMessage: fields.welcomeMessage ?? null,
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
    refreshHomePage()
    return NextResponse.json({ listing, flagged: isFlagged }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/listings] error:', error)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}

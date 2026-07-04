import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { ListingSearchParams } from '@/types'

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
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const where: Record<string, unknown> = { isActive: true }

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
            select: { id: true, name: true, profilePhoto: true, isVerified: true, isSuperhost: true, trustScore: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.listing.count({ where }),
    ])

    const parsed = listings.map((l) => ({
      ...l,
      amenities: JSON.parse(l.amenities || '[]'),
      rentalModes: JSON.parse(l.rentalModes || '[]'),
      photos: JSON.parse(l.photos || '[]'),
      rules: l.rules ? JSON.parse(l.rules) : [],
    }))

    return NextResponse.json({ listings: parsed, total, page, pages: Math.ceil(total / limit) })
  } catch (error) {
    console.error('Listings GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      hostId, title, description, propertyType, region, city, neighbourhood,
      lat, lng, bedrooms, bathrooms, maxGuests, rentalModes, priceNightly,
      priceMonthly, priceAnnual, advanceMonthsRequired, amenities, rules,
      cancellationPolicy, instantBook, minStayNights, damageDeposit, welcomeMessage,
    } = body

    if (!hostId || !title || !region || !city || !bedrooms || !propertyType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Auto-flag listings with contact details in description
    const contactPattern = /(\+?233|\b0[2-5]\d{8}\b|\b\d{10}\b|@gmail|@yahoo|whatsapp)/i
    const isFlagged = contactPattern.test(description || '')

    const listing = await db.listing.create({
      data: {
        hostId, title, description: description || '',
        propertyType, region, city,
        neighbourhood: neighbourhood || null,
        lat: lat || null, lng: lng || null,
        bedrooms: parseInt(bedrooms), bathrooms: parseInt(bathrooms),
        maxGuests: parseInt(maxGuests),
        rentalModes: JSON.stringify(rentalModes || []),
        priceNightly: priceNightly ? parseFloat(priceNightly) : null,
        priceMonthly: priceMonthly ? parseFloat(priceMonthly) : null,
        priceAnnual: priceAnnual ? parseFloat(priceAnnual) : null,
        advanceMonthsRequired: advanceMonthsRequired ? parseInt(advanceMonthsRequired) : null,
        amenities: JSON.stringify(amenities || []),
        rules: JSON.stringify(rules || []),
        photos: JSON.stringify([]),
        cancellationPolicy: cancellationPolicy || 'FLEXIBLE',
        instantBook: instantBook || false,
        minStayNights: minStayNights ? parseInt(minStayNights) : 1,
        damageDeposit: damageDeposit ? parseFloat(damageDeposit) : null,
        welcomeMessage: welcomeMessage || null,
        isActive: !isFlagged,
      },
    })

    return NextResponse.json({ listing, flagged: isFlagged }, { status: 201 })
  } catch (error) {
    console.error('Listing POST error:', error)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}

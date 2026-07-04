import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const listing = await db.listing.findUnique({
      where: { id },
      include: {
        host: {
          select: { id: true, name: true, profilePhoto: true, isVerified: true, isSuperhost: true, trustScore: true, createdAt: true },
        },
        reviews: {
          include: {
            reviewer: { select: { id: true, name: true, profilePhoto: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        blockedDates: { select: { date: true } },
      },
    })

    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

    return NextResponse.json({
      listing: {
        ...listing,
        amenities: JSON.parse(listing.amenities || '[]'),
        rentalModes: JSON.parse(listing.rentalModes || '[]'),
        photos: JSON.parse(listing.photos || '[]'),
        rules: listing.rules ? JSON.parse(listing.rules) : [],
        blockedDates: listing.blockedDates.map((d) => d.date),
      },
    })
  } catch (error) {
    console.error('Listing GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch listing' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const listing = await db.listing.findUnique({ where: { id } })
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

    const updated = await db.listing.update({
      where: { id },
      data: {
        ...body,
        amenities: body.amenities ? JSON.stringify(body.amenities) : undefined,
        rentalModes: body.rentalModes ? JSON.stringify(body.rentalModes) : undefined,
        photos: body.photos ? JSON.stringify(body.photos) : undefined,
        rules: body.rules ? JSON.stringify(body.rules) : undefined,
      },
    })

    return NextResponse.json({ listing: updated })
  } catch (error) {
    console.error('Listing PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update listing' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.listing.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete listing' }, { status: 500 })
  }
}

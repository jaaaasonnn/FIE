import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/users/[id]
 * Public-safe profile only — never email, phone, or passwordHash.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id:           true,
        name:         true,
        role:         true,
        profilePhoto: true,
        bio:          true,
        nationality:  true,
        businessName: true,
        trustScore:   true,
        isVerified:   true,
        isSuperhost:  true,
        createdAt:    true,
        listings: {
          where:  { isActive: true },
          select: {
            id:           true,
            title:        true,
            photos:       true,
            priceNightly: true,
            priceMonthly: true,
            avgRating:    true,
            reviewCount:  true,
            rentalModes:  true,
          },
          orderBy: { createdAt: 'desc' },
        },
        reviewsReceived: {
          where:   { isPublished: true },
          take:    10,
          orderBy: { createdAt: 'desc' },
          select: {
            id:      true,
            rating:  true,
            comment: true,
            createdAt: true,
            reviewer: { select: { name: true } },
          },
        },
        _count: {
          select: { reviewsReceived: true },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const ratings = user.reviewsReceived.map((r) => r.rating)
    const avgRating = ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : 0

    const listings = user.listings.map((l) => {
      let photos: string[] = []
      try { photos = JSON.parse(l.photos || '[]') } catch { photos = [] }
      let rentalModes: string[] = []
      try { rentalModes = JSON.parse(l.rentalModes || '[]') } catch { rentalModes = [] }
      return {
        id:          l.id,
        title:       l.title,
        photo:       photos[0] ?? null,
        priceNightly: l.priceNightly,
        priceMonthly: l.priceMonthly,
        avgRating:   l.avgRating,
        reviewCount: l.reviewCount,
        rentalModes,
      }
    })

    return NextResponse.json({
      user: {
        id:           user.id,
        name:         user.name,
        role:         user.role,
        profilePhoto: user.profilePhoto,
        nationality:  user.nationality,
        bio:          user.bio,
        trustScore:   user.trustScore,
        isVerified:   user.isVerified,
        isSuperhost:  user.isSuperhost,
        memberSince:  user.createdAt,
        avgRating:    Number(avgRating.toFixed(1)),
        totalReviews: user._count.reviewsReceived,
        listings,
        reviews: user.reviewsReceived.map((r) => ({
          id:       r.id,
          rating:   r.rating,
          comment:  r.comment,
          date:     r.createdAt,
          reviewer: r.reviewer.name ?? 'Guest',
        })),
      },
    })
  } catch (error) {
    console.error('User profile GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
  }
}

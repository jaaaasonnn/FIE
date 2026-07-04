import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const listingId = searchParams.get('listingId')
    const revieweeId = searchParams.get('revieweeId')
    const reviewerId = searchParams.get('reviewerId')

    const where: Record<string, unknown> = { isPublished: true }
    if (listingId) where.listingId = listingId
    if (revieweeId) where.revieweeId = revieweeId
    if (reviewerId) where.reviewerId = reviewerId

    const reviews = await db.review.findMany({
      where,
      include: {
        reviewer: { select: { id: true, name: true, profilePhoto: true } },
        reviewee: { select: { id: true, name: true, profilePhoto: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const avgRating = reviews.length
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0

    return NextResponse.json({ reviews, avgRating: parseFloat(avgRating.toFixed(2)), total: reviews.length })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { bookingId, listingId, reviewerId, revieweeId, rating, comment, type } = await req.json()

    if (!bookingId || !reviewerId || !revieweeId || !rating || !comment || !type) {
      return NextResponse.json({ error: 'Missing required review fields' }, { status: 400 })
    }
    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }

    // Check booking exists and is completed
    const booking = await db.booking.findUnique({ where: { id: bookingId } })
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.status !== 'COMPLETED') return NextResponse.json({ error: 'Booking not yet completed' }, { status: 400 })

    // Check no duplicate review
    const existing = await db.review.findFirst({
      where: { bookingId, reviewerId, type },
    })
    if (existing) return NextResponse.json({ error: 'You have already reviewed this booking' }, { status: 409 })

    const review = await db.review.create({
      data: {
        bookingId, listingId: listingId || null,
        reviewerId, revieweeId, rating, comment, type,
        isPublished: false, // will be published after both parties review or after 14 days
      },
    })

    // Check if both reviews are in — if so, publish both
    const otherType = type === 'GUEST_TO_HOST' ? 'HOST_TO_GUEST' : 'GUEST_TO_HOST'
    const otherReview = await db.review.findFirst({
      where: { bookingId, type: otherType },
    })

    if (otherReview) {
      await db.review.updateMany({
        where: { bookingId },
        data: { isPublished: true },
      })
      // Update listing avg rating
      if (listingId) {
        const allReviews = await db.review.findMany({ where: { listingId, isPublished: true } })
        const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length
        await db.listing.update({
          where: { id: listingId },
          data: { avgRating: parseFloat(avg.toFixed(2)), reviewCount: allReviews.length },
        })
      }
      // Check Superhost eligibility
      const hostReviews = await db.review.findMany({
        where: { revieweeId, type: 'GUEST_TO_HOST', isPublished: true },
      })
      if (hostReviews.length >= 10) {
        const hostAvg = hostReviews.reduce((s, r) => s + r.rating, 0) / hostReviews.length
        if (hostAvg >= 4.8) {
          await db.user.update({ where: { id: revieweeId }, data: { isSuperhost: true } })
        }
      }
    }

    return NextResponse.json({ review, bothSubmitted: !!otherReview }, { status: 201 })
  } catch (error) {
    console.error('Review POST error:', error)
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}

// Host reply to a review
export async function PATCH(req: Request) {
  try {
    const { reviewId, hostReply } = await req.json()
    const updated = await db.review.update({
      where: { id: reviewId },
      data: { hostReply },
    })
    return NextResponse.json({ review: updated })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}

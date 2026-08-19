import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    // Authenticated self-lookup — includes the caller's own unpublished
    // reviews too, since a review sits unpublished until both sides of a
    // booking have submitted (or the 14-day auto-publish window, not yet
    // built), so the public isPublished-only query below can't answer
    // "have I already reviewed this booking" accurately. Scoped strictly
    // to reviewerId: user.id so it can never return anyone else's pending
    // review.
    if (searchParams.get('mine') === 'true') {
      const user = await getSessionUser()
      if (!user) {
        return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
      }
      const reviews = await db.review.findMany({
        where: { reviewerId: user.id },
        select: { id: true, bookingId: true, type: true, rating: true, isPublished: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json({ reviews, total: reviews.length })
    }

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
        reviewee: { select: { id: true, name: true, profilePhoto: true } }
      },
      orderBy: { createdAt: 'desc' }
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
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in to leave a review' }, { status: 401 })
    }

    const { bookingId, rating, comment, type } = await req.json()

    if (!bookingId || !rating || !comment || !type) {
      return NextResponse.json({ error: 'Missing required review fields' }, { status: 400 })
    }
    if (type !== 'GUEST_TO_HOST' && type !== 'HOST_TO_GUEST') {
      return NextResponse.json({ error: 'type must be GUEST_TO_HOST or HOST_TO_GUEST' }, { status: 400 })
    }
    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }

    // Check booking exists and is completed
    const booking = await db.booking.findUnique({ where: { id: bookingId } })
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.status !== 'COMPLETED') return NextResponse.json({ error: 'Booking not yet completed' }, { status: 400 })

    // The caller must actually be a party to this booking, on the side the
    // review type claims — never trust a client-supplied reviewerId, and
    // for the same reason, derive revieweeId (and listingId) from the
    // booking itself rather than the request body, so a legitimate
    // reviewer can't attach their review to an arbitrary third party or
    // an unrelated listing's rating.
    let reviewerId: string
    let revieweeId: string
    if (type === 'GUEST_TO_HOST') {
      if (user.id !== booking.guestId) {
        return NextResponse.json({ error: 'Only the guest on this booking can leave this review' }, { status: 403 })
      }
      reviewerId = booking.guestId
      revieweeId = booking.hostId
    } else {
      if (user.id !== booking.hostId) {
        return NextResponse.json({ error: 'Only the host on this booking can leave this review' }, { status: 403 })
      }
      reviewerId = booking.hostId
      revieweeId = booking.guestId
    }
    const listingId = booking.listingId

    // Check no duplicate review
    const existing = await db.review.findFirst({
      where: { bookingId, reviewerId, type }
    })
    if (existing) return NextResponse.json({ error: 'You have already reviewed this booking' }, { status: 409 })

    const review = await db.review.create({
      data: {
        bookingId, listingId,
        reviewerId, revieweeId, rating, comment, type,
        isPublished: false, // will be published after both parties review or after 14 days
      }
    })

    // Check if both reviews are in — if so, publish both
    const otherType = type === 'GUEST_TO_HOST' ? 'HOST_TO_GUEST' : 'GUEST_TO_HOST'
    const otherReview = await db.review.findFirst({
      where: { bookingId, type: otherType }
    })

    if (otherReview) {
      await db.review.updateMany({
        where: { bookingId },
        data: { isPublished: true }
      })
      // Update listing avg rating — GUEST_TO_HOST only, same reasoning as
      // the GET /api/listings/[id] reviews filter: a HOST_TO_GUEST review
      // rates the guest, not the listing, and shouldn't move its score.
      if (listingId) {
        const allReviews = await db.review.findMany({ where: { listingId, isPublished: true, type: 'GUEST_TO_HOST' } })
        const avg = allReviews.length ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length : 0
        await db.listing.update({
          where: { id: listingId },
          data: { avgRating: parseFloat(avg.toFixed(2)), reviewCount: allReviews.length }
        })
      }
      // Check Superhost eligibility
      const hostReviews = await db.review.findMany({
        where: { revieweeId, type: 'GUEST_TO_HOST', isPublished: true }
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
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    const { reviewId, hostReply } = await req.json()

    const review = await db.review.findUnique({ where: { id: reviewId } })
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

    if (review.revieweeId !== user.id) {
      return NextResponse.json({ error: 'You can only reply to your own reviews' }, { status: 403 })
    }

    const updated = await db.review.update({
      where: { id: reviewId },
      data: { hostReply }
    })
    return NextResponse.json({ review: updated })
  } catch (error) {
    console.error('Review PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}

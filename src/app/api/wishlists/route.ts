import { jsonObject, unreadableBody } from '@/lib/validate'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { liveChecksInclude, publicListing } from '@/lib/listingChecks'

export async function GET(_req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }
    // Ignore any client-supplied userId — a wishlist is only ever the
    // session user's own, never anyone else's by request.
    const userId = user.id

    const now = new Date()
    const wishlists = await db.wishlist.findMany({
      where: { userId },
      include: {
        listing: {
          include: {
            host: { select: { id: true, name: true, isVerified: true, isSuperhost: true } },
            checks: liveChecksInclude(now),
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Only the fields of a listing the public may see (lib/listingChecks.ts)
    return NextResponse.json({
      wishlists: wishlists.map((w) => ({ ...w, listing: { ...publicListing(w.listing, now), host: w.listing.host } })),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch wishlist' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    const body = await jsonObject(req)
    if (!body) return unreadableBody()
    const { listingId } = body
    // Always the session user — never a client-supplied userId, which
    // would let a caller add/remove entries on anyone else's wishlist.
    const userId = user.id

    if (!listingId || typeof listingId !== 'string') {
      return NextResponse.json({ error: 'listingId required' }, { status: 400 })
    }

    // Toggle: if already wishlisted, remove it
    const existing = await db.wishlist.findUnique({
      where: { userId_listingId: { userId, listingId } }
    })

    if (existing) {
      await db.wishlist.delete({ where: { userId_listingId: { userId, listingId } } })
      return NextResponse.json({ wishlisted: false })
    }

    // Only a home that exists can be saved: anything else would be refused by the database as a server fault
    const listing = await db.listing.findUnique({ where: { id: listingId }, select: { id: true } })
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

    await db.wishlist.create({ data: { userId, listingId } })
    return NextResponse.json({ wishlisted: true }, { status: 201 })
  } catch (error) {
    console.error('[Wishlist POST] error:', error)
    return NextResponse.json({ error: 'Failed to update wishlist' }, { status: 500 })
  }
}

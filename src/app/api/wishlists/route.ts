import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

export async function GET(_req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }
    // Ignore any client-supplied userId — a wishlist is only ever the
    // session user's own, never anyone else's by request.
    const userId = user.id

    const wishlists = await db.wishlist.findMany({
      where: { userId },
      include: {
        listing: {
          include: {
            host: { select: { id: true, name: true, isVerified: true, isSuperhost: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ wishlists })
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

    const { listingId } = await req.json()
    // Always the session user — never a client-supplied userId, which
    // would let a caller add/remove entries on anyone else's wishlist.
    const userId = user.id
    console.log('[Wishlist POST] called', { userId, listingId })

    if (!listingId) {
      console.log('[Wishlist POST] rejected — missing listingId')
      return NextResponse.json({ error: 'listingId required' }, { status: 400 })
    }

    // Toggle: if already wishlisted, remove it
    const existing = await db.wishlist.findUnique({
      where: { userId_listingId: { userId, listingId } }
    })

    if (existing) {
      await db.wishlist.delete({ where: { userId_listingId: { userId, listingId } } })
      console.log('[Wishlist POST] removed', { userId, listingId, wishlisted: false })
      return NextResponse.json({ wishlisted: false })
    }

    await db.wishlist.create({ data: { userId, listingId } })
    console.log('[Wishlist POST] created', { userId, listingId, wishlisted: true })
    return NextResponse.json({ wishlisted: true }, { status: 201 })
  } catch (error) {
    console.error('[Wishlist POST] error:', error)
    return NextResponse.json({ error: 'Failed to update wishlist' }, { status: 500 })
  }
}

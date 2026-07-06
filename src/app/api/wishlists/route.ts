import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

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
    const { userId, listingId } = await req.json()
    if (!userId || !listingId) return NextResponse.json({ error: 'userId and listingId required' }, { status: 400 })

    // Toggle: if already wishlisted, remove it
    const existing = await db.wishlist.findUnique({
      where: { userId_listingId: { userId, listingId } }
    })

    if (existing) {
      await db.wishlist.delete({ where: { userId_listingId: { userId, listingId } } })
      return NextResponse.json({ wishlisted: false })
    }

    await db.wishlist.create({ data: { userId, listingId } })
    return NextResponse.json({ wishlisted: true }, { status: 201 })
  } catch (error) {
    console.error('Wishlist POST error:', error)
    return NextResponse.json({ error: 'Failed to update wishlist' }, { status: 500 })
  }
}

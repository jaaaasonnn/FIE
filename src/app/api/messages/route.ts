import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const bookingId = searchParams.get('bookingId')
    const otherUserId = searchParams.get('otherUserId')

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const where: Record<string, unknown> = {
      OR: [{ senderId: userId }, { receiverId: userId }]
    }
    if (bookingId) where.bookingId = bookingId
    if (otherUserId) {
      where.OR = [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ]
    }

    const messages = await db.message.findMany({
      where,
      include: {
        sender:   { select: { id: true, name: true, profilePhoto: true } },
        receiver: { select: { id: true, name: true, profilePhoto: true } },
        booking:  {
          select: {
            id: true,
            listing: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ messages })
  } catch (error) {
    console.error('Messages GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { senderId, receiverId, bookingId, content } = await req.json()

    if (!senderId || !receiverId || !content?.trim()) {
      return NextResponse.json({ error: 'senderId, receiverId, and content are required' }, { status: 400 })
    }

    // Auto-flag messages containing contact details (scam prevention)
    const contactPattern = /(\+?233|\b0[2-5]\d{8}\b|whatsapp|@gmail|@yahoo|pay me direct)/i
    if (contactPattern.test(content)) {
      return NextResponse.json({
        error: 'Message flagged: Please do not share contact details or request off-platform payments. All payments must go through FieGH.'
      }, { status: 400 })
    }

    const message = await db.message.create({
      data: { senderId, receiverId, bookingId: bookingId || null, content: content.trim() },
      include: {
        sender: { select: { id: true, name: true, profilePhoto: true } }
      }
    })

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error('Message POST error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

// Mark messages as read
export async function PATCH(req: Request) {
  try {
    const { receiverId, senderId } = await req.json()

    await db.message.updateMany({
      where: { receiverId, senderId, isRead: false },
      data: { isRead: true }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to mark messages as read' }, { status: 500 })
  }
}

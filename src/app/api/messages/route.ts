import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { notify } from '@/lib/messaging/notify'
import { LIMITS, MESSAGE_SENT, TOO_MANY_MESSAGES, claim, tooMany } from '@/lib/rateLimit'
import { manyLines } from '@/lib/validate'
import { MAX_MESSAGE_LENGTH, NO_REASON_TO_MESSAGE } from '@/lib/rateLimit'

const messageInclude = {
  sender:   { select: { id: true, name: true, profilePhoto: true } },
  receiver: { select: { id: true, name: true, profilePhoto: true } },
  booking: {
    select: {
      id: true,
      listing: { select: { id: true, title: true } },
    },
  },
  listing: { select: { id: true, title: true, hostId: true } },
} as const

/**
 * GET /api/messages
 * Auth required. Uses session user — ignores client userId.
 * - Default: all messages involving the current user (inbox)
 * - ?otherUserId=… (+ optional listingId / bookingId): single thread
 */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in to view messages' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const otherUserId = searchParams.get('otherUserId')
    const bookingId = searchParams.get('bookingId')
    const listingId = searchParams.get('listingId')

    const where: Record<string, unknown> = otherUserId
      ? {
          OR: [
            { senderId: user.id, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: user.id },
          ],
        }
      : {
          OR: [{ senderId: user.id }, { receiverId: user.id }],
        }

    if (bookingId) where.bookingId = bookingId
    if (listingId) where.listingId = listingId

    const messages = await db.message.findMany({
      where,
      include: messageInclude,
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ messages })
  } catch (error) {
    console.error('Messages GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

/**
 * POST /api/messages
 * Body: { receiverId, content, listingId?, bookingId? }
 * senderId always from session.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in to send messages' }, { status: 401 })
    }

    const body = await req.json()
    const receiverId: unknown = body.receiverId
    const bookingId: unknown = body.bookingId || null
    const listingId: unknown = body.listingId || null
    const content = typeof body.content === 'string' ? manyLines(body.content) : ''

    if (typeof receiverId !== 'string' || !receiverId || !content) {
      return NextResponse.json(
        { error: 'receiverId and content are required' },
        { status: 400 },
      )
    }
    if ((bookingId !== null && typeof bookingId !== 'string') || (listingId !== null && typeof listingId !== 'string')) {
      return NextResponse.json({ error: 'bookingId and listingId must be ids' }, { status: 400 })
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `A message can be at most ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 })
    }

    if (receiverId === user.id) {
      return NextResponse.json({ error: 'You cannot message yourself' }, { status: 400 })
    }

    const receiver = await db.user.findUnique({
      where: { id: receiverId },
      select: { id: true },
    })
    if (!receiver) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
    }

    // Who may write to whom. A first message needs a reason: it is to the
    // host of the home it is about, or to the other person on a booking.
    // After that, either of them can reply to the other.
    let reason = false
    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: listingId },
        select: { id: true, hostId: true },
      })
      if (!listing) {
        return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
      }
      if (listing.hostId === receiverId) reason = true
    }

    if (bookingId) {
      const booking = await db.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, guestId: true, hostId: true },
      })
      if (!booking) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
      }
      const party = [booking.guestId, booking.hostId]
      if (!party.includes(user.id) || !party.includes(receiverId)) {
        return NextResponse.json({ error: 'Not a party to this booking' }, { status: 403 })
      }
      reason = true
    }
    if (!reason) {
      // A reply: the other person has written to this one before
      const wroteFirst = await db.message.findFirst({ where: { senderId: receiverId, receiverId: user.id }, select: { id: true } })
      if (!wroteFirst) return NextResponse.json({ error: NO_REASON_TO_MESSAGE }, { status: 403 })
    }

    // Auto-flag messages containing contact details (scam prevention)
    const contactPattern = /(\+?233|\b0[2-5]\d{8}\b|whatsapp|@gmail|@yahoo|pay me direct)/i
    if (contactPattern.test(content)) {
      return NextResponse.json({
        error:
          'Message flagged: Please do not share contact details or request off-platform payments. All payments must go through FieGH.',
      }, { status: 400 })
    }

    // So many an hour from one person. The message is counted before it is
    // stored (lib/rateLimit.ts), so ones sent at the same instant cannot all
    // slip past the count. Last, so only a message that would be sent counts.
    const place = await claim(MESSAGE_SENT, { key: `message:${user.id}` }, { perKey: LIMITS.messagesPerSender })
    if (!place.ok) return tooMany(TOO_MANY_MESSAGES, 60 * 60)

    let message
    try {
      message = await db.message.create({
        data: {
          senderId: user.id,
          receiverId,
          bookingId,
          listingId,
          content,
        },
        include: messageInclude,
      })
    } catch (error) {
      // Not sent, so not counted
      await place.release()
      throw error
    }

    notify('message.received', { messageId: message.id })

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error('Message POST error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

/**
 * PATCH /api/messages — mark messages as read
 * Body: { otherUserId, listingId?, bookingId? }
 * Marks unread messages where current user is receiver and otherUserId is sender.
 */
export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    // Support both new shape (otherUserId) and legacy (senderId + receiverId)
    const otherUserId = body.otherUserId || body.senderId
    const listingId = body.listingId as string | undefined
    const bookingId = body.bookingId as string | undefined

    if (!otherUserId) {
      return NextResponse.json({ error: 'otherUserId is required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      receiverId: user.id,
      senderId: otherUserId,
      isRead: false,
    }
    if (listingId) where.listingId = listingId
    if (bookingId) where.bookingId = bookingId

    const result = await db.message.updateMany({
      where,
      data: { isRead: true },
    })

    return NextResponse.json({ success: true, updated: result.count })
  } catch (error) {
    console.error('Message PATCH error:', error)
    return NextResponse.json({ error: 'Failed to mark messages as read' }, { status: 500 })
  }
}

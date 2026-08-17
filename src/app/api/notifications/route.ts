import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

/**
 * GET /api/notifications — unread notifications for the signed-in user.
 * Auth required; always scoped to the session user.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
  }

  const notifications = await db.notification.findMany({
    where: { userId: user.id, readAt: null },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ notifications })
}

/**
 * PATCH /api/notifications — mark one notification as read.
 * Body: { id }. Auth + ownership required — a user can only dismiss their
 * own notifications.
 */
export async function PATCH(req: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const notification = await db.notification.findUnique({ where: { id } })
  if (!notification) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  if (notification.userId !== user.id) {
    return NextResponse.json({ error: 'You can only dismiss your own notifications' }, { status: 403 })
  }

  await db.notification.update({ where: { id }, data: { readAt: new Date() } })
  return NextResponse.json({ success: true })
}

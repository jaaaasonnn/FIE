import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

/**
 * GET /api/messages/unread: how many messages to the person signed in they have not read, for the badge on
 * the phone's bottom bar (public/bar.js). Their own count only, never anyone else's. Signed out it answers
 * 200 with a count of 0, so a phone that is not signed in does not log a failed request on every page.
 */
export async function GET() {
  const user = await getSessionUser()
  const headers = { 'cache-control': 'private, no-store' }
  if (!user) return NextResponse.json({ count: 0, signedIn: false }, { headers })
  // Message_receiverId_idx (receiverId, createdAt) narrows this to the person's own messages
  const count = await db.message.count({ where: { receiverId: user.id, isRead: false } })
  return NextResponse.json({ count, signedIn: true }, { headers })
}

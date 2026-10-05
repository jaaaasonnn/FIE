import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

/**
 * POST /api/users/me/become-host
 *
 * Turns the signed-in guest into a host. One-way, and deliberately narrow:
 *  - takes no input: the body is never read, so no role or user id can be sent
 *  - the user comes from the session cookie only
 *  - the only value it can ever write is HOST, and only over GUEST
 *  - hosts get a harmless success, so repeat clicks do nothing
 *  - admins are refused and never changed
 *  - cross-site requests are refused by their Origin
 */
export async function POST(req: Request) {
  try {
    // A browser always sends Origin on a POST. It must be this site.
    const origin = req.headers.get('origin')
    if (!origin || origin !== new URL(req.url).origin) {
      return NextResponse.json({ error: 'Request not allowed from this origin' }, { status: 403 })
    }

    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    if (user.role === 'HOST') {
      return NextResponse.json({ role: 'HOST', changed: false })
    }
    if (user.role !== 'GUEST') {
      return NextResponse.json({ error: 'This account cannot become a host' }, { status: 403 })
    }

    // Conditional on the role still being GUEST, so nothing but a guest can
    // ever be moved, even if the account changed since the session was read.
    const result = await db.user.updateMany({
      where: { id: user.id, role: 'GUEST' },
      data: { role: 'HOST' },
    })

    if (result.count === 0) {
      const current = await db.user.findUnique({ where: { id: user.id }, select: { role: true } })
      if (current?.role === 'HOST') return NextResponse.json({ role: 'HOST', changed: false })
      return NextResponse.json({ error: 'This account cannot become a host' }, { status: 403 })
    }

    return NextResponse.json({ role: 'HOST', changed: true })
  } catch (error) {
    console.error('Become host error:', error)
    return NextResponse.json({ error: 'Could not switch your account to hosting' }, { status: 500 })
  }
}

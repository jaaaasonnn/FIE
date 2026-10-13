import { jsonObject } from '@/lib/validate'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/roles'
import { notify } from '@/lib/messaging/notify'
import { setSuspension } from '@/lib/suspension'

/**
 * GET /api/admin/users — ADMIN only
 */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const users = await db.user.findMany({
      select: {
        id:         true,
        name:       true,
        email:      true,
        phone:      true,
        role:       true,
        isVerified: true,
        trustScore: true,
        createdAt:  true,
        suspendedAt:     true,
        suspendedReason: true,
        // never passwordHash
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Admin users GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

/**
 * POST /api/admin/users — ADMIN only. Suspends or restores an account:
 * { userId, action: 'suspend' | 'restore', reason }. The rules, and the
 * record of who did it, are in lib/suspension.ts.
 */
export async function POST(req: Request) {
  const { user: admin, error } = await requireAdmin()
  if (error) return error

  try {
    const body = await jsonObject(req)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Choose an account' }, { status: 400 })

    const now = new Date()
    const result = await setSuspension({ adminId: admin.id, userId: body.userId, action: body.action, reason: body.reason }, now)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    // IDs only in the log. The person is told by email (logged only while messaging is off).
    console.log(`[Admin] account ${result.userId} ${result.action === 'suspend' ? 'suspended' : 'restored'} by ${admin.id}`)
    notify(result.action === 'suspend' ? 'account.suspended' : 'account.restored', { userId: result.userId, at: now.getTime() })

    return NextResponse.json({ ok: true, action: result.action, sessionsEnded: result.sessionsEnded })
  } catch (error) {
    console.error('Admin users POST error:', error)
    return NextResponse.json({ error: 'Could not change this account' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

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

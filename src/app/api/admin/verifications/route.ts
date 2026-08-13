import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

/**
 * GET /api/admin/verifications — ADMIN only
 */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const verifications = await db.verification.findMany({
      include: {
        user: {
          select: { id: true, name: true, profilePhoto: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ verifications })
  } catch (error) {
    console.error('Admin verifications GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 })
  }
}

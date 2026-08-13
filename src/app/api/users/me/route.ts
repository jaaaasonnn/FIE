import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateGhanaPhone, normalizePhone } from '@/lib/utils'

/**
 * GET /api/users/me
 * Auth required. Returns the full editable profile for the current user.
 */
export async function GET() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
  }

  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      profilePhoto: true, bio: true, nationality: true, businessName: true,
      isVerified: true, isSuperhost: true,
    },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({ user })
}

/**
 * PATCH /api/users/me
 * Auth required. Updates the current user's own editable fields.
 * Ignores any client-supplied id — always operates on the session user.
 */
export async function PATCH(req: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    const { name, phone, bio, nationality, businessName } = await req.json()

    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (!phone && !sessionUser.email) {
      return NextResponse.json(
        { error: 'You need at least a phone number or email on file' },
        { status: 400 },
      )
    }

    let normalizedPhone: string | null = null
    if (phone) {
      if (!validateGhanaPhone(phone)) {
        return NextResponse.json(
          { error: 'Invalid Ghana phone number format (e.g. 0241234567)' },
          { status: 400 },
        )
      }
      normalizedPhone = normalizePhone(phone)

      const existing = await db.user.findUnique({ where: { phone: normalizedPhone } })
      if (existing && existing.id !== sessionUser.id) {
        return NextResponse.json({ error: 'Phone number already in use' }, { status: 409 })
      }
    }

    if (bio && typeof bio === 'string' && bio.length > 500) {
      return NextResponse.json({ error: 'Bio must be 500 characters or fewer' }, { status: 400 })
    }

    const user = await db.user.update({
      where: { id: sessionUser.id },
      data: {
        name: name.trim(),
        phone: normalizedPhone,
        bio: bio?.trim() || null,
        nationality: nationality?.trim() || null,
        businessName: businessName?.trim() || null,
      },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        profilePhoto: true, bio: true, nationality: true, businessName: true,
        isVerified: true, isSuperhost: true,
      },
    })

    return NextResponse.json({ user })
  } catch (error) {
    console.error('User profile PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

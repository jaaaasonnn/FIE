import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromToken } from '@/lib/session'

/**
 * GET /api/auth/session
 * Called by the client-side AuthContext on mount to rehydrate the current user.
 * Returns the user object if the session cookie is valid, or 401 if not.
 */
export async function GET() {
  const cookieStore = await cookies()
  const token = cookieStore.get('fiegh_session')?.value

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const user = await getUserFromToken(token)

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  return NextResponse.json({ user })
}

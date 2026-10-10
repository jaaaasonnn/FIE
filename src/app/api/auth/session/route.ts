import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromToken } from '@/lib/session'
import { mustVerifyEmail } from '@/lib/roles'

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

  // mustVerifyEmail: true while the person is held back from booking, listing
  // and paying until they confirm their email. Always false while that rule
  // is switched off.
  return NextResponse.json({ user: { ...user, mustVerifyEmail: mustVerifyEmail(user) } })
}

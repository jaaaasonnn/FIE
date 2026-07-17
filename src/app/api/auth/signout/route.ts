import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

/**
 * POST /api/auth/signout
 * Deletes the session row from the DB and clears the cookie.
 */
export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get('fiegh_session')?.value

  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {})
  }

  const response = NextResponse.json({ message: 'Signed out' })

  response.cookies.set('fiegh_session', '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires:  new Date(0),
    path:     '/',
  })

  return response
}

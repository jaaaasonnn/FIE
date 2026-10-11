import { NextResponse } from 'next/server'
import { SESSION_COOKIE, endAllSessions, endSession, getUserFromToken, sessionToken } from '@/lib/session'

/**
 * POST /api/auth/signout
 * Ends this session and clears the cookie. With { everywhere: true } it ends
 * every session the person has, on every device.
 */
export async function POST(req: Request) {
  const token = await sessionToken()
  const body = await req.json().catch(() => ({}))

  let ended = 0
  if (token) {
    const user = body?.everywhere === true ? await getUserFromToken(token) : null
    if (user) ended = await endAllSessions(user.id)
    else await endSession(token)
  }

  const response = NextResponse.json({ message: 'Signed out', ...(body?.everywhere === true ? { everywhere: true, ended } : {}) })

  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires:  new Date(0),
    path:     '/',
  })

  return response
}

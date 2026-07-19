import { cookies } from 'next/headers'
import { db } from '@/lib/db'

export type SessionUser = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: string           // GUEST | HOST | ADMIN
  profilePhoto: string | null
  isVerified: boolean
  isSuperhost: boolean
}

/** Convenience helper for Route Handlers — reads the fiegh_session cookie. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('fiegh_session')?.value
  if (!token) return null
  return getUserFromToken(token)
}

/**
 * Validates a raw session token string against the DB.
 * Returns the user if the session is valid and not expired, otherwise null.
 * Cleans up expired sessions as a side-effect.
 *
 * Use this in Route Handlers (pass the cookie value directly).
 * For middleware, just check cookie existence — full DB validation isn't
 * possible on the Edge runtime.
 */
export async function getUserFromToken(token: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { token },
    select: {
      expiresAt: true,
      user: {
        select: {
          id:           true,
          name:         true,
          email:        true,
          phone:        true,
          role:         true,
          profilePhoto: true,
          isVerified:   true,
          isSuperhost:  true,
        },
      },
    },
  })

  if (!session) return null

  if (session.expiresAt < new Date()) {
    await db.session.deleteMany({ where: { token } }).catch(() => {})
    return null
  }

  return session.user
}

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'fiegh_session'
/** How long a sign-in lasts. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * What is stored for a session: the SHA-256 hash of its token, never the
 * token. The token itself exists only in the person's cookie, so a copy of
 * the Session table cannot be used to sign in as anyone.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Starts a session for a person. Returns the token for their cookie; only its hash is kept. */
export async function createSession(userId: string, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  // Their own sessions that have run out are cleared as they sign in
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: now } } }).catch(() => {})
  await db.session.create({ data: { userId, token: hashSessionToken(token), expiresAt } })
  return { token, expiresAt }
}

/** Ends one session, by the token in the cookie. */
export async function endSession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { token: hashSessionToken(token) } }).catch(() => {})
}

/**
 * Ends every session a person has, or every one but the one named (the
 * device they are on). Returns how many were ended.
 */
export async function endAllSessions(userId: string, { exceptToken }: { exceptToken?: string | null } = {}): Promise<number> {
  const ended = await db.session.deleteMany({
    where: { userId, ...(exceptToken ? { token: { not: hashSessionToken(exceptToken) } } : {}) },
  })
  return ended.count
}

/** Sessions that ran out are of no use to anyone: removed by the daily clean-up job. */
export async function purgeExpiredSessions(now: Date = new Date(), { dryRun = false }: { dryRun?: boolean } = {}): Promise<number> {
  if (dryRun) return db.session.count({ where: { expiresAt: { lt: now } } })
  return (await db.session.deleteMany({ where: { expiresAt: { lt: now } } })).count
}

/** The raw token in this request's cookie, if any. */
export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null
}

export type SessionUser = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: string           // GUEST | HOST | ADMIN
  profilePhoto: string | null
  trustScore: number
  isVerified: boolean
  isSuperhost: boolean
  /** When the email address was confirmed by a link sent to it; null until then */
  emailVerifiedAt: Date | null
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
  // Tokens are 64 hex characters; anything else is not one of ours
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const session = await db.session.findUnique({
    where: { token: hashSessionToken(token) },
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
          trustScore:   true,
          isVerified:   true,
          isSuperhost:  true,
          emailVerifiedAt: true,
        },
      },
    },
  })

  if (!session) return null

  if (session.expiresAt < new Date()) {
    await endSession(token)
    return null
  }

  return session.user
}

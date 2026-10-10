// One place for "who may do this". Every route that is for hosts only, or
// for admins only, asks here, so they all apply the same rule.
//
// The role is read from the database on every request (getSessionUser looks
// the session up and reads the user row), never from the cookie, so someone
// who has just become a host is a host on their next request.

import { NextResponse } from 'next/server'
import { getSessionUser, type SessionUser } from '@/lib/session'
import { emailVerificationRequired } from '@/lib/payoutSwitches'
import { EMAIL_NEEDED, EMAIL_NOT_VERIFIED } from '@/lib/authTokens'

type Gate =
  | { user: SessionUser; error: null }
  | { user: null; error: NextResponse }

export const SIGN_IN_MESSAGE = 'You must be signed in'
export const HOSTS_ONLY_MESSAGE = 'Only hosts can do this. Become a host first.'
export const ADMINS_ONLY_MESSAGE = 'Admin access required'

const refuse = (message: string, status: 401 | 403): Gate => ({
  user: null,
  error: NextResponse.json({ error: message }, { status }),
})

/**
 * Gate for host-only API routes: 401 when signed out, 403 for anyone who is
 * not a host. Return `error` straight away when it is set.
 *
 * `allowAdmin` lets an admin through as well. It is only for the routes where
 * admins already act on a host's listing (editing, switching off, deleting,
 * the calendar, reading a host's bookings); it does not make an admin a host
 * anywhere else. Ownership is still the route's own check, made afterwards.
 */
export async function requireHost({ allowAdmin = false }: { allowAdmin?: boolean } = {}): Promise<Gate> {
  const user = await getSessionUser()
  if (!user) return refuse(SIGN_IN_MESSAGE, 401)
  if (user.role === 'HOST') return { user, error: null }
  if (allowAdmin && user.role === 'ADMIN') return { user, error: null }
  return refuse(HOSTS_ONLY_MESSAGE, 403)
}

/** Gate for admin-only API routes: 401 when signed out, 403 for anyone who is not an admin. */
export async function requireAdmin(): Promise<Gate> {
  const user = await getSessionUser()
  if (!user) return refuse(SIGN_IN_MESSAGE, 401)
  if (user.role !== 'ADMIN') return refuse(ADMINS_ONLY_MESSAGE, 403)
  return { user, error: null }
}

/** True when this person is held back until they confirm their email address. */
export function mustVerifyEmail(user: Pick<SessionUser, 'emailVerifiedAt'>): boolean {
  return emailVerificationRequired() && !user.emailVerifiedAt
}

/**
 * Gate for booking, listing a home and paying: a refusal (403) for someone
 * whose email address is not confirmed, or null when they may go on. Does
 * nothing until EMAIL_VERIFICATION_REQUIRED is switched on. Browsing is never
 * gated. Return the response straight away when it is set.
 */
export function requireVerifiedEmail(user: Pick<SessionUser, 'email' | 'emailVerifiedAt'>): NextResponse | null {
  if (!mustVerifyEmail(user)) return null
  return NextResponse.json({ error: user.email ? EMAIL_NOT_VERIFIED : EMAIL_NEEDED, code: 'EMAIL_NOT_VERIFIED' }, { status: 403 })
}

/**
 * Where someone who opens a page under /dashboard/host is sent, or null if
 * they may see it. Host pages only ever show the signed-in person's own
 * listings, bookings and payouts, so an admin has nothing to see there and
 * goes to the admin panel instead.
 */
export function hostAreaRedirect(user: { role: string } | null): string | null {
  if (!user) return '/login?redirect=/dashboard/host'
  if (user.role === 'HOST') return null
  if (user.role === 'ADMIN') return '/admin'
  return '/become-a-host'
}

import { NextResponse } from 'next/server'
import { getSessionUser, type SessionUser } from '@/lib/session'

/**
 * Gate for admin-only API routes.
 * Returns { user } on success, or { error: NextResponse } (401/403) to return immediately.
 */
export async function requireAdmin(): Promise<
  | { user: SessionUser; error: null }
  | { user: null; error: NextResponse }
> {
  const user = await getSessionUser()
  if (!user) {
    return {
      user:  null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  if (user.role !== 'ADMIN') {
    return {
      user:  null,
      error: NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 }),
    }
  }
  return { user, error: null }
}

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { SIGN_IN_MESSAGE } from '@/lib/roles'
import { VERIFICATION_REQUESTED, ipHashOf, requestVerification } from '@/lib/authTokens'

/**
 * POST /api/auth/resend-verification
 *
 * Sends the signed-in person the link to confirm their email address again,
 * within the limits (lib/authTokens.ts). The answer is the same whether a
 * link went, the address is already confirmed, or the limit was reached.
 */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: SIGN_IN_MESSAGE }, { status: 401 })
  try {
    await requestVerification(user, ipHashOf(req))
  } catch (error) {
    console.error('Resend verification error for user', user.id, error instanceof Error ? error.message : error)
  }
  return NextResponse.json({ message: VERIFICATION_REQUESTED })
}

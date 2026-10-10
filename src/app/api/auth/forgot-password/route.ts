import { NextResponse } from 'next/server'
import { RESET_REQUESTED, ipHashOf, requestPasswordReset } from '@/lib/authTokens'

/**
 * POST /api/auth/forgot-password  { email }
 *
 * Sends a link to reset the password, if the address has an account and the
 * limits allow (lib/authTokens.ts). The answer is the same every time: whether
 * the address is registered, not registered, not an address at all, or over
 * the limit. It cannot be used to find out who has an account.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    await requestPasswordReset(body?.email, ipHashOf(req))
  } catch (error) {
    // Even a fault gives the same answer; it is logged without the address
    console.error('Forgot password error:', error instanceof Error ? error.message : error)
  }
  return NextResponse.json({ message: RESET_REQUESTED })
}

import { NextResponse } from 'next/server'
import { resetPassword } from '@/lib/authTokens'

/**
 * POST /api/auth/reset-password  { token, password }
 *
 * Sets a new password from the link in a reset email. The link works once and
 * for an hour. Every session on the account is deleted, so it is signed out
 * everywhere, including here: the person signs in again with the new password.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const result = await resetPassword(body?.token, body?.password)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ message: 'Your password has been changed. Please sign in with the new one.' })
  } catch (error) {
    console.error('Reset password error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'The password could not be changed. Please try again.' }, { status: 500 })
  }
}

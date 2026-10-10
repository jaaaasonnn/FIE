import { NextResponse } from 'next/server'
import { BAD_LINK, confirmEmail } from '@/lib/authTokens'

/**
 * POST /api/auth/confirm-email  { token }
 *
 * Follows the link in a confirmation email: confirms the address on a new
 * account, or completes a change of address. It is a POST, made when the
 * person presses the button on the page the link opens, so a mail scanner
 * that only fetches the link cannot use it up. No sign-in is needed: the
 * token is the proof. Every failure reads the same.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const result = await confirmEmail(body?.token)
    if (!result.ok) return NextResponse.json({ error: BAD_LINK }, { status: 400 })
    return NextResponse.json({
      kind: result.kind,
      message: result.kind === 'CHANGED'
        ? 'Your email address has been changed. Use the new one to sign in from now on.'
        : 'Your email address is confirmed. Thank you.',
    })
  } catch (error) {
    console.error('Confirm email error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'The link could not be followed. Please try again.' }, { status: 500 })
  }
}

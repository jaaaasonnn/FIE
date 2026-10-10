import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { SIGN_IN_MESSAGE } from '@/lib/roles'
import { EMAIL_CHANGE_REQUESTED, ipHashOf, requestEmailChange } from '@/lib/authTokens'

/**
 * POST /api/users/me/email  { email, password }
 *
 * Starts adding or changing the email on the signed-in account. Nothing on
 * the account changes here: a link goes to the NEW address, the current
 * address is told, and the email changes only when that link is followed
 * (lib/authTokens.ts).
 *
 * The current password is asked for again, so a session left open on a
 * shared phone cannot be used to move the account to someone else's address.
 * After that the answer is the same whether or not the new address is free.
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) return NextResponse.json({ error: SIGN_IN_MESSAGE }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const account = await db.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, email: true, passwordHash: true } })
    if (!account) return NextResponse.json({ error: SIGN_IN_MESSAGE }, { status: 401 })
    if (typeof body?.password !== 'string' || !account.passwordHash || !(await bcrypt.compare(body.password, account.passwordHash))) {
      return NextResponse.json({ error: 'Enter your current password to change your email.' }, { status: 403 })
    }

    const result = await requestEmailChange(account, body?.email, ipHashOf(req))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ message: EMAIL_CHANGE_REQUESTED })
  } catch (error) {
    console.error('Email change error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'The change could not be started. Please try again.' }, { status: 500 })
  }
}

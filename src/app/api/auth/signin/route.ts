import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { normalizePhone, validateGhanaPhone } from '@/lib/utils'
import { mustVerifyEmail } from '@/lib/roles'
import { createSession } from '@/lib/session'
import { SUSPENDED_SIGN_IN, isSuspended } from '@/lib/suspension'
import { ipHashOf } from '@/lib/authTokens'
import { LIMITS, SIGN_IN_FAILED, TOO_MANY_SIGN_INS, claim, signInKey, tooMany } from '@/lib/rateLimit'

/**
 * A real bcrypt hash of a password nobody has. When there is no account for
 * the email or phone, the password is checked against this, so the answer
 * takes as long as it does for an account that exists.
 */
const NO_ACCOUNT_HASH = '$2b$12$8a2e.5QaptJCdcpDBIIjz.NHuhhZ4jN.WuE.Lvsw5aDlYqWVIOY/2'

export async function POST(req: Request) {
  try {
    const { identifier, password } = await req.json()

    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      return NextResponse.json({ error: 'Phone/email and password are required' }, { status: 400 })
    }
    // Longer than any real password or address: refused before any hashing
    if (identifier.length > 320 || password.length > 200) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Too many wrong passwords, for this account or from this address: no
    // more guesses for now, right or wrong. Counted against the email or
    // phone as typed, so the answer is the same whether or not it has an account.
    const key = signInKey(identifier)
    const ipHash = ipHashOf(req)
    // The attempt is written down before the password is looked at
    // (lib/rateLimit.ts), so guesses sent at the same instant cannot all slip
    // past the count. It stays on record only if the password is wrong.
    const attempt = await claim(SIGN_IN_FAILED, { key, ipHash }, { perKey: LIMITS.signInPerAccount, perIp: LIMITS.signInPerIp })
    if (!attempt.ok) {
      return tooMany(TOO_MANY_SIGN_INS, LIMITS.signInPerAccount.windowMs / 1000)
    }

    const isPhone = /^[0-9+]/.test(identifier)
    const normalizedId = isPhone ? normalizePhone(identifier) : String(identifier).trim()

    // Emails are stored lower-cased. An account made before that rule may
    // still have capitals in it, so the address as typed is tried as well.
    const user = await db.user.findFirst({
      where: isPhone ? { phone: normalizedId } : { email: { in: [normalizedId.toLowerCase(), normalizedId] } }
    })

    // The password is always checked against something, so an address with no
    // account takes as long to refuse as one with the wrong password
    const valid = await bcrypt.compare(password, user?.passwordHash ?? NO_ACCOUNT_HASH)
    if (!user || !user.passwordHash || !valid) {
      // A wrong password: the attempt written above stays, and counts
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    // Signed in: this attempt and earlier wrong guesses for this account no longer count
    await db.authRequest.deleteMany({ where: { kind: SIGN_IN_FAILED, userId: key } })

    // A suspended account cannot be signed in to. Said only to someone who
    // has the right password, so it tells nobody else anything.
    if (isSuspended(user)) {
      return NextResponse.json({ error: SUSPENDED_SIGN_IN, code: 'ACCOUNT_SUSPENDED' }, { status: 403 })
    }

    // A new session. Only the hash of its token is stored (lib/session.ts).
    const { token, expiresAt } = await createSession(user.id)

    const { passwordHash: _, ...account } = user
    // The suspension columns are for admins: left out of what is sent (undefined is dropped)
    const userWithoutPassword = { ...account, suspendedAt: undefined, suspendedById: undefined, suspendedReason: undefined }

    const response = NextResponse.json({
      user: { ...userWithoutPassword, mustVerifyEmail: mustVerifyEmail(user) },
      message: 'Signed in successfully'
    })

    response.cookies.set('fiegh_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/'
    })

    return response
  } catch (error) {
    console.error('Signin error:', error)
    return NextResponse.json({ error: 'Sign in failed' }, { status: 500 })
  }
}

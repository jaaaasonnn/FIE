import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { normalizePhone, validateGhanaPhone } from '@/lib/utils'
import { mustVerifyEmail } from '@/lib/roles'
import { ipHashOf } from '@/lib/authTokens'
import { LIMITS, SIGN_IN_FAILED, TOO_MANY_SIGN_INS, countRecent, record, signInKey, tooMany } from '@/lib/rateLimit'

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
    const [forAccount, fromIp] = await Promise.all([
      countRecent(SIGN_IN_FAILED, { key }, LIMITS.signInPerAccount.windowMs),
      ipHash ? countRecent(SIGN_IN_FAILED, { ipHash }, LIMITS.signInPerIp.windowMs) : 0,
    ])
    if (forAccount >= LIMITS.signInPerAccount.max || fromIp >= LIMITS.signInPerIp.max) {
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
      await record(SIGN_IN_FAILED, { key, ipHash })
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    // Signed in: earlier wrong guesses for this account no longer count
    await db.authRequest.deleteMany({ where: { kind: SIGN_IN_FAILED, userId: key } })

    // Create session token
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    await db.session.create({
      data: { userId: user.id, token, expiresAt }
    })

    const { passwordHash: _, ...userWithoutPassword } = user

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

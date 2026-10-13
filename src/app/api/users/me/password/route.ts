import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { endAllSessions, getUserFromToken, sessionToken } from '@/lib/session'
import { SIGN_IN_MESSAGE } from '@/lib/roles'
import { MIN_PASSWORD_LENGTH } from '@/lib/authTokens'
import { MAX_PASSWORD_LENGTH, jsonObject } from '@/lib/validate'
import { LIMITS, countRecent, record, tooMany } from '@/lib/rateLimit'
import { notify } from '@/lib/messaging/notify'

const WRONG_PASSWORD = 'WRONG_CURRENT_PASSWORD'

/**
 * POST /api/users/me/password  { currentPassword, newPassword }
 *
 * Changes the password of the person signed in. The current password is asked
 * for again, so a session left open on a shared computer cannot be used to
 * lock its owner out. Every other session is ended; this one stays. Wrong
 * guesses at the current password are limited like wrong sign-ins.
 */
export async function POST(req: Request) {
  try {
    const token = await sessionToken()
    const sessionUser = token ? await getUserFromToken(token) : null
    if (!sessionUser) return NextResponse.json({ error: SIGN_IN_MESSAGE }, { status: 401 })

    const body = (await jsonObject(req)) ?? {}
    const { currentPassword, newPassword } = body ?? {}
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json({ error: 'Enter your current password.' }, { status: 400 })
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 })
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Your new password can be at most ${MAX_PASSWORD_LENGTH} characters` }, { status: 400 })
    }

    const key = `password:${sessionUser.id}`
    if ((await countRecent(WRONG_PASSWORD, { key }, LIMITS.signInPerAccount.windowMs)) >= LIMITS.signInPerAccount.max) {
      return tooMany('Too many wrong passwords. Please wait 15 minutes and try again.', LIMITS.signInPerAccount.windowMs / 1000)
    }

    const account = await db.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, passwordHash: true } })
    if (!account?.passwordHash || !(await bcrypt.compare(currentPassword, account.passwordHash))) {
      await record(WRONG_PASSWORD, { key })
      return NextResponse.json({ error: 'Your current password is not right.' }, { status: 403 })
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: 'Choose a new password that is different from the current one.' }, { status: 400 })
    }

    await db.user.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } })
    // Whoever else was signed in with the old password is out; this device stays
    const ended = await endAllSessions(account.id, { exceptToken: token })
    // Reset links asked for before the change are no use now
    await db.authToken.updateMany({ where: { userId: account.id, purpose: 'RESET_PASSWORD', usedAt: null }, data: { usedAt: new Date() } })
    await db.authRequest.deleteMany({ where: { kind: WRONG_PASSWORD, userId: key } })
    notify('account.password_updated', { userId: account.id, at: Date.now() })

    return NextResponse.json({ message: 'Your password has been changed. Every other device has been signed out.', ended })
  } catch (error) {
    console.error('Change password error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'The password could not be changed. Please try again.' }, { status: 500 })
  }
}

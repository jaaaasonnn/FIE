import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { normalizePhone, validateGhanaPhone } from '@/lib/utils'

export async function POST(req: Request) {
  try {
    const { identifier, password } = await req.json()

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Phone/email and password are required' }, { status: 400 })
    }

    const isPhone = /^[0-9+]/.test(identifier)
    const normalizedId = isPhone ? normalizePhone(identifier) : identifier

    const user = await db.user.findFirst({
      where: isPhone ? { phone: normalizedId } : { email: normalizedId }
    })

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Create session token
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    await db.session.create({
      data: { userId: user.id, token, expiresAt }
    })

    const { passwordHash: _, ...userWithoutPassword } = user

    const response = NextResponse.json({
      user: userWithoutPassword,
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

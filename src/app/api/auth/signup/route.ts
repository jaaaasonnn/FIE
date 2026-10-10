import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { validateGhanaPhone, normalizePhone, normalizeEmail } from '@/lib/utils'
import { notify } from '@/lib/messaging/notify'
import { ipHashOf, requestVerification } from '@/lib/authTokens'

export async function POST(req: Request) {
  try {
    const { name, email: rawEmail, phone, password, role, businessName, nationality } = await req.json()

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (!phone && !rawEmail) return NextResponse.json({ error: 'Phone or email is required' }, { status: 400 })
    // Stored trimmed and lower-cased, so the same address cannot be registered
    // twice in different capitals and messages always go to one spelling of it
    const email = rawEmail ? normalizeEmail(rawEmail) : null
    if (rawEmail && !email) return NextResponse.json({ error: 'Enter a valid email address (e.g. ama@example.com)' }, { status: 400 })
    if (phone && !validateGhanaPhone(phone)) {
      return NextResponse.json({ error: 'Invalid Ghana phone number format (e.g. 0241234567)' }, { status: 400 })
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const normalizedPhone = phone ? normalizePhone(phone) : null

    // Check existing user
    if (email) {
      const existing = await db.user.findUnique({ where: { email } })
      if (existing) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }
    if (normalizedPhone) {
      const existing = await db.user.findUnique({ where: { phone: normalizedPhone } })
      if (existing) return NextResponse.json({ error: 'Phone number already registered' }, { status: 409 })
    }

    // Never trust the client's role: only the two self-service roles are
    // allowed, matched exactly. Anything else (missing, ADMIN, other casing,
    // non-strings) becomes GUEST.
    const safeRole = role === 'HOST' ? 'HOST' : 'GUEST'

    const passwordHash = await bcrypt.hash(password, 12)

    const user = await db.user.create({
      data: {
        name,
        email: email || null,
        phone: normalizedPhone,
        passwordHash,
        role: safeRole,
        businessName: businessName || null,
        nationality: nationality || 'Ghanaian'
      }
    })

    const { passwordHash: _, ...userWithoutPassword } = user

    notify('account.welcome', { userId: user.id })
    // A link to confirm the address, sent to it. The account works for
    // browsing straight away; a failure here never undoes the sign-up.
    try {
      await requestVerification(user, ipHashOf(req), { limited: false })
    } catch (error) {
      console.error('Signup: could not start email verification for user', user.id, error instanceof Error ? error.message : error)
    }

    return NextResponse.json({ user: userWithoutPassword, message: 'Account created successfully' }, { status: 201 })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}

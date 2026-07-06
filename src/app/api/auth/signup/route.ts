import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { validateGhanaPhone, normalizePhone } from '@/lib/utils'

export async function POST(req: Request) {
  try {
    const { name, email, phone, password, role, businessName, nationality } = await req.json()

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (!phone && !email) return NextResponse.json({ error: 'Phone or email is required' }, { status: 400 })
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

    const passwordHash = await bcrypt.hash(password, 12)

    const user = await db.user.create({
      data: {
        name,
        email: email || null,
        phone: normalizedPhone,
        passwordHash,
        role: role || 'GUEST',
        businessName: businessName || null,
        nationality: nationality || 'Ghanaian'
      }
    })

    const { passwordHash: _, ...userWithoutPassword } = user

    return NextResponse.json({ user: userWithoutPassword, message: 'Account created successfully' }, { status: 201 })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}

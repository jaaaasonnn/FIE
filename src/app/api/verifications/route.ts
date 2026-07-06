import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const { userId, idType, idPhotoUrl, selfieUrl } = await req.json()

    if (!userId || !idType || !idPhotoUrl) {
      return NextResponse.json({ error: 'userId, idType, and idPhotoUrl are required' }, { status: 400 })
    }

    const validIdTypes = ['GHANA_CARD', 'PASSPORT', 'VOTER_ID']
    if (!validIdTypes.includes(idType)) {
      return NextResponse.json({ error: 'Invalid ID type' }, { status: 400 })
    }

    // Check for existing pending/approved verification
    const existing = await db.verification.findUnique({ where: { userId } })
    if (existing?.status === 'APPROVED') {
      return NextResponse.json({ error: 'User already verified' }, { status: 409 })
    }

    const verification = existing
      ? await db.verification.update({
          where: { userId },
          data: { idType, idPhotoUrl, selfieUrl: selfieUrl || null, status: 'PENDING', reviewedById: null, notes: null }
        })
      : await db.verification.create({
          data: { userId, idType, idPhotoUrl, selfieUrl: selfieUrl || null, status: 'PENDING' }
        })

    return NextResponse.json({ verification, message: 'Verification submitted. Review usually within 24 hours.' }, { status: 201 })
  } catch (error) {
    console.error('Verification POST error:', error)
    return NextResponse.json({ error: 'Failed to submit verification' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (userId) where.userId = userId
    if (status) where.status = status

    const verifications = await db.verification.findMany({
      where,
      include: { user: { select: { id: true, name: true, phone: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ verifications })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 })
  }
}

// Admin approve/reject
export async function PATCH(req: Request) {
  try {
    const { verificationId, status, reviewedById, notes } = await req.json()

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Status must be APPROVED or REJECTED' }, { status: 400 })
    }

    const verification = await db.verification.update({
      where: { id: verificationId },
      data: { status, reviewedById: reviewedById || null, notes: notes || null }
    })

    // If approved, mark user as verified
    if (status === 'APPROVED') {
      await db.user.update({
        where: { id: verification.userId },
        data: {
          isVerified: true,
          // Boost trust score on verification (+40 points)
          trustScore: { increment: 40 }
        }
      })
    }

    return NextResponse.json({ verification })
  } catch (error) {
    console.error('Verification PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update verification' }, { status: 500 })
  }
}

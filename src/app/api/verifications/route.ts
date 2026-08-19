import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { requireAdmin } from '@/lib/admin'
import { supabaseAdmin, VERIFICATION_DOCS_BUCKET } from '@/lib/supabase'

const MAX_DOC_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const VALID_ID_TYPES = ['GHANA_CARD', 'PASSPORT', 'VOTER_ID']

// Fixed key per user + document (id-photo / selfie), same overwrite-in-place
// pattern as the avatars bucket — a resubmission replaces the old file
// rather than accumulating orphans, and matches Verification.userId being
// @unique on the model.
async function uploadDoc(userId: string, field: 'id-photo' | 'selfie', file: File) {
  const buffer = Buffer.from(await file.arrayBuffer())
  const path = `${userId}/${field}.jpg`
  const { error } = await supabaseAdmin.storage
    .from(VERIFICATION_DOCS_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })
  if (error) throw error
  return path
}

/**
 * POST /api/verifications
 * Auth required — always submits for the signed-in user; there is no
 * client-supplied userId anymore. Body: multipart FormData (idType,
 * idPhoto file, optional selfie file).
 *
 * idPhotoUrl/selfieUrl store a private Storage *path*, not a browsable
 * URL — verification-docs is a private bucket (real ID scans, unlike the
 * public avatars/listing-photos buckets), so there's no public URL to
 * store. Admin review signs a short-lived URL per document on read; see
 * GET /api/admin/verifications.
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'You must be signed in to submit verification' }, { status: 401 })
    }

    const form = await req.formData()
    const idType = form.get('idType')
    const idPhoto = form.get('idPhoto')
    const selfie = form.get('selfie')

    if (typeof idType !== 'string' || !VALID_ID_TYPES.includes(idType)) {
      return NextResponse.json({ error: 'idType must be GHANA_CARD, PASSPORT, or VOTER_ID' }, { status: 400 })
    }
    if (!(idPhoto instanceof File)) {
      return NextResponse.json({ error: 'An ID photo is required' }, { status: 400 })
    }

    const filesToValidate = selfie instanceof File ? [idPhoto, selfie] : [idPhoto]
    for (const file of filesToValidate) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({ error: 'Photos must be JPG, PNG, or WEBP images' }, { status: 400 })
      }
      if (file.size > MAX_DOC_BYTES) {
        return NextResponse.json({ error: 'Each photo must be 10MB or smaller' }, { status: 400 })
      }
    }

    // Check for existing pending/approved verification before touching Storage
    const existing = await db.verification.findUnique({ where: { userId: sessionUser.id } })
    if (existing?.status === 'APPROVED') {
      return NextResponse.json({ error: 'You are already verified' }, { status: 409 })
    }

    let idPhotoUrl: string
    let selfieUrl: string | null = null
    try {
      idPhotoUrl = await uploadDoc(sessionUser.id, 'id-photo', idPhoto)
      if (selfie instanceof File) {
        selfieUrl = await uploadDoc(sessionUser.id, 'selfie', selfie)
      }
    } catch (uploadError) {
      console.error('Verification document upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 })
    }

    const verification = existing
      ? await db.verification.update({
          where: { userId: sessionUser.id },
          data: { idType, idPhotoUrl, selfieUrl, status: 'PENDING', reviewedById: null, notes: null }
        })
      : await db.verification.create({
          data: { userId: sessionUser.id, idType, idPhotoUrl, selfieUrl, status: 'PENDING' }
        })

    return NextResponse.json({ verification, message: 'Verification submitted. Review usually within 24 hours.' }, { status: 201 })
  } catch (error) {
    console.error('Verification POST error:', error)
    return NextResponse.json({ error: 'Failed to submit verification' }, { status: 500 })
  }
}

/**
 * GET /api/verifications
 * Auth required. Non-admin callers only ever see their own verification
 * record — this previously took an arbitrary `userId` query param with no
 * auth check at all, which leaked every user's name/phone/email/ID-photo
 * reference to anyone. Admins (already served by /api/admin/verifications
 * for the review queue) additionally may filter by an explicit userId.
 */
export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (sessionUser.role === 'ADMIN') {
      const userId = searchParams.get('userId')
      if (userId) where.userId = userId
    } else {
      where.userId = sessionUser.id
    }
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
    const { user, error } = await requireAdmin()
    if (error) return error

    const { verificationId, status, notes } = await req.json()

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Status must be APPROVED or REJECTED' }, { status: 400 })
    }

    const verification = await db.verification.update({
      where: { id: verificationId },
      data: { status, reviewedById: user.id, notes: notes || null }
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

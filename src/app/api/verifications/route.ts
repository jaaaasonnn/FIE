import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { requireAdmin } from '@/lib/roles'
import { notify } from '@/lib/messaging/notify'
import { supabaseAdmin, VERIFICATION_DOCS_BUCKET } from '@/lib/supabase'
import { hostIdApproved } from '@/lib/hostId'
import { manyLines } from '@/lib/validate'
import { NOT_AN_IMAGE, readImage } from '@/lib/imageBytes'

const MAX_DOC_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const VALID_ID_TYPES = ['GHANA_CARD', 'PASSPORT', 'VOTER_ID']

// Fixed key per user + document (id-photo / selfie), same overwrite-in-place
// pattern as the avatars bucket — a resubmission replaces the old file
// rather than accumulating orphans, and matches Verification.userId being
// @unique on the model.
async function uploadDoc(userId: string, field: 'id-photo' | 'selfie', image: { buffer: Buffer; type: string }) {
  const path = `${userId}/${field}.jpg`
  const { error } = await supabaseAdmin.storage
    .from(VERIFICATION_DOCS_BUCKET)
    .upload(path, image.buffer, { contentType: image.type, upsert: true })
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
    // Only a real approval stops a new one being sent: an approved document
    // nobody is recorded as reviewing does not count (lib/hostId.ts), and its
    // owner must be able to send their ID properly
    const existing = await db.verification.findUnique({ where: { userId: sessionUser.id } })
    if (hostIdApproved({ isVerified: sessionUser.isVerified, verification: existing })) {
      return NextResponse.json({ error: 'Your ID has already been checked' }, { status: 409 })
    }

    // What the files really are, from their first bytes, not what the upload says
    const idImage = await readImage(idPhoto)
    const selfieImage = selfie instanceof File ? await readImage(selfie) : null
    if (!idImage || (selfie instanceof File && !selfieImage)) {
      return NextResponse.json({ error: NOT_AN_IMAGE }, { status: 400 })
    }

    let idPhotoUrl: string
    let selfieUrl: string | null = null
    try {
      idPhotoUrl = await uploadDoc(sessionUser.id, 'id-photo', idImage)
      if (selfieImage) {
        selfieUrl = await uploadDoc(sessionUser.id, 'selfie', selfieImage)
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

    notify('verification.submitted', { verificationId: verification.id })

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

/** Trust points an approved ID is worth. Given once on approval, taken back once if it is removed. */
const ID_TRUST_POINTS = 40

/**
 * PATCH /api/verifications — ADMIN only
 *   { verificationId, status: 'APPROVED', notes? }   approve an ID waiting for review
 *   { verificationId, status: 'REJECTED', notes }    reject one waiting for review, or
 *                                                    remove an approval already given
 *
 * This is the only way an ID becomes approved, and with it the only way a
 * host becomes payable (lib/hostId.ts): the admin signed in is recorded as
 * the reviewer. Approving is only possible from PENDING, so it cannot be done
 * twice. Removing an approval needs a note, turns the "ID checked" badge off
 * and holds the host's payouts again.
 */
export async function PATCH(req: Request) {
  try {
    const { user, error } = await requireAdmin()
    if (error) return error

    const body = await req.json().catch(() => ({}))
    const { verificationId, status } = body
    const notes = typeof body.notes === 'string' ? manyLines(body.notes).slice(0, 1000) : ''

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Status must be APPROVED or REJECTED' }, { status: 400 })
    }
    if (typeof verificationId !== 'string') {
      return NextResponse.json({ error: 'verificationId is required' }, { status: 400 })
    }

    const current = await db.verification.findUnique({
      where: { id: verificationId },
      select: { id: true, userId: true, status: true, user: { select: { isVerified: true, trustScore: true } } },
    })
    if (!current) return NextResponse.json({ error: 'That ID submission was not found' }, { status: 404 })

    if (status === 'APPROVED' && current.status !== 'PENDING') {
      return NextResponse.json({ error: 'Only an ID that is waiting for review can be approved' }, { status: 409 })
    }
    if (status === 'REJECTED' && current.status === 'REJECTED') {
      return NextResponse.json({ error: 'This ID has already been rejected' }, { status: 409 })
    }
    // Taking back an approval already given needs a reason on the record
    if (status === 'REJECTED' && current.status === 'APPROVED' && !notes) {
      return NextResponse.json({ error: 'A note saying why is needed to remove an approval' }, { status: 400 })
    }

    const verification = await db.$transaction(async (tx) => {
      // The status is checked again in the write, so two admins deciding at
      // the same moment cannot both take effect
      const changed = await tx.verification.updateMany({
        where: { id: current.id, status: current.status },
        data: { status, reviewedById: user.id, notes: notes || null },
      })
      if (changed.count === 0) return null

      if (status === 'APPROVED') {
        await tx.user.update({
          where: { id: current.userId },
          data: { isVerified: true, trustScore: { increment: ID_TRUST_POINTS } },
        })
      } else if (current.user.isVerified) {
        // The badge goes, and the points it brought go with it (never below zero)
        await tx.user.update({
          where: { id: current.userId },
          data: { isVerified: false, trustScore: Math.max(0, current.user.trustScore - ID_TRUST_POINTS) },
        })
      }
      return tx.verification.findUnique({ where: { id: current.id } })
    })
    if (!verification) {
      return NextResponse.json({ error: 'This ID was decided a moment ago. Refresh and look again.' }, { status: 409 })
    }

    notify('verification.decided', { verificationId: verification.id })

    return NextResponse.json({ verification })
  } catch (error) {
    console.error('Verification PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update verification' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { supabaseAdmin, DISPUTE_EVIDENCE_BUCKET } from '@/lib/supabase'
import { EVIDENCE_TYPES, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_PER_SIDE, OPEN_DISPUTE_STATUSES } from '@/lib/disputes'

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/**
 * POST /api/disputes/[id]/evidence  (multipart form, field "photos")
 * The guest or the host of the booking attaches photos to a dispute while it
 * is open. Up to MAX_EVIDENCE_PER_SIDE each, images only, 5MB each. Files go
 * into a private bucket; they are only ever read through short-lived signed
 * links handed to the two parties and admins.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    const { id } = await params
    const dispute = await db.dispute.findUnique({
      where: { id },
      include: { booking: { select: { guestId: true, hostId: true } }, evidence: { select: { uploadedById: true } } },
    })
    if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 })
    if (user.id !== dispute.booking.guestId && user.id !== dispute.booking.hostId) {
      return NextResponse.json({ error: 'Only the guest or the host of this booking can add photos' }, { status: 403 })
    }
    if (!OPEN_DISPUTE_STATUSES.includes(dispute.status)) {
      return NextResponse.json({ error: 'This dispute has already been decided, so photos can no longer be added' }, { status: 409 })
    }

    const form = await req.formData()
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
    if (files.length === 0) return NextResponse.json({ error: 'Choose at least one photo' }, { status: 400 })

    const mine = dispute.evidence.filter((e) => e.uploadedById === user.id).length
    if (mine + files.length > MAX_EVIDENCE_PER_SIDE) {
      return NextResponse.json(
        { error: `You can add at most ${MAX_EVIDENCE_PER_SIDE} photos (${mine} already added)` },
        { status: 400 },
      )
    }
    // Check every file before uploading any, so a bad one leaves nothing behind
    for (const file of files) {
      if (!EVIDENCE_TYPES.includes(file.type)) {
        return NextResponse.json({ error: 'Photos must be JPEG, PNG or WebP images' }, { status: 400 })
      }
      if (file.size > MAX_EVIDENCE_BYTES) {
        return NextResponse.json({ error: 'Each photo can be at most 5MB' }, { status: 400 })
      }
    }

    const added: string[] = []
    for (const file of files) {
      const path = `${id}/${user.id}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`
      const buffer = Buffer.from(await file.arrayBuffer())
      const { error } = await supabaseAdmin.storage
        .from(DISPUTE_EVIDENCE_BUCKET)
        .upload(path, buffer, { contentType: file.type, upsert: false })
      if (error) {
        console.error('[Dispute evidence] upload failed:', error)
        return NextResponse.json({ error: 'A photo could not be uploaded. Please try again.', added: added.length }, { status: 502 })
      }
      await db.disputeEvidence.create({
        data: { disputeId: id, uploadedById: user.id, path, contentType: file.type, sizeBytes: file.size },
      })
      added.push(path)
    }

    return NextResponse.json({ added: added.length }, { status: 201 })
  } catch (error) {
    console.error('Dispute evidence error:', error)
    return NextResponse.json({ error: 'Failed to add the photos' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { supabaseAdmin, VERIFICATION_DOCS_BUCKET } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 10 * 60

/**
 * GET /api/admin/verifications — ADMIN only
 *
 * idPhotoUrl/selfieUrl are stored as private Storage paths (see
 * POST /api/verifications), not browsable URLs — sign a short-lived URL
 * per document here so the review UI can actually render them without the
 * bucket ever being public-read.
 */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const verifications = await db.verification.findMany({
      include: {
        user: {
          select: { id: true, name: true, profilePhoto: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const signed = await Promise.all(
      verifications.map(async (v) => {
        const [idPhotoSigned, selfieSigned] = await Promise.all([
          supabaseAdmin.storage.from(VERIFICATION_DOCS_BUCKET).createSignedUrl(v.idPhotoUrl, SIGNED_URL_TTL_SECONDS),
          v.selfieUrl
            ? supabaseAdmin.storage.from(VERIFICATION_DOCS_BUCKET).createSignedUrl(v.selfieUrl, SIGNED_URL_TTL_SECONDS)
            : Promise.resolve(null),
        ])
        return {
          ...v,
          idPhotoUrl: idPhotoSigned.data?.signedUrl ?? null,
          selfieUrl: selfieSigned?.data?.signedUrl ?? null,
        }
      }),
    )

    return NextResponse.json({ verifications: signed })
  } catch (error) {
    console.error('Admin verifications GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 })
  }
}

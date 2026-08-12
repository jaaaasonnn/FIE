import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { supabaseAdmin, AVATARS_BUCKET } from '@/lib/supabase'

const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * POST /api/users/me/photo
 * Auth required. Uploads a new profile photo to Supabase Storage and stamps
 * the resulting public URL onto the session user's `profilePhoto` field.
 *
 * Every user's photo lives at a fixed key (avatars/<userId>) — re-uploading
 * overwrites it in place via upsert, so there's never an orphaned old file
 * to clean up. A cache-busting query param is appended to the stored URL so
 * existing <img> tags across the app pick up the new photo immediately
 * instead of showing a stale cached image at the same URL.
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    const form = await req.formData()
    const file = form.get('photo')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Photo must be a JPG, PNG, or WEBP image' },
        { status: 400 },
      )
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: 'Photo is too large (max 5MB)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const path = sessionUser.id

    const { error: uploadError } = await supabaseAdmin.storage
      .from(AVATARS_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: true })

    if (uploadError) {
      console.error('Supabase Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 })
    }

    const { data: publicUrlData } = supabaseAdmin.storage.from(AVATARS_BUCKET).getPublicUrl(path)
    const profilePhoto = `${publicUrlData.publicUrl}?v=${Date.now()}`

    const user = await db.user.update({
      where: { id: sessionUser.id },
      data: { profilePhoto },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        profilePhoto: true, bio: true, nationality: true, businessName: true,
        isVerified: true, isSuperhost: true,
      },
    })

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Profile photo upload error:', error)
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 })
  }
}

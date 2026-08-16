import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { supabaseAdmin, LISTING_PHOTOS_BUCKET } from '@/lib/supabase'

const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5MB — matches the bucket's own file_size_limit
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTOS_PER_LISTING = 12

function parsePhotos(value: string | null): string[] {
  if (!value) return []
  try {
    const arr = JSON.parse(value)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

async function requireOwnedListing(id: string) {
  const user = await getSessionUser()
  if (!user) return { error: NextResponse.json({ error: 'You must be signed in' }, { status: 401 }) }

  const listing = await db.listing.findUnique({ where: { id }, select: { id: true, hostId: true, photos: true } })
  if (!listing) return { error: NextResponse.json({ error: 'Listing not found' }, { status: 404 }) }
  if (listing.hostId !== user.id) {
    return { error: NextResponse.json({ error: 'You can only manage photos on your own listings' }, { status: 403 }) }
  }
  return { listing }
}

/**
 * POST /api/listings/[id]/photos
 * Auth + ownership required. Body: multipart FormData, one or more files
 * under the "photos" field. Uploads each to Supabase Storage and appends
 * the resulting public URLs to the listing's photos array — order is
 * upload order, so the first photo ever added (index 0) is the cover,
 * matching what firstPhoto()/parseJsonArray() already assume everywhere
 * else in the app.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { listing, error } = await requireOwnedListing(id)
    if (error) return error

    const form = await req.formData()
    const files = form.getAll('photos').filter((f): f is File => f instanceof File)

    if (files.length === 0) {
      return NextResponse.json({ error: 'No photos provided' }, { status: 400 })
    }

    const existing = parsePhotos(listing!.photos)
    if (existing.length + files.length > MAX_PHOTOS_PER_LISTING) {
      return NextResponse.json(
        { error: `A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos (${existing.length} already uploaded)` },
        { status: 400 },
      )
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({ error: 'Photos must be JPG, PNG, or WEBP images' }, { status: 400 })
      }
      if (file.size > MAX_PHOTO_BYTES) {
        return NextResponse.json({ error: 'Each photo must be 5MB or smaller' }, { status: 400 })
      }
    }

    const newUrls: string[] = []
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const path = `${id}/${crypto.randomUUID()}.jpg`

      const { error: uploadError } = await supabaseAdmin.storage
        .from(LISTING_PHOTOS_BUCKET)
        .upload(path, buffer, { contentType: file.type, upsert: false })

      if (uploadError) {
        console.error('Listing photo upload error:', uploadError)
        return NextResponse.json({ error: 'Failed to upload one or more photos' }, { status: 500 })
      }

      const { data: publicUrlData } = supabaseAdmin.storage.from(LISTING_PHOTOS_BUCKET).getPublicUrl(path)
      newUrls.push(publicUrlData.publicUrl)
    }

    const photos = [...existing, ...newUrls]
    await db.listing.update({ where: { id }, data: { photos: JSON.stringify(photos) } })

    return NextResponse.json({ photos })
  } catch (error) {
    console.error('Listing photos POST error:', error)
    return NextResponse.json({ error: 'Failed to upload photos' }, { status: 500 })
  }
}

/**
 * DELETE /api/listings/[id]/photos
 * Auth + ownership required. Body: { url: string } — the exact photo URL
 * to remove. Deletes the Storage object and removes it from the listing's
 * photos array in one step so the two never drift out of sync.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { listing, error } = await requireOwnedListing(id)
    if (error) return error

    const { url } = await req.json()
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

    const existing = parsePhotos(listing!.photos)
    if (!existing.includes(url)) {
      return NextResponse.json({ error: 'That photo is not on this listing' }, { status: 404 })
    }

    const marker = `/object/public/${LISTING_PHOTOS_BUCKET}/`
    const markerIndex = url.indexOf(marker)
    if (markerIndex !== -1) {
      const path = url.slice(markerIndex + marker.length)
      const { error: removeError } = await supabaseAdmin.storage.from(LISTING_PHOTOS_BUCKET).remove([path])
      if (removeError) console.error('Listing photo Storage remove error (continuing anyway):', removeError)
    }

    const photos = existing.filter((p) => p !== url)
    await db.listing.update({ where: { id }, data: { photos: JSON.stringify(photos) } })

    return NextResponse.json({ photos })
  } catch (error) {
    console.error('Listing photos DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove photo' }, { status: 500 })
  }
}

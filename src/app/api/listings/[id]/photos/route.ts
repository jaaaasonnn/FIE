import { jsonObject, unreadableBody } from '@/lib/validate'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireHost } from '@/lib/roles'
import { supabaseAdmin, LISTING_PHOTOS_BUCKET } from '@/lib/supabase'
import { clearChecks, tellCleared } from '@/lib/listingChecks'
import { NOT_AN_IMAGE, readImage } from '@/lib/imageBytes'

type PhotoChange = { ok: true; photos: string[] } | { ok: false; error: string }

/**
 * Changes the photo list and, in the same transaction, removes "Address and
 * photos checked": the photos are no longer the ones that were checked.
 *
 * `photos` is one JSON column, so a change is read, change, write. Two
 * changes at the same moment would both read the same list and the second
 * write would throw the first one's photos away. So the list is read INSIDE
 * the transaction, after a write to the listing's row: Postgres gives that
 * row to one transaction at a time, and the second waits there and then
 * reads the list the first one left.
 */
async function changePhotos(id: string, change: (current: string[]) => PhotoChange): Promise<PhotoChange> {
  let cleared: Awaited<ReturnType<typeof clearChecks>> | null = null
  const result = await db.$transaction(async (tx) => {
    // The write that makes a second change to this listing wait its turn
    const row = await tx.listing.update({ where: { id }, data: { updatedAt: new Date() }, select: { photos: true } })
    const next = change(parsePhotos(row.photos))
    if (!next.ok) return next
    await tx.listing.update({ where: { id }, data: { photos: JSON.stringify(next.photos) } })
    cleared = await clearChecks(tx, id, 'PHOTOS_CHANGED')
    return next
  })
  if (cleared) tellCleared(cleared)
  return result
}

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

// Photos are managed by the host who owns the listing, and no one else
async function requireOwnedListing(id: string) {
  const auth = await requireHost()
  if (auth.error) return { error: auth.error }
  const user = auth.user

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

    // What each file really is, from its first bytes, not what the upload
    // says. All are checked before any is stored.
    const images = []
    for (const file of files) {
      const image = await readImage(file)
      if (!image) return NextResponse.json({ error: NOT_AN_IMAGE }, { status: 400 })
      images.push(image)
    }

    const newUrls: string[] = []
    const newPaths: string[] = []
    for (const { buffer, type } of images) {
      const path = `${id}/${crypto.randomUUID()}.jpg`
      newPaths.push(path)

      const { error: uploadError } = await supabaseAdmin.storage
        .from(LISTING_PHOTOS_BUCKET)
        .upload(path, buffer, { contentType: type, upsert: false })

      if (uploadError) {
        console.error('Listing photo upload error:', uploadError)
        return NextResponse.json({ error: 'Failed to upload one or more photos' }, { status: 500 })
      }

      const { data: publicUrlData } = supabaseAdmin.storage.from(LISTING_PHOTOS_BUCKET).getPublicUrl(path)
      newUrls.push(publicUrlData.publicUrl)
    }

    // Added to the list as it stands now, not as it was read before the
    // upload: another upload may have finished in between
    const saved = await changePhotos(id, (current) => (current.length + newUrls.length > MAX_PHOTOS_PER_LISTING
      ? { ok: false, error: `A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos (${current.length} already uploaded)` }
      : { ok: true, photos: [...current, ...newUrls] }))
    if (!saved.ok) {
      // Other uploads filled the listing while these were being stored: take them out again
      const { error: removeError } = await supabaseAdmin.storage.from(LISTING_PHOTOS_BUCKET).remove(newPaths)
      if (removeError) console.error('Listing photo Storage remove error:', removeError)
      return NextResponse.json({ error: saved.error }, { status: 400 })
    }

    return NextResponse.json({ photos: saved.photos })
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

    const body = await jsonObject(req)
    if (!body) return unreadableBody()
    const { url } = body
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

    // Taken out of the list as it stands now, so a photo added at the same moment is kept
    const saved = await changePhotos(id, (current) => ({ ok: true, photos: current.filter((p) => p !== url) }))

    return NextResponse.json({ photos: saved.ok ? saved.photos : existing })
  } catch (error) {
    console.error('Listing photos DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove photo' }, { status: 500 })
  }
}

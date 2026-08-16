'use client'

import { useState } from 'react'
import { Upload, X, Loader2 } from 'lucide-react'
import { compressImage, IMAGE_MIME_TYPES } from '@/lib/image'

const MAX_PHOTOS = 12

interface ListingPhotoManagerProps {
  listingId: string
  photos: string[]
  onPhotosChange: (photos: string[]) => void
}

// Shared between the create wizard's Photos step and the edit page — both
// need the same multi-select/thumbnail/remove/cover-badge behavior against
// the same POST/DELETE /api/listings/[id]/photos endpoints, so it's built
// once here rather than duplicated per page.
export function ListingPhotoManager({ listingId, photos, onPhotosChange }: ListingPhotoManagerProps) {
  const [uploading, setUploading] = useState(false)
  const [removingUrl, setRemovingUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file later
    if (files.length === 0) return

    if (photos.length + files.length > MAX_PHOTOS) {
      setError(`A listing can have at most ${MAX_PHOTOS} photos (${photos.length} already uploaded).`)
      return
    }

    setError('')
    setUploading(true)
    try {
      const body = new FormData()
      for (const file of files) {
        if (!IMAGE_MIME_TYPES.includes(file.type)) {
          throw new Error('Please choose JPG, PNG, or WEBP images')
        }
        const compressed = await compressImage(file)
        body.append('photos', compressed, `photo.jpg`)
      }

      const res = await fetch(`/api/listings/${listingId}/photos`, { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to upload photos')

      onPhotosChange(data.photos)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photos')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(url: string) {
    setError('')
    setRemovingUrl(url)
    try {
      const res = await fetch(`/api/listings/${listingId}/photos`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to remove photo')

      onPhotosChange(data.photos)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove photo')
    } finally {
      setRemovingUrl(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B645C]">Upload up to {MAX_PHOTOS} photos. First photo is your cover image.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((url, i) => (
          <div key={url} className="relative aspect-square rounded-2xl overflow-hidden border" style={{ borderColor: '#E5E7EB' }}>
            <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
            {i === 0 && (
              <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff' }}>
                Cover
              </span>
            )}
            <button
              type="button"
              onClick={() => handleRemove(url)}
              disabled={removingUrl === url}
              aria-label="Remove photo"
              className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-60"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            >
              {removingUrl === url
                ? <Loader2 size={13} className="animate-spin" style={{ color: '#fff' }} />
                : <X size={13} style={{ color: '#fff' }} />}
            </button>
          </div>
        ))}

        {photos.length < MAX_PHOTOS && (
          <label
            className="aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all hover:border-amber-400"
            style={{ borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' }}
          >
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
            {uploading
              ? <Loader2 size={24} className="text-stone-400 mb-2 animate-spin" />
              : <Upload size={24} className="text-stone-400 mb-2" />}
            <span className="text-xs text-stone-400">{uploading ? 'Uploading…' : photos.length === 0 ? 'Cover photo' : 'Add photos'}</span>
          </label>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-[#6B645C]">JPG, PNG, or WEBP. Max 5MB each — larger photos are compressed automatically.</p>
    </div>
  )
}

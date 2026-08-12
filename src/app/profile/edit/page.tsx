'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Input, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { validateGhanaPhone } from '@/lib/utils'

type EditableUser = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: string
  profilePhoto: string | null
  bio: string | null
  nationality: string | null
  businessName: string | null
}

type FormState = {
  name: string
  phone: string
  bio: string
  nationality: string
  businessName: string
}

const MAX_RAW_PHOTO_BYTES = 15 * 1024 * 1024 // sanity cap before we even try to compress
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_DIMENSION = 1080
const JPEG_QUALITY = 0.82

// Downscales to at most MAX_DIMENSION on the long edge and re-encodes as
// JPEG, so large phone photos don't need to be manually resized before
// upload — this also normalizes everything to one predictable format.
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to compress image'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

export default function EditProfilePage() {
  const { user: sessionUser, loading: authLoading, updateUser } = useAuth()
  const router = useRouter()

  const [profile, setProfile] = useState<EditableUser | null>(null)
  const [form, setForm] = useState<FormState>({
    name: '', phone: '', bio: '', nationality: '', businessName: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!sessionUser) { setLoading(false); return }
    setLoading(true)
    fetch('/api/users/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setProfile(data.user)
          setForm({
            name: data.user.name ?? '',
            phone: data.user.phone ?? '',
            bio: data.user.bio ?? '',
            nationality: data.user.nationality ?? '',
            businessName: data.user.businessName ?? '',
          })
        }
      })
      .catch(() => setErrors({ form: 'Failed to load your profile' }))
      .finally(() => setLoading(false))
  }, [authLoading, sessionUser])

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    if (!ALLOWED_TYPES.includes(file.type)) {
      setErrors((prev) => ({ ...prev, photo: 'Please choose a JPG, PNG, or WEBP image' }))
      return
    }
    if (file.size > MAX_RAW_PHOTO_BYTES) {
      setErrors((prev) => ({ ...prev, photo: 'Photo is too large (max 15MB)' }))
      return
    }

    setErrors((prev) => ({ ...prev, photo: '' }))
    setUploadingPhoto(true)
    try {
      const compressed = await compressImage(file)

      const body = new FormData()
      body.append('photo', compressed, 'photo.jpg')

      const res = await fetch('/api/users/me/photo', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to upload photo')

      setProfile(data.user)
      updateUser({ profilePhoto: data.user.profilePhoto })
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        photo: err instanceof Error ? err.message : 'Failed to upload photo',
      }))
    } finally {
      setUploadingPhoto(false)
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (form.phone && !validateGhanaPhone(form.phone)) {
      e.phone = 'Enter a valid Ghana phone number (e.g. 0241234567)'
    }
    if (form.bio.length > 500) e.bio = 'Bio must be 500 characters or fewer'
    setErrors((prev) => ({ photo: prev.photo, ...e }))
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSuccess(false)
    if (!validate()) return

    setSaving(true)
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save changes')

      setProfile(data.user)
      updateUser({
        name: data.user.name,
        phone: data.user.phone,
      })
      setSuccess(true)
      setTimeout(() => router.push(`/profile/${data.user.id}`), 1200)
    } catch (err) {
      setErrors((prev) => ({ ...prev, form: err instanceof Error ? err.message : 'Failed to save changes' }))
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    )
  }

  if (!sessionUser || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Sign in to edit your profile</h1>
        <Link href="/auth/signin" className="px-6 py-3 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
          Sign in
        </Link>
      </div>
    )
  }

  const initials = (form.name || 'U')[0].toUpperCase()

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>Edit Profile</h1>
        <p className="text-sm text-[#6B645C] mb-6">Update how you appear to other guests and hosts on FieGH.</p>

        {errors.form && (
          <div className="p-4 rounded-xl mb-4 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
            {errors.form}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 p-4 rounded-xl mb-4 text-sm" style={{ backgroundColor: '#D1FAE5', color: '#065F46', border: '1px solid #6EE7B7' }}>
            <CheckCircle2 size={16} /> Profile updated — taking you to your profile…
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 space-y-5">
          {/* Photo */}
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              {profile.profilePhoto ? (
                <>
                  <img src={profile.profilePhoto} alt="Profile"
                    onClick={() => setLightboxOpen(true)}
                    className="w-20 h-20 rounded-2xl object-cover shadow-md cursor-pointer" />
                  <PhotoLightbox src={profile.profilePhoto} alt="Profile photo"
                    open={lightboxOpen} onOpenChange={setLightboxOpen} />
                </>
              ) : (
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-md"
                  style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                  {initials}
                </div>
              )}
              {uploadingPhoto && (
                <div className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/40">
                  <Loader2 size={20} className="animate-spin text-white" />
                </div>
              )}
              <label className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shadow-md"
                style={{ backgroundColor: 'var(--color-accent)' }}>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={handlePhotoChange} disabled={uploadingPhoto} />
                <Camera size={14} color="#fff" />
              </label>
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Profile photo</p>
              <p className="text-xs text-[#6B645C]">JPG, PNG, or WEBP. Uploads instantly — no need to resize first.</p>
              {errors.photo && <p className="mt-1 text-xs text-red-600">{errors.photo}</p>}
            </div>
          </div>

          <Input
            label="Full Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
            required
          />

          <Input
            label="Email Address"
            type="email"
            value={profile.email ?? ''}
            disabled
            className="opacity-60 cursor-not-allowed"
            hint="Email can't be changed here yet."
          />

          <Input
            label="Ghana Phone Number"
            type="tel"
            placeholder="0241 234 567"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            error={errors.phone}
            hint="Format: 024XXXXXXX or +233XXXXXXXXX"
          />

          <Textarea
            label="Bio"
            placeholder="Tell guests and hosts a little about yourself…"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            error={errors.bio}
            maxLength={500}
          />
          <p className="-mt-3 text-xs text-stone-400 text-right">{form.bio.length}/500</p>

          <Input
            label="Nationality"
            value={form.nationality}
            onChange={(e) => setForm({ ...form, nationality: e.target.value })}
          />

          {profile.role === 'HOST' && (
            <Input
              label="Business Name (optional)"
              value={form.businessName}
              onChange={(e) => setForm({ ...form, businessName: e.target.value })}
            />
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" loading={saving} className="flex-1">
              Save Changes
            </Button>
            <Link href={`/profile/${profile.id}`} className="flex-1">
              <Button type="button" variant="outline" className="w-full">Cancel</Button>
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Camera, CheckCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const ID_TYPES = [
  { value: 'GHANA_CARD', label: '🪪 Ghana Card (NIA)' },
  { value: 'PASSPORT', label: '📗 Passport' },
  { value: 'VOTER_ID', label: '🗳️ Voter ID' },
]

export default function VerifyIdPage() {
  const [idType, setIdType] = useState('GHANA_CARD')
  const [idPhoto, setIdPhoto] = useState<File | null>(null)
  const [selfie, setSelfie] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!idPhoto) return
    setLoading(true)
    await new Promise((r) => setTimeout(r, 1500)) // Simulate upload
    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: '#D1FAE5' }}>
            <CheckCircle size={40} style={{ color: '#059669' }} />
          </div>
          <h2 className="text-2xl font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>
            Verification Submitted!
          </h2>
          <p className="text-[#6B645C] mb-6 leading-relaxed">
            Your ID has been submitted for review. Our team will verify it within 24 hours.
            You can start browsing listings while we review.
          </p>
          <div className="p-4 rounded-xl mb-8 text-left"
            style={{ backgroundColor: '#FBE8BB', border: '1px solid var(--gold)' }}>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>What happens next?</p>
            <ul className="text-sm text-[#4A4540] space-y-1">
              <li>• Our team reviews your ID (usually within a few hours)</li>
              <li>• You get a ✅ Verified badge on your profile</li>
              <li>• You can then make bookings or list properties</li>
            </ul>
          </div>
          <Button onClick={() => router.push('/')} size="lg" className="w-full">
            Continue to FieGH
          </Button>
          <button
            onClick={() => router.push('/search')}
            className="mt-3 w-full py-3 text-sm font-medium text-[#6B645C] hover:text-stone-900"
          >
            Browse listings first →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-12" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--brown-dark)' }}>
            <span className="text-2xl">🪪</span>
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Verify Your Identity
          </h1>
          <p className="text-[#6B645C]">
            FieGH requires ID verification to keep the platform safe for everyone in Ghana.
          </p>
        </div>

        <div className="p-4 rounded-xl mb-8 flex items-start gap-3"
          style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <AlertCircle size={18} style={{ color: '#2563EB', flexShrink: 0, marginTop: 2 }} />
          <p className="text-sm" style={{ color: '#1E40AF' }}>
            Your ID is only used for verification and is stored securely. It is never shared with other users.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ID Type */}
          <div>
            <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>
              Select your ID type
            </p>
            <div className="grid grid-cols-1 gap-3">
              {ID_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIdType(value)}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 text-sm font-medium transition-all text-left"
                  style={
                    idType === value
                      ? { borderColor: 'var(--color-accent)', backgroundColor: '#FFF8EE', color: 'var(--color-text-primary)' }
                      : { borderColor: '#E5E7EB', backgroundColor: '#fff', color: '#6B7280' }
                  }
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
                    ${idType === value ? 'border-amber-500' : 'border-stone-300'}`}>
                    {idType === value && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                  </div>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ID Photo */}
          <div>
            <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>
              Upload a photo of your ID
            </p>
            <label
              className="block w-full border-2 border-dashed rounded-2xl p-8 cursor-pointer text-center transition-all hover:border-amber-400"
              style={{ borderColor: idPhoto ? 'var(--amber)' : '#D1D5DB', backgroundColor: idPhoto ? '#FFF8EE' : '#F9FAFB' }}
            >
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setIdPhoto(e.target.files?.[0] || null)}
              />
              {idPhoto ? (
                <>
                  <CheckCircle size={32} className="mx-auto mb-2" style={{ color: 'var(--color-accent)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{idPhoto.name}</p>
                  <p className="text-xs text-[#6B645C] mt-1">Click to change</p>
                </>
              ) : (
                <>
                  <Upload size={32} className="mx-auto mb-2 text-stone-400" />
                  <p className="text-sm font-medium text-[#4A4540]">Tap to upload ID photo</p>
                  <p className="text-xs text-stone-400 mt-1">JPG, PNG up to 10MB. Must be clear and readable.</p>
                </>
              )}
            </label>
          </div>

          {/* Selfie */}
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Take a live selfie (optional but recommended)
            </p>
            <p className="text-xs text-[#6B645C] mb-3">
              A selfie helps match you to your ID and speeds up verification.
            </p>
            <label
              className="block w-full border-2 border-dashed rounded-2xl p-6 cursor-pointer text-center transition-all hover:border-amber-400"
              style={{ borderColor: selfie ? 'var(--amber)' : '#D1D5DB', backgroundColor: selfie ? '#FFF8EE' : '#F9FAFB' }}
            >
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => setSelfie(e.target.files?.[0] || null)}
              />
              {selfie ? (
                <>
                  <CheckCircle size={28} className="mx-auto mb-2" style={{ color: 'var(--color-accent)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Selfie added ✓</p>
                </>
              ) : (
                <>
                  <Camera size={28} className="mx-auto mb-2 text-stone-400" />
                  <p className="text-sm font-medium text-[#4A4540]">Take a selfie</p>
                  <p className="text-xs text-stone-400 mt-1">Face forward, good lighting</p>
                </>
              )}
            </label>
          </div>

          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!idPhoto}>
            Submit for Verification
          </Button>

          <button
            type="button"
            onClick={() => router.push('/')}
            className="w-full text-center text-sm text-[#6B645C] hover:text-[#4A4540]"
          >
            Skip for now (you can verify later)
          </button>
        </form>
      </div>
    </div>
  )
}

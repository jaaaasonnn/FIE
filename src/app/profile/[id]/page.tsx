'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Star, MapPin, Calendar, Shield, Flag, Loader2, Pencil } from 'lucide-react'
import Link from 'next/link'
import { VerifiedBadge, SuperhostBadge, Badge } from '@/components/ui/Badge'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { useAuth } from '@/context/AuthContext'

type ProfileData = {
  id: string
  name: string | null
  role: string
  profilePhoto: string | null
  nationality: string | null
  bio: string | null
  trustScore: number
  isVerified: boolean
  isSuperhost: boolean
  memberSince: string
  avgRating: number
  totalReviews: number
  listings: Array<{
    id: string
    title: string
    photo: string | null
    priceNightly: number | null
    priceMonthly: number | null
    avgRating: number
    reviewCount: number
    rentalModes: string[]
  }>
  reviews: Array<{
    id: string
    rating: number
    comment: string
    date: string
    reviewer: string
  }>
}

function TrustRing({ score }: { score: number }) {
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const filled = (score / 100) * circumference
  const color = score >= 80 ? '#22C55E' : score >= 60 ? '#F5C06A' : '#EF4444'

  return (
    <div className="relative w-20 h-20 flex items-center justify-center">
      <svg width="80" height="80" className="-rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="5" />
        <circle cx="40" cy="40" r={radius} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${filled} ${circumference - filled}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{score}</span>
        <span className="text-xs text-stone-400">Trust</span>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { user: sessionUser } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    fetch(`/api/users/${id}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then((data) => {
        if (!data?.user) { setNotFound(true); return }
        setProfile(data.user)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading profile…</p>
        </div>
      </div>
    )
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-5xl">🔍</div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Profile not found</h1>
        <p className="text-sm text-center" style={{ color: 'var(--color-text-secondary)' }}>
          This user doesn&apos;t exist or the link is incorrect.
        </p>
        <Link href="/" className="px-6 py-3 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
          Back to home
        </Link>
      </div>
    )
  }

  const displayName = profile.name ?? 'FieGH User'
  const memberSince = new Date(profile.memberSince).toLocaleDateString('en-GH', {
    month: 'long', year: 'numeric',
  })

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Profile header */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {profile.profilePhoto ? (
              <>
                <img src={profile.profilePhoto} alt={displayName}
                  onClick={() => setLightboxOpen(true)}
                  className="w-24 h-24 rounded-2xl object-cover flex-shrink-0 shadow-md cursor-pointer" />
                <PhotoLightbox src={profile.profilePhoto} alt={displayName}
                  open={lightboxOpen} onOpenChange={setLightboxOpen} />
              </>
            ) : (
              <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold flex-shrink-0 shadow-md"
                style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                {displayName[0]}
              </div>
            )}

            <div className="flex-1">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {displayName}
                  </h1>
                  <div className="flex items-center gap-2 mt-1">
                    {profile.isVerified && <VerifiedBadge />}
                    {profile.isSuperhost && <SuperhostBadge />}
                    <Badge variant="gray">{profile.role}</Badge>
                  </div>
                </div>
                <TrustRing score={profile.trustScore} />
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-[#6B645C] mb-4">
                <span className="flex items-center gap-1">
                  <Star size={14} className="fill-amber-400 text-amber-400" />
                  {profile.avgRating || '—'} avg rating
                </span>
                <span className="flex items-center gap-1">
                  <Shield size={14} style={{ color: '#2563EB' }} />
                  {profile.totalReviews} reviews
                </span>
                <span className="flex items-center gap-1">
                  <Calendar size={14} />Member since {memberSince}
                </span>
                {profile.nationality && (
                  <span className="flex items-center gap-1">
                    <MapPin size={14} />🇬🇭 {profile.nationality}
                  </span>
                )}
              </div>

              {profile.bio && (
                <p className="text-sm text-[#6B645C] leading-relaxed mb-4">{profile.bio}</p>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs text-[#6B645C] mb-4">
                <div className="p-3 rounded-xl bg-stone-50">
                  <p className="text-stone-400 mb-0.5">Response rate</p>
                  <p className="font-semibold text-sm">—</p>
                </div>
                <div className="p-3 rounded-xl bg-stone-50">
                  <p className="text-stone-400 mb-0.5">Response time</p>
                  <p className="font-semibold text-sm">—</p>
                </div>
              </div>

              <div className="flex gap-3">
                {sessionUser?.id === profile.id ? (
                  <Link href="/profile/edit"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold"
                    style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                    <Pencil size={14} /> Edit Profile
                  </Link>
                ) : (
                  <>
                    <Link href="/dashboard/guest/messages"
                      className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                      💬 Message
                    </Link>
                    <button className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm border border-stone-200 text-[#6B645C] hover:bg-stone-50">
                      <Flag size={14} /> Report
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Listings */}
        {(profile.role === 'HOST' || profile.listings.length > 0) && (
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>
              {displayName.split(' ')[0]}&apos;s Listings
            </h2>
            {profile.listings.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No active listings yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {profile.listings.map((l) => {
                  const price = l.priceNightly ?? l.priceMonthly
                  const unit = l.priceNightly != null ? '/night' : l.priceMonthly != null ? '/month' : ''
                  return (
                    <Link key={l.id} href={`/listings/${l.id}`}
                      className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden group hover:shadow-md transition-all">
                      <div className="relative h-40 overflow-hidden bg-stone-100">
                        {l.photo && (
                          <img src={l.photo} alt={l.title}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        )}
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{l.title}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <Star size={11} className="fill-amber-400 text-amber-400" />
                            <span className="text-xs">{l.avgRating} ({l.reviewCount})</span>
                          </div>
                        </div>
                        {price != null && (
                          <p className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                            ${price}<span className="text-xs font-normal text-[#6B645C]">{unit}</span>
                          </p>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Reviews */}
        <div>
          <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            Reviews ({profile.totalReviews})
          </h2>
          {profile.reviews.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No reviews yet.</p>
          ) : (
            <div className="space-y-4">
              {profile.reviews.map((r) => (
                <div key={r.id} className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                        {r.reviewer[0]}
                      </div>
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{r.reviewer}</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: r.rating }).map((_, j) => (
                        <Star key={j} size={12} className="fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-[#6B645C]">{r.comment}</p>
                  <p className="text-xs text-stone-400 mt-2">
                    {new Date(r.date).toLocaleDateString('en-GH', { month: 'short', year: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

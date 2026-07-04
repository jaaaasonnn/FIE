import { Star, MapPin, Calendar, Shield, Flag } from 'lucide-react'
import Link from 'next/link'
import { VerifiedBadge, SuperhostBadge, Badge } from '@/components/ui/Badge'

const MOCK_PROFILE = {
  id: 'u2',
  name: 'Abena Mensah',
  photo: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=200&q=80',
  role: 'HOST',
  nationality: 'Ghanaian',
  isVerified: true,
  isSuperhost: true,
  trustScore: 92,
  memberSince: 'March 2021',
  responseRate: 98,
  responseTime: 'Within 1 hour',
  totalReviews: 89,
  avgRating: 4.9,
  bio: 'Property manager based in East Legon, Accra. I own and manage several premium apartments across Accra. I love welcoming guests from all over the world and the diaspora to Ghana. Accra is a beautiful city and I want every guest to experience it at its best. 🇬🇭',
  listings: [
    { id: '1', title: 'Luxury 3BR Apt, East Legon', photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=300&q=70', price: 120, unit: '/night', rating: 4.9, reviews: 47 },
    { id: '5', title: 'Furnished 2BR, Labone', photo: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=300&q=70', price: 950, unit: '/month', rating: 4.6, reviews: 31 },
  ],
  recentReviews: [
    { reviewer: 'Kofi A.', rating: 5, comment: 'Abena is an exceptional host. Very responsive and made our stay perfect!', date: 'Dec 2024' },
    { reviewer: 'Sarah M.', rating: 5, comment: 'Beautiful apartment, Abena was super helpful. Will definitely book again.', date: 'Nov 2024' },
    { reviewer: 'James O.', rating: 4, comment: 'Great host, property matched the listing. Minor issue was sorted quickly.', date: 'Oct 2024' },
  ],
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
        <span className="text-lg font-bold" style={{ color: 'var(--brown-dark)', fontFamily: 'Playfair Display, serif' }}>{score}</span>
        <span className="text-xs text-stone-400">Trust</span>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--cream)' }}>
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Profile header */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <img src={MOCK_PROFILE.photo} alt={MOCK_PROFILE.name}
              className="w-24 h-24 rounded-2xl object-cover flex-shrink-0 shadow-md" />

            <div className="flex-1">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: 'var(--brown-dark)', fontFamily: 'Playfair Display, serif' }}>
                    {MOCK_PROFILE.name}
                  </h1>
                  <div className="flex items-center gap-2 mt-1">
                    {MOCK_PROFILE.isVerified && <VerifiedBadge />}
                    {MOCK_PROFILE.isSuperhost && <SuperhostBadge />}
                    <Badge variant="gray">{MOCK_PROFILE.role}</Badge>
                  </div>
                </div>
                <TrustRing score={MOCK_PROFILE.trustScore} />
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-stone-500 mb-4">
                <span className="flex items-center gap-1"><Star size={14} className="fill-amber-400 text-amber-400" />{MOCK_PROFILE.avgRating} avg rating</span>
                <span className="flex items-center gap-1"><Shield size={14} style={{ color: '#2563EB' }} />{MOCK_PROFILE.totalReviews} reviews</span>
                <span className="flex items-center gap-1"><Calendar size={14} />Member since {MOCK_PROFILE.memberSince}</span>
                <span className="flex items-center gap-1"><MapPin size={14} />🇬🇭 {MOCK_PROFILE.nationality}</span>
              </div>

              <p className="text-sm text-stone-600 leading-relaxed mb-4">{MOCK_PROFILE.bio}</p>

              <div className="grid grid-cols-2 gap-3 text-xs text-stone-600 mb-4">
                <div className="p-3 rounded-xl bg-stone-50">
                  <p className="text-stone-400 mb-0.5">Response rate</p>
                  <p className="font-semibold text-sm">{MOCK_PROFILE.responseRate}%</p>
                </div>
                <div className="p-3 rounded-xl bg-stone-50">
                  <p className="text-stone-400 mb-0.5">Response time</p>
                  <p className="font-semibold text-sm">{MOCK_PROFILE.responseTime}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Link href="/dashboard/guest/messages"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold"
                  style={{ backgroundColor: 'var(--amber)', color: '#fff' }}>
                  💬 Message
                </Link>
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm border border-stone-200 text-stone-600 hover:bg-stone-50">
                  <Flag size={14} /> Report
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Listings */}
        {MOCK_PROFILE.role === 'HOST' && (
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--brown-dark)' }}>
              {MOCK_PROFILE.name.split(' ')[0]}'s Listings
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {MOCK_PROFILE.listings.map((l) => (
                <Link key={l.id} href={`/listings/${l.id}`}
                  className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden group hover:shadow-md transition-all">
                  <div className="relative h-40 overflow-hidden">
                    <img src={l.photo} alt={l.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  </div>
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>{l.title}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Star size={11} className="fill-amber-400 text-amber-400" />
                        <span className="text-xs">{l.rating} ({l.reviews})</span>
                      </div>
                    </div>
                    <p className="font-bold text-sm" style={{ color: 'var(--brown-dark)' }}>
                      ${l.price}<span className="text-xs font-normal text-stone-500">{l.unit}</span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Reviews */}
        <div>
          <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--brown-dark)' }}>
            Reviews ({MOCK_PROFILE.totalReviews})
          </h2>
          <div className="space-y-4">
            {MOCK_PROFILE.recentReviews.map((r, i) => (
              <div key={i} className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{ backgroundColor: 'var(--gold-light)', color: 'var(--brown-dark)' }}>
                      {r.reviewer[0]}
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--brown-dark)' }}>{r.reviewer}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: r.rating }).map((_, j) => (
                      <Star key={j} size={12} className="fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                </div>
                <p className="text-sm text-stone-600">{r.comment}</p>
                <p className="text-xs text-stone-400 mt-2">{r.date}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

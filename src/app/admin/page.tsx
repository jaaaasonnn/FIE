'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Home, Calendar, DollarSign, Shield, AlertTriangle,
  CheckCircle, XCircle, Globe, Star, Loader2,
} from 'lucide-react'
import { StatCard } from '@/components/ui/Card'
import { ScrollHintRow } from '@/components/ui/ScrollHintRow'
import { useAuth } from '@/context/AuthContext'

const TABS = ['Overview', 'Users', 'Listings', 'Bookings', 'Payments', 'Verifications', 'Reviews', 'Settings']

type AdminUser = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: string
  isVerified: boolean
  trustScore: number
  createdAt: string
}

type AdminVerification = {
  id: string
  idType: string
  idPhotoUrl: string
  status: string
  createdAt: string
  user: { id: string; name: string | null; profilePhoto: string | null }
}

type AdminListing = {
  id: string
  title: string
  host: string
  status: string
  flagged: boolean
  price: string
  region: string
}

type AdminStats = {
  totalUsers: number
  totalListings: number
  totalBookings: number
  totalRevenue: number
  platformRevenue: number
  pendingVerifications: number
  openDisputes: number
}

export default function AdminPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [activeTab, setActiveTab] = useState('Overview')
  const [exchangeRate, setExchangeRate] = useState('15.5')

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [verifications, setVerifications] = useState<AdminVerification[]>([])
  const [listings, setListings] = useState<AdminListing[]>([])
  const [tabLoading, setTabLoading] = useState(false)
  const [forbidden, setForbidden] = useState(false)

  // Role gate
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace('/login?redirect=/admin')
      return
    }
    if (user.role !== 'ADMIN') {
      setForbidden(true)
    }
  }, [user, authLoading, router])

  // Load data per tab
  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return

    async function load() {
      setTabLoading(true)
      try {
        if (activeTab === 'Overview') {
          const [statsRes, rateRes] = await Promise.all([
            fetch('/api/admin?type=stats'),
            fetch('/api/admin?type=exchange-rate'),
          ])
          if (statsRes.status === 403 || rateRes.status === 403) { setForbidden(true); return }
          const s = await statsRes.json()
          const r = await rateRes.json()
          setStats(s)
          if (r.rate != null) setExchangeRate(String(r.rate))
        } else if (activeTab === 'Users') {
          const res = await fetch('/api/admin/users')
          if (res.status === 403) { setForbidden(true); return }
          const data = await res.json()
          setUsers(Array.isArray(data.users) ? data.users : [])
        } else if (activeTab === 'Verifications') {
          const res = await fetch('/api/admin/verifications')
          if (res.status === 403) { setForbidden(true); return }
          const data = await res.json()
          setVerifications(Array.isArray(data.verifications) ? data.verifications : [])
        } else if (activeTab === 'Listings') {
          const res = await fetch('/api/admin/listings')
          if (res.status === 403) { setForbidden(true); return }
          const data = await res.json()
          setListings(Array.isArray(data.listings) ? data.listings : [])
        } else if (activeTab === 'Settings') {
          const res = await fetch('/api/admin?type=exchange-rate')
          if (res.status === 403) { setForbidden(true); return }
          const r = await res.json()
          if (r.rate != null) setExchangeRate(String(r.rate))
        }
      } catch {
        /* ignore */
      } finally {
        setTabLoading(false)
      }
    }

    load()
  }, [activeTab, user])

  async function updateRate() {
    const res = await fetch('/api/admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        type:      'update-exchange-rate',
        usdToGhs:  parseFloat(exchangeRate),
        updatedBy: user?.id,
      }),
    })
    if (!res.ok) return
    alert('Exchange rate updated')
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-5xl">🚫</div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Access denied</h1>
        <p className="text-sm text-center" style={{ color: 'var(--color-text-secondary)' }}>
          This panel is only available to users with the ADMIN role.
        </p>
        <button onClick={() => router.push('/')}
          className="px-6 py-3 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
          Go home
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <div className="hidden lg:flex flex-col w-56 flex-shrink-0 py-6 px-3"
        style={{ backgroundColor: 'var(--brown-dark)', minHeight: '100vh' }}>
        <div className="px-3 mb-8">
          <h2 className="font-bold text-lg" style={{ color: 'var(--color-accent)' }}>
            FieGH Admin
          </h2>
          <p className="text-xs mt-1" style={{ color: 'rgba(250,247,242,0.4)' }}>
            {user?.name ?? 'Admin'} · Super Admin
          </p>
        </div>
        <nav className="space-y-1">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all"
              style={{
                backgroundColor: activeTab === tab ? 'rgba(245,192,106,0.2)' : 'transparent',
                color: activeTab === tab ? 'var(--gold)' : 'rgba(250,247,242,0.6)',
                fontWeight: activeTab === tab ? 600 : 400,
              }}>
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t"
        style={{ backgroundColor: 'var(--brown-dark)', borderColor: 'rgba(245,192,106,0.2)' }}>
        <ScrollHintRow fadeColor="var(--brown-dark)">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="flex-shrink-0 px-4 py-3 text-xs transition-all"
              style={{ color: activeTab === tab ? 'var(--gold)' : 'rgba(250,247,242,0.5)' }}>
              {tab}
            </button>
          ))}
        </ScrollHintRow>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-0">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {activeTab}
              </h1>
              <p className="text-sm text-[#6B645C] mt-0.5">FieGH Platform Administration</p>
            </div>
            <div className="text-xs px-3 py-1.5 rounded-full"
              style={{ backgroundColor: 'var(--brown-dark)', color: 'var(--color-accent)' }}>
              Admin Access
            </div>
          </div>

          {tabLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          ) : (
            <>
              {activeTab === 'Overview' && (
                <div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <StatCard icon={<Users size={18} style={{ color: 'var(--color-accent)' }} />} label="Total Users" value={stats?.totalUsers ?? '—'} />
                    <StatCard icon={<Home size={18} style={{ color: '#2563EB' }} />} label="Active Listings" value={stats?.totalListings ?? '—'} />
                    <StatCard icon={<Calendar size={18} style={{ color: '#059669' }} />} label="Total Bookings" value={stats?.totalBookings ?? '—'}
                      sub={stats ? `$${Math.round(stats.totalRevenue).toLocaleString()} total value` : undefined} />
                    <StatCard icon={<DollarSign size={18} style={{ color: '#F59E0B' }} />} label="Platform Revenue" value={stats ? `$${Math.round(stats.platformRevenue).toLocaleString()}` : '—'}
                      sub="8% commission" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white p-5 rounded-2xl border border-stone-100">
                      <div className="flex items-center gap-2 mb-3">
                        <Shield size={16} style={{ color: '#2563EB' }} />
                        <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Pending Verifications</h3>
                      </div>
                      <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{stats?.pendingVerifications ?? 0}</p>
                      <p className="text-xs text-[#6B645C] mt-1">Awaiting ID review</p>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-stone-100">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle size={16} style={{ color: '#DC2626' }} />
                        <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Open Disputes</h3>
                      </div>
                      <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{stats?.openDisputes ?? 0}</p>
                      <p className="text-xs text-[#6B645C] mt-1">Require resolution</p>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-stone-100">
                      <div className="flex items-center gap-2 mb-3">
                        <Star size={16} style={{ color: '#F59E0B' }} />
                        <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Exchange Rate</h3>
                      </div>
                      <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>GH₵ {exchangeRate}</p>
                      <p className="text-xs text-[#6B645C] mt-1">Per 1 USD</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'Users' && (
                <div>
                  {users.length === 0 ? (
                    <p className="text-sm text-center py-16" style={{ color: 'var(--color-text-secondary)' }}>No users found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-stone-200">
                            {['Name', 'Role', 'Phone', 'Verified', 'Trust Score', 'Joined', 'Actions'].map((h) => (
                              <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-[#6B645C]">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((u) => (
                            <tr key={u.id} className="border-b border-stone-100 hover:bg-stone-50">
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                                    style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                                    {(u.name ?? '?')[0]}
                                  </div>
                                  <div>
                                    <span className="font-medium block" style={{ color: 'var(--color-text-primary)' }}>{u.name ?? '—'}</span>
                                    <span className="text-xs text-stone-400">{u.email ?? ''}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                <span className="px-2 py-0.5 rounded-full text-xs"
                                  style={{
                                    backgroundColor: u.role === 'ADMIN' ? '#FEF3C7' : u.role === 'HOST' ? '#EFF6FF' : '#F0FDF4',
                                    color: u.role === 'ADMIN' ? '#92400E' : u.role === 'HOST' ? '#2563EB' : '#059669',
                                  }}>
                                  {u.role}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-[#6B645C]">{u.phone ?? '—'}</td>
                              <td className="py-3 px-3">
                                {u.isVerified
                                  ? <CheckCircle size={16} style={{ color: '#059669' }} />
                                  : <XCircle size={16} style={{ color: '#9CA3AF' }} />}
                              </td>
                              <td className="py-3 px-3">
                                <span className="font-medium" style={{ color: u.trustScore >= 80 ? '#059669' : u.trustScore >= 60 ? 'var(--amber)' : '#DC2626' }}>
                                  {u.trustScore}/100
                                </span>
                              </td>
                              <td className="py-3 px-3 text-xs text-stone-400">
                                {new Date(u.createdAt).toLocaleDateString('en-GH')}
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex gap-1">
                                  <a href={`/profile/${u.id}`} className="px-2 py-1 rounded text-xs" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>View</a>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'Verifications' && (
                <div>
                  <h3 className="font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>ID Verifications</h3>
                  {verifications.length === 0 ? (
                    <p className="text-sm text-center py-16" style={{ color: 'var(--color-text-secondary)' }}>No verification requests yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {verifications.map((v) => (
                        <div key={v.id} className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="flex items-start gap-4">
                              {v.user.profilePhoto || v.idPhotoUrl ? (
                                <img src={v.user.profilePhoto || v.idPhotoUrl} alt={v.user.name ?? ''} className="w-16 h-16 rounded-xl object-cover" />
                              ) : (
                                <div className="w-16 h-16 rounded-xl flex items-center justify-center font-bold"
                                  style={{ backgroundColor: 'var(--gold-light)' }}>
                                  {(v.user.name ?? '?')[0]}
                                </div>
                              )}
                              <div>
                                <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{v.user.name ?? 'User'}</p>
                                <p className="text-sm text-[#6B645C]">{v.idType.replace('_', ' ')}</p>
                                <p className="text-xs text-stone-400">Submitted: {new Date(v.createdAt).toLocaleDateString('en-GH')}</p>
                                <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full"
                                  style={{
                                    backgroundColor: v.status === 'PENDING' ? '#FEF3C7' : v.status === 'APPROVED' ? '#D1FAE5' : '#FEE2E2',
                                    color: v.status === 'PENDING' ? '#92400E' : v.status === 'APPROVED' ? '#065F46' : '#991B1B',
                                  }}>
                                  {v.status}
                                </span>
                              </div>
                            </div>
                            {v.status === 'PENDING' && (
                              <div className="flex gap-2">
                                <button className="flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold"
                                  style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                                  <CheckCircle size={14} /> Approve
                                </button>
                                <button className="flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold"
                                  style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                                  <XCircle size={14} /> Reject
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'Listings' && (
                <div>
                  {listings.length === 0 ? (
                    <p className="text-sm text-center py-16" style={{ color: 'var(--color-text-secondary)' }}>No listings found.</p>
                  ) : (
                    <div className="space-y-3">
                      {listings.map((l) => (
                        <div key={l.id} className="bg-white p-4 rounded-2xl border shadow-sm"
                          style={{ borderColor: l.flagged ? '#FCA5A5' : '#F3F4F6' }}>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{l.title}</h4>
                                {l.flagged && (
                                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                                    style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                                    <AlertTriangle size={10} /> Inactive
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[#6B645C]">Host: {l.host} · {l.region} · {l.price}</p>
                            </div>
                            <div className="flex gap-2">
                              <a href={`/listings/${l.id}`} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                                style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>View</a>
                              <span className="px-3 py-1.5 rounded-full text-xs font-semibold"
                                style={{
                                  backgroundColor: l.status === 'ACTIVE' ? '#D1FAE5' : '#F3F4F6',
                                  color: l.status === 'ACTIVE' ? '#065F46' : '#6B7280',
                                }}>
                                {l.status}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(activeTab === 'Bookings' || activeTab === 'Payments' || activeTab === 'Reviews') && (
                <p className="text-sm text-center py-16" style={{ color: 'var(--color-text-secondary)' }}>
                  This tab will be wired to real data in a follow-up.
                </p>
              )}

              {activeTab === 'Settings' && (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-stone-100">
                    <div className="flex items-center gap-2 mb-4">
                      <Globe size={18} style={{ color: 'var(--color-accent)' }} />
                      <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Exchange Rate</h3>
                    </div>
                    <p className="text-sm text-[#6B645C] mb-4">
                      Set the USD to GHS exchange rate used across the platform. Update this weekly.
                    </p>
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="text-xs text-[#6B645C] block mb-1">1 USD = ? GHS</label>
                        <input
                          type="number"
                          value={exchangeRate}
                          onChange={(e) => setExchangeRate(e.target.value)}
                          step="0.1"
                          className="w-full text-sm p-3 rounded-xl border border-stone-200 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <button onClick={updateRate} className="px-5 py-3 rounded-xl text-sm font-semibold"
                        style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                        Update Rate
                      </button>
                    </div>
                    <p className="text-xs text-stone-400 mt-2">
                      Current: $1 = GH₵ {exchangeRate}
                    </p>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-stone-100">
                    <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Platform Fees</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-4 rounded-xl" style={{ backgroundColor: '#FFF8EE' }}>
                        <p className="text-[#6B645C] text-xs mb-1">Guest Service Fee</p>
                        <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>12%</p>
                        <p className="text-xs text-stone-400">Added to listing price</p>
                      </div>
                      <div className="p-4 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
                        <p className="text-[#6B645C] text-xs mb-1">Host Commission</p>
                        <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>8%</p>
                        <p className="text-xs text-stone-400">Deducted from payout</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

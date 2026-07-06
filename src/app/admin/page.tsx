'use client'

import { useState } from 'react'
import {
  Users, Home, Calendar, DollarSign, Shield, AlertTriangle,
  CheckCircle, XCircle, TrendingUp, BarChart3, Globe, Star
} from 'lucide-react'
import { StatCard } from '@/components/ui/Card'

const TABS = ['Overview', 'Users', 'Listings', 'Bookings', 'Payments', 'Verifications', 'Reviews', 'Settings']

const MOCK_USERS = [
  { id: 'u1', name: 'Kwame Asante', role: 'GUEST', phone: '+233241234567', verified: false, trustScore: 65, joined: '2024-11-01', status: 'ACTIVE' },
  { id: 'u2', name: 'Abena Mensah', role: 'HOST', phone: '+233551234567', verified: true, trustScore: 92, joined: '2021-03-15', status: 'ACTIVE' },
  { id: 'u3', name: 'Kojo Boateng', role: 'GUEST', phone: '+233271234567', verified: true, trustScore: 78, joined: '2024-08-20', status: 'SUSPENDED' },
]

const MOCK_VERIFICATIONS = [
  { id: 'v1', user: 'Kwame Asante', idType: 'GHANA_CARD', submitted: '2024-12-01', status: 'PENDING', photo: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=100&q=70' },
  { id: 'v2', user: 'Ama Boateng', idType: 'PASSPORT', submitted: '2024-11-28', status: 'PENDING', photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=70' },
]

const MOCK_LISTINGS_ADMIN = [
  { id: '1', title: 'Luxury 3BR, East Legon', host: 'Abena Mensah', status: 'ACTIVE', flagged: false, price: '$120/night', region: 'Greater Accra' },
  { id: '9', title: 'Cheap Room, Unknown Area', host: 'Anonymous Host', status: 'PENDING_REVIEW', flagged: true, price: '$15/night', region: 'Greater Accra' },
]

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('Overview')
  const [exchangeRate, setExchangeRate] = useState('15.5')

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <div className="hidden lg:flex flex-col w-56 flex-shrink-0 py-6 px-3"
        style={{ backgroundColor: 'var(--brown-dark)', minHeight: '100vh' }}>
        <div className="px-3 mb-8">
          <h2 className="font-bold text-lg" style={{ color: 'var(--color-accent)' }}>
            FieGH Admin
          </h2>
          <p className="text-xs mt-1" style={{ color: 'rgba(250,247,242,0.4)' }}>Super Admin Panel</p>
        </div>
        <nav className="space-y-1">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all"
              style={{
                backgroundColor: activeTab === tab ? 'rgba(245,192,106,0.2)' : 'transparent',
                color: activeTab === tab ? 'var(--gold)' : 'rgba(250,247,242,0.6)',
                fontWeight: activeTab === tab ? 600 : 400
              }}>
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t"
        style={{ backgroundColor: 'var(--brown-dark)', borderColor: 'rgba(245,192,106,0.2)' }}>
        <div className="flex overflow-x-auto">
          {TABS.slice(0, 5).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="flex-shrink-0 px-4 py-3 text-xs transition-all"
              style={{ color: activeTab === tab ? 'var(--gold)' : 'rgba(250,247,242,0.5)' }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-0">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {activeTab}
              </h1>
              <p className="text-sm text-[#6B645C] mt-0.5">FieGH Platform Administration 🇬🇭</p>
            </div>
            <div className="text-xs px-3 py-1.5 rounded-full"
              style={{ backgroundColor: 'var(--brown-dark)', color: 'var(--color-accent)' }}>
              Admin Access
            </div>
          </div>

          {activeTab === 'Overview' && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard icon={<Users size={18} style={{ color: 'var(--color-accent)' }} />} label="Total Users" value="1,247" sub="+38 this week" />
                <StatCard icon={<Home size={18} style={{ color: '#2563EB' }} />} label="Active Listings" value="342" sub="18 pending review" />
                <StatCard icon={<Calendar size={18} style={{ color: '#059669' }} />} label="Total Bookings" value="2,891" sub="$142k total value" />
                <StatCard icon={<DollarSign size={18} style={{ color: '#F59E0B' }} />} label="Platform Revenue" value="$11,360" sub="8% commission" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                <div className="bg-white p-5 rounded-2xl border border-stone-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={16} style={{ color: '#2563EB' }} />
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Pending Verifications</h3>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>14</p>
                  <p className="text-xs text-[#6B645C] mt-1">Awaiting ID review</p>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-stone-100">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={16} style={{ color: '#DC2626' }} />
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Open Disputes</h3>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>3</p>
                  <p className="text-xs text-[#6B645C] mt-1">Require resolution</p>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-stone-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Star size={16} style={{ color: '#F59E0B' }} />
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Avg Platform Rating</h3>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>4.7</p>
                  <p className="text-xs text-[#6B645C] mt-1">Based on 2,891 reviews</p>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-stone-100">
                <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Top Regions by Bookings</h3>
                <div className="space-y-3">
                  {[
                    { region: 'Greater Accra', bookings: 1842, pct: 64 },
                    { region: 'Ashanti', bookings: 512, pct: 18 },
                    { region: 'Western', bookings: 201, pct: 7 },
                    { region: 'Central', bookings: 156, pct: 5 },
                    { region: 'Eastern', bookings: 180, pct: 6 },
                  ].map(({ region, bookings, pct }) => (
                    <div key={region}>
                      <div className="flex justify-between text-sm mb-1">
                        <span style={{ color: 'var(--color-text-primary)' }}>{region}</span>
                        <span className="text-[#6B645C]">{bookings.toLocaleString()} bookings</span>
                      </div>
                      <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: 'var(--color-accent)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Users' && (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200">
                      {['Name', 'Role', 'Phone', 'Verified', 'Trust Score', 'Status', 'Actions'].map((h) => (
                        <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-[#6B645C]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_USERS.map((u) => (
                      <tr key={u.id} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                              {u.name[0]}
                            </div>
                            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{u.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full text-xs"
                            style={{ backgroundColor: u.role === 'HOST' ? '#EFF6FF' : '#F0FDF4', color: u.role === 'HOST' ? '#2563EB' : '#059669' }}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[#6B645C]">{u.phone}</td>
                        <td className="py-3 px-3">
                          {u.verified ? <CheckCircle size={16} style={{ color: '#059669' }} /> : <XCircle size={16} style={{ color: '#9CA3AF' }} />}
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-medium" style={{ color: u.trustScore >= 80 ? '#059669' : u.trustScore >= 60 ? 'var(--amber)' : '#DC2626' }}>
                            {u.trustScore}/100
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full text-xs"
                            style={{ backgroundColor: u.status === 'ACTIVE' ? '#D1FAE5' : '#FEE2E2', color: u.status === 'ACTIVE' ? '#065F46' : '#991B1B' }}>
                            {u.status}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex gap-1">
                            <button className="px-2 py-1 rounded text-xs" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>View</button>
                            <button className="px-2 py-1 rounded text-xs" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                              {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'Verifications' && (
            <div>
              <h3 className="font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Pending ID Verifications</h3>
              <div className="space-y-4">
                {MOCK_VERIFICATIONS.map((v) => (
                  <div key={v.id} className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-start gap-4">
                        <img src={v.photo} alt={v.user} className="w-16 h-16 rounded-xl object-cover" />
                        <div>
                          <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{v.user}</p>
                          <p className="text-sm text-[#6B645C]">{v.idType.replace('_', ' ')}</p>
                          <p className="text-xs text-stone-400">Submitted: {new Date(v.submitted).toLocaleDateString('en-GH')}</p>
                        </div>
                      </div>
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
                    </div>
                    <div className="mt-4 p-3 rounded-xl" style={{ backgroundColor: '#F9FAFB' }}>
                      <p className="text-xs text-[#6B645C]">Click Approve to grant the Verified badge. Click Reject to notify user with reason.</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'Listings' && (
            <div>
              <div className="space-y-3">
                {MOCK_LISTINGS_ADMIN.map((l) => (
                  <div key={l.id} className="bg-white p-4 rounded-2xl border shadow-sm"
                    style={{ borderColor: l.flagged ? '#FCA5A5' : '#F3F4F6' }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{l.title}</h4>
                          {l.flagged && (
                            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                              <AlertTriangle size={10} /> Flagged
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#6B645C]">Host: {l.host} · {l.region} · {l.price}</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>Approve</button>
                        <button className="px-3 py-1.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>Reject</button>
                        <button className="px-3 py-1.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>Flag</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                  <button className="px-5 py-3 rounded-xl text-sm font-semibold"
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
        </div>
      </div>
    </div>
  )
}

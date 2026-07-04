'use client'

import { useState } from 'react'
import Link from 'next/link'
import { DollarSign, CheckCircle, Clock, Plus } from 'lucide-react'

const MOCK_PAYOUTS = [
  { id: 'po1', booking: 'Kwame A. — East Legon (8 nights)', date: '2024-12-21', gross: 960, commission: 76.8, net: 883.2, method: 'MTN MoMo', momoNumber: '+233241234567', status: 'COMPLETED', ref: 'PO-2024-001' },
  { id: 'po2', booking: 'Yaw D. — East Legon (7 nights)', date: '2024-11-11', gross: 840, commission: 67.2, net: 772.8, method: 'MTN MoMo', momoNumber: '+233241234567', status: 'COMPLETED', ref: 'PO-2024-002' },
  { id: 'po3', booking: 'Ama B. — Labone (3 months)', date: '2026-01-02', gross: 2850, commission: 228, net: 2622, method: 'MTN MoMo', momoNumber: '+233241234567', status: 'PROCESSING', ref: 'PO-2026-001' },
]

const STATUS_UI: Record<string, { bg: string; color: string; label: string; icon: React.ReactNode }> = {
  COMPLETED: { bg: '#D1FAE5', color: '#065F46', label: 'Paid Out', icon: <CheckCircle size={13} /> },
  PROCESSING: { bg: '#FEF3C7', color: '#92400E', label: 'Processing', icon: <Clock size={13} /> },
  PENDING: { bg: '#F3F4F6', color: '#6B7280', label: 'Pending', icon: <Clock size={13} /> },
}

export default function HostPayoutsPage() {
  const [addingMethod, setAddingMethod] = useState(false)
  const [payoutMethod, setPayoutMethod] = useState('MOMO')
  const totalEarned = MOCK_PAYOUTS.filter((p) => p.status === 'COMPLETED').reduce((s, p) => s + p.net, 0)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--cream)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <DollarSign size={22} style={{ color: 'var(--gold)' }} />
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'Playfair Display, serif' }}>Payouts</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>Your earnings from FieGH</p>
            </div>
          </div>
          <Link href="/dashboard/host" className="text-sm px-4 py-2 rounded-full"
            style={{ backgroundColor: 'rgba(245,192,106,0.2)', color: 'var(--gold)', border: '1px solid rgba(245,192,106,0.3)' }}>
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Earned', value: `$${totalEarned.toLocaleString()}`, sub: `≈ GH₵ ${(totalEarned * 15.5).toLocaleString()}`, color: 'var(--amber)' },
            { label: 'This Month', value: '$2,622', sub: '1 payout pending', color: '#2563EB' },
            { label: 'Commission Paid', value: `$${MOCK_PAYOUTS.reduce((s, p) => s + p.commission, 0).toFixed(0)}`, sub: '8% platform fee', color: '#6B7280' },
            { label: 'Avg per Booking', value: '$828', sub: 'Based on 4 payouts', color: '#059669' },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="bg-white p-4 rounded-2xl border border-stone-100 text-center">
              <p className="text-xs text-stone-500 mb-1">{label}</p>
              <p className="text-lg font-bold" style={{ color, fontFamily: 'Playfair Display, serif' }}>{value}</p>
              <p className="text-xs text-stone-400 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* Payout method */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold" style={{ color: 'var(--brown-dark)' }}>Payout Method</h3>
            <button onClick={() => setAddingMethod(!addingMethod)}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--gold-light)', color: 'var(--brown-dark)' }}>
              <Plus size={12} /> Add / Change
            </button>
          </div>

          {/* Current method */}
          <div className="flex items-center gap-3 p-3 rounded-xl"
            style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
            <span className="text-2xl">📱</span>
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>MTN Mobile Money</p>
              <p className="text-xs text-stone-500">+233 24 123 4567 · Primary</p>
            </div>
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>Active</span>
          </div>

          {/* Add method form */}
          {addingMethod && (
            <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
              <p className="text-sm font-medium" style={{ color: 'var(--brown-dark)' }}>Add Payout Method</p>
              <div className="flex gap-2">
                {['MOMO', 'BANK'].map((m) => (
                  <button key={m} onClick={() => setPayoutMethod(m)}
                    className="flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all"
                    style={{ borderColor: payoutMethod === m ? 'var(--amber)' : '#E5E7EB', backgroundColor: payoutMethod === m ? '#FFF8EE' : '#fff', color: payoutMethod === m ? 'var(--amber)' : '#6B7280' }}>
                    {m === 'MOMO' ? '📱 MoMo' : '🏦 Bank'}
                  </button>
                ))}
              </div>
              {payoutMethod === 'MOMO' && (
                <div className="space-y-3">
                  <select className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400">
                    <option value="">Select MoMo Network</option>
                    <option value="MTN">MTN Mobile Money</option>
                    <option value="VODAFONE">Vodafone Cash</option>
                    <option value="AIRTELTIGO">AirtelTigo Money</option>
                  </select>
                  <input placeholder="MoMo number (e.g. 0241234567)"
                    className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                </div>
              )}
              {payoutMethod === 'BANK' && (
                <div className="space-y-3">
                  <input placeholder="Bank name (e.g. GCB Bank, Ecobank)" className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                  <input placeholder="Account number" className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                  <input placeholder="Account name (as on bank record)" className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                </div>
              )}
              <button className="w-full py-3 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: 'var(--amber)', color: '#fff' }}>
                Save Payout Method
              </button>
            </div>
          )}
        </div>

        {/* Payout history */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="font-bold" style={{ color: 'var(--brown-dark)' }}>Payout History</h3>
          </div>
          <div className="divide-y divide-stone-50">
            {MOCK_PAYOUTS.map((p) => {
              const s = STATUS_UI[p.status]
              return (
                <div key={p.id} className="px-5 py-4 hover:bg-stone-50 transition-all">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>{p.booking}</p>
                      <p className="text-xs text-stone-500 mt-0.5">{p.method} · {new Date(p.date).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      <p className="text-xs text-stone-400 mt-0.5">Ref: {p.ref}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-sm" style={{ color: '#059669' }}>+${p.net.toLocaleString()}</p>
                      <p className="text-xs text-stone-400">(−${p.commission.toFixed(0)} commission)</p>
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full mt-1"
                        style={{ backgroundColor: s.bg, color: s.color }}>
                        {s.icon} {s.label}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4 p-4 rounded-xl text-sm"
          style={{ backgroundColor: '#FFF8EE', border: '1px solid var(--gold)', color: 'var(--brown-dark)' }}>
          💡 <strong>Payout schedule:</strong> Short stay payments are released 24 hours after guest check-in. Monthly and long-term payments are released on the agreed date. All amounts are in USD and converted at the current rate.
        </div>
      </div>
    </div>
  )
}

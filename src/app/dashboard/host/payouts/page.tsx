'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { DollarSign, CheckCircle, Clock, Plus, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

type ApiPayout = {
  id: string
  amount: number
  currency: string
  method: string
  momoNetwork: string | null
  momoNumber: string | null
  bankName: string | null
  status: string
  reference: string | null
  createdAt: string
}

const STATUS_UI: Record<string, { bg: string; color: string; label: string; icon: React.ReactNode }> = {
  COMPLETED:  { bg: '#D1FAE5', color: '#065F46', label: 'Paid Out',   icon: <CheckCircle size={13} /> },
  PROCESSING: { bg: '#FEF3C7', color: '#92400E', label: 'Processing', icon: <Clock size={13} /> },
  PENDING:    { bg: '#F3F4F6', color: '#6B7280', label: 'Pending',    icon: <Clock size={13} /> },
  FAILED:     { bg: '#FEE2E2', color: '#991B1B', label: 'Failed',     icon: <Clock size={13} /> },
}

function methodLabel(p: ApiPayout): string {
  if (p.method === 'MOMO') {
    if (p.momoNetwork === 'MTN') return 'MTN MoMo'
    if (p.momoNetwork === 'VODAFONE') return 'Vodafone Cash'
    if (p.momoNetwork === 'AIRTELTIGO') return 'AirtelTigo Money'
    return 'Mobile Money'
  }
  if (p.method === 'BANK_TRANSFER') return p.bankName ? `Bank — ${p.bankName}` : 'Bank Transfer'
  return p.method
}

export default function HostPayoutsPage() {
  const { user, loading: authLoading } = useAuth()
  const [payouts, setPayouts] = useState<ApiPayout[]>([])
  const [loading, setLoading] = useState(true)
  const [addingMethod, setAddingMethod] = useState(false)
  const [payoutMethod, setPayoutMethod] = useState('MOMO')

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setPayouts([])
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/payouts?hostId=${user.id}`)
      .then((r) => r.json())
      .then((data) => setPayouts(Array.isArray(data.payouts) ? data.payouts : []))
      .catch(() => setPayouts([]))
      .finally(() => setLoading(false))
  }, [user, authLoading])

  const completed = payouts.filter((p) => p.status === 'COMPLETED')
  const totalEarned = completed.reduce((s, p) => s + p.amount, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const thisMonth = payouts
    .filter((p) => new Date(p.createdAt) >= monthStart && p.status !== 'FAILED')
    .reduce((s, p) => s + p.amount, 0)
  const pendingCount = payouts.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').length
  const avg = completed.length ? totalEarned / completed.length : 0

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <DollarSign size={22} style={{ color: 'var(--color-accent)' }} />
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>Payouts</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>Your earnings from FieGH</p>
            </div>
          </div>
          <Link href="/dashboard/host" className="text-sm px-4 py-2 rounded-full"
            style={{ backgroundColor: 'rgba(245,192,106,0.2)', color: 'var(--color-accent)', border: '1px solid rgba(245,192,106,0.3)' }}>
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {loading || authLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading payouts…</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {[
                {
                  label: 'Total Earned',
                  value: `$${totalEarned.toLocaleString()}`,
                  sub: `≈ GH₵ ${(totalEarned * 15.5).toLocaleString()}`,
                  color: 'var(--color-accent)',
                },
                {
                  label: 'This Month',
                  value: `$${thisMonth.toLocaleString()}`,
                  sub: pendingCount ? `${pendingCount} payout pending` : 'No pending payouts',
                  color: '#2563EB',
                },
                {
                  label: 'Payouts',
                  value: String(payouts.length),
                  sub: `${completed.length} completed`,
                  color: '#6B7280',
                },
                {
                  label: 'Avg per Payout',
                  value: completed.length ? `$${avg.toFixed(0)}` : '$0',
                  sub: completed.length ? `Based on ${completed.length} payouts` : 'No payouts yet',
                  color: '#059669',
                },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="bg-white p-4 rounded-2xl border border-stone-100 text-center">
                  <p className="text-xs text-[#6B645C] mb-1">{label}</p>
                  <p className="text-lg font-bold" style={{ color }}>{value}</p>
                  <p className="text-xs text-stone-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Payout method */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Payout Method</h3>
                <button onClick={() => setAddingMethod(!addingMethod)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium"
                  style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                  <Plus size={12} /> Add / Change
                </button>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl"
                style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                <span className="text-2xl">📱</span>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>MTN Mobile Money</p>
                  <p className="text-xs text-[#6B645C]">
                    {user?.phone ? `${user.phone} · Primary` : 'Add a MoMo number to receive payouts'}
                  </p>
                </div>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>Active</span>
              </div>

              {addingMethod && (
                <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Add Payout Method</p>
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
                    style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                    Save Payout Method
                  </button>
                </div>
              )}
            </div>

            {/* Payout history */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-100">
                <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Payout History</h3>
              </div>
              {payouts.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="text-4xl mb-3">💸</div>
                  <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>No payouts yet</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Earnings from completed guest stays will appear here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-stone-50">
                  {payouts.map((p) => {
                    const s = STATUS_UI[p.status] ?? STATUS_UI.PENDING
                    return (
                      <div key={p.id} className="px-5 py-4 hover:bg-stone-50 transition-all">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                              Payout {p.reference ? `· ${p.reference}` : ''}
                            </p>
                            <p className="text-xs text-[#6B645C] mt-0.5">
                              {methodLabel(p)} · {new Date(p.createdAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            {p.reference && (
                              <p className="text-xs text-stone-400 mt-0.5">Ref: {p.reference}</p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold text-sm" style={{ color: '#059669' }}>
                              +${p.amount.toLocaleString()}
                            </p>
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
              )}
            </div>

            <div className="mt-4 p-4 rounded-xl text-sm"
              style={{ backgroundColor: '#FFF8EE', border: '1px solid var(--gold)', color: 'var(--color-text-primary)' }}>
              💡 <strong>Payout schedule:</strong> Short stay payments are released 24 hours after guest check-in. Monthly and long-term payments are released on the agreed date. All amounts are in USD and converted at the current rate.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

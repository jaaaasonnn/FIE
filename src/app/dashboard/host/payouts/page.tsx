'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { DollarSign, CheckCircle, Clock, Plus, Loader2, AlertTriangle, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'

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

type SavedPayoutMethod = {
  payoutMethod: string | null
  payoutMomoNetwork: string | null
  payoutMomoNumber: string | null
  payoutBankCode: string | null
  payoutBankAccountNumber: string | null
  payoutBankAccountName: string | null
  payoutMethodVerifiedAt: string | null
}

type Bank = { name: string; code: string }

type ApiNotification = {
  id: string
  type: string
  title: string
  body: string
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

function savedMethodLabel(m: SavedPayoutMethod): string {
  if (m.payoutMethod === 'MOMO') {
    const network = m.payoutMomoNetwork === 'MTN' ? 'MTN Mobile Money'
      : m.payoutMomoNetwork === 'VODAFONE' ? 'Vodafone Cash'
      : m.payoutMomoNetwork === 'AIRTELTIGO' ? 'AirtelTigo Money' : 'Mobile Money'
    return `${network} · ${m.payoutMomoNumber ?? ''}`
  }
  if (m.payoutMethod === 'BANK_TRANSFER') {
    const last4 = m.payoutBankAccountNumber?.slice(-4) ?? ''
    return `Bank account ending ${last4}`
  }
  return 'No payout method saved yet'
}

export default function HostPayoutsPage() {
  const { user, loading: authLoading } = useAuth()
  const { rate: ghsRate } = useExchangeRate()
  const [payouts, setPayouts] = useState<ApiPayout[]>([])
  const [loading, setLoading] = useState(true)
  const [addingMethod, setAddingMethod] = useState(false)

  const [savedMethod, setSavedMethod] = useState<SavedPayoutMethod | null>(null)
  const [banks, setBanks] = useState<Bank[]>([])
  const [notifications, setNotifications] = useState<ApiNotification[]>([])

  const [formMethod, setFormMethod] = useState<'MOMO' | 'BANK'>('MOMO')
  const [momoNetwork, setMomoNetwork] = useState('')
  const [momoNumber, setMomoNumber] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [bankAccountNumber, setBankAccountNumber] = useState('')
  const [password, setPassword] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')

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

    fetch('/api/users/me/payout-method')
      .then((r) => r.json())
      .then((data) => { if (data.payoutMethod) setSavedMethod(data.payoutMethod) })
      .catch(() => {})

    fetch('/api/notifications')
      .then((r) => r.json())
      .then((data) => setNotifications(Array.isArray(data.notifications) ? data.notifications : []))
      .catch(() => {})
  }, [user, authLoading])

  useEffect(() => {
    if (formMethod !== 'BANK' || banks.length > 0) return
    fetch('/api/payout-banks')
      .then((r) => r.json())
      .then((data) => setBanks(Array.isArray(data.banks) ? data.banks : []))
      .catch(() => {})
  }, [formMethod, banks.length])

  async function dismissNotification(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch {
      // Optimistic dismiss already applied
    }
  }

  async function handleSaveMethod() {
    setSaveError('')
    setSaveSuccess('')

    if (!password) {
      setSaveError('Please re-enter your password to confirm this change.')
      return
    }
    if (formMethod === 'MOMO' && (!momoNetwork || !momoNumber)) {
      setSaveError('Select a mobile money network and enter your number.')
      return
    }
    if (formMethod === 'BANK' && (!bankCode || !bankAccountNumber)) {
      setSaveError('Select a bank and enter your account number.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/users/me/payout-method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          payoutMethod: formMethod === 'MOMO' ? 'MOMO' : 'BANK_TRANSFER',
          payoutMomoNetwork: formMethod === 'MOMO' ? momoNetwork : undefined,
          payoutMomoNumber: formMethod === 'MOMO' ? momoNumber : undefined,
          payoutBankCode: formMethod === 'BANK' ? bankCode : undefined,
          payoutBankAccountNumber: formMethod === 'BANK' ? bankAccountNumber : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error || 'Failed to save payout method.')
        return
      }
      setSavedMethod(data.payoutMethod)
      setSaveSuccess(`Payout method saved — verified as ${data.payoutMethod.payoutBankAccountName}.`)
      setAddingMethod(false)
      setPassword('')
      setMomoNetwork(''); setMomoNumber(''); setBankCode(''); setBankAccountNumber('')
    } catch {
      setSaveError('Network error. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

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
        {notifications.map((n) => (
          <div key={n.id} className="mb-4 p-4 rounded-xl flex items-start gap-3"
            style={{ backgroundColor: '#FEF3C7', border: '1px solid #F59E0B' }}>
            <AlertTriangle size={18} style={{ color: '#92400E', flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: '#92400E' }}>{n.title}</p>
              <p className="text-sm mt-0.5" style={{ color: '#92400E' }}>{n.body}</p>
            </div>
            <button onClick={() => dismissNotification(n.id)} aria-label="Dismiss">
              <X size={16} style={{ color: '#92400E' }} />
            </button>
          </div>
        ))}

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
                  sub: `≈ GH₵ ${(totalEarned * ghsRate).toLocaleString()}`,
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
                <div key={label} className="soft-panel p-4 text-center">
                  <p className="text-xs text-[#6B645C] mb-1">{label}</p>
                  <p className="text-lg font-bold" style={{ color }}>{value}</p>
                  <p className="text-xs text-stone-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Payout method */}
            <div className="soft-panel p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Payout Method</h3>
                <button onClick={() => { setAddingMethod(!addingMethod); setSaveError(''); setSaveSuccess('') }}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium"
                  style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                  <Plus size={12} /> Add / Change
                </button>
              </div>

              {saveSuccess && (
                <div className="mb-4 p-3 rounded-xl text-sm" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                  ✅ {saveSuccess}
                </div>
              )}

              <div className="flex items-center gap-3 p-3 rounded-xl"
                style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                <span className="text-2xl">{savedMethod?.payoutMethod === 'BANK_TRANSFER' ? '🏦' : '📱'}</span>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                    {savedMethod?.payoutMethod ? savedMethodLabel(savedMethod) : 'No payout method saved yet'}
                  </p>
                  <p className="text-xs text-[#6B645C]">
                    {savedMethod?.payoutMethodVerifiedAt
                      ? `Verified as ${savedMethod.payoutBankAccountName}`
                      : 'Add a payout method to receive earnings'}
                  </p>
                </div>
                {savedMethod?.payoutMethodVerifiedAt && (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>Active</span>
                )}
              </div>

              {addingMethod && (
                <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Add Payout Method</p>
                  <div className="flex gap-2">
                    {(['MOMO', 'BANK'] as const).map((m) => (
                      <button key={m} onClick={() => setFormMethod(m)}
                        className="flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all"
                        style={{ borderColor: formMethod === m ? 'var(--amber)' : '#E5E7EB', backgroundColor: formMethod === m ? '#FFF8EE' : '#fff', color: formMethod === m ? 'var(--amber)' : '#6B7280' }}>
                        {m === 'MOMO' ? '📱 MoMo' : '🏦 Bank'}
                      </button>
                    ))}
                  </div>
                  {formMethod === 'MOMO' && (
                    <div className="space-y-3">
                      <select value={momoNetwork} onChange={(e) => setMomoNetwork(e.target.value)}
                        className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400">
                        <option value="">Select MoMo Network</option>
                        <option value="MTN">MTN Mobile Money</option>
                        <option value="VODAFONE">Vodafone Cash</option>
                        <option value="AIRTELTIGO">AirtelTigo Money</option>
                      </select>
                      <input value={momoNumber} onChange={(e) => setMomoNumber(e.target.value)}
                        placeholder="MoMo number (e.g. 0241234567)"
                        className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                    </div>
                  )}
                  {formMethod === 'BANK' && (
                    <div className="space-y-3">
                      <select value={bankCode} onChange={(e) => setBankCode(e.target.value)}
                        className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400">
                        <option value="">{banks.length ? 'Select your bank' : 'Loading banks…'}</option>
                        {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                      </select>
                      <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)}
                        placeholder="Account number"
                        className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                    </div>
                  )}
                  <div>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="Re-enter your password to confirm"
                      className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400" />
                    <p className="text-xs text-[#6B645C] mt-1">Required to change where your payouts are sent.</p>
                  </div>
                  {saveError && (
                    <p className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>{saveError}</p>
                  )}
                  <button onClick={handleSaveMethod} disabled={saving}
                    className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    {saving ? 'Verifying with Paystack…' : 'Save Payout Method'}
                  </button>
                </div>
              )}
            </div>

            {/* Payout history */}
            <div className="soft-panel overflow-hidden">
              <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(232, 225, 214, 0.55)' }}>
                <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Payout History</h3>
              </div>
              {payouts.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="text-4xl mb-3">💸</div>
                  <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>No payouts yet</p>
                  <p className="text-sm mt-1 max-w-sm mx-auto" style={{ color: 'var(--color-text-secondary)' }}>
                    After a guest checks in, your earnings will show up here.
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

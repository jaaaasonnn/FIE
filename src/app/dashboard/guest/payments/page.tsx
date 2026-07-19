'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CreditCard, CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

type ApiPayment = {
  id: string
  amount: number
  currency: string
  method: string
  momoNetwork: string | null
  status: string
  gatewayReference: string | null
  createdAt: string
  booking: {
    id: string
    listing: { id: string; title: string }
  }
}

const STATUS_UI: Record<string, { icon: React.ReactNode; bg: string; color: string; label: string }> = {
  SUCCESS:  { icon: <CheckCircle size={14} />, bg: '#D1FAE5', color: '#065F46', label: 'Paid' },
  PENDING:  { icon: <Clock size={14} />,       bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  FAILED:   { icon: <XCircle size={14} />,     bg: '#FEE2E2', color: '#991B1B', label: 'Failed' },
  REFUNDED: { icon: <CheckCircle size={14} />, bg: '#DBEAFE', color: '#1E40AF', label: 'Refunded' },
}

function methodLabel(method: string, momoNetwork: string | null): string {
  if (method === 'MOMO') {
    if (momoNetwork === 'MTN') return 'MTN MoMo'
    if (momoNetwork === 'VODAFONE') return 'Vodafone Cash'
    if (momoNetwork === 'AIRTELTIGO') return 'AirtelTigo Money'
    return 'Mobile Money'
  }
  if (method === 'CARD') return 'Visa Card'
  return method
}

function methodIcon(method: string): string {
  return method === 'MOMO' ? '📱' : method === 'CARD' ? '💳' : '💰'
}

export default function GuestPaymentsPage() {
  const { user, loading: authLoading } = useAuth()
  const [payments, setPayments] = useState<ApiPayment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setPayments([])
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/payments?guestId=${user.id}`)
      .then((r) => r.json())
      .then((data) => setPayments(Array.isArray(data.payments) ? data.payments : []))
      .catch(() => setPayments([]))
      .finally(() => setLoading(false))
  }, [user, authLoading])

  const total = payments.filter((p) => p.status === 'SUCCESS').reduce((s, p) => s + p.amount, 0)
  const refunds = payments.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <CreditCard size={22} style={{ color: 'var(--color-accent)' }} />
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
                Payment History
              </h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>
                All your transactions on FieGH
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Dashboard nav */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
          {[
            { href: '/dashboard/guest', label: '📋 Bookings' },
            { href: '/dashboard/guest/wishlist', label: '❤️ Wishlist' },
            { href: '/dashboard/guest/messages', label: '💬 Messages' },
            { href: '/dashboard/guest/payments', label: '💳 Payments', active: true },
          ].map(({ href, label, active }) => (
            <Link key={href} href={href} className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{ backgroundColor: active ? 'var(--brown-dark)' : '#fff', color: active ? 'var(--gold)' : '#374151', border: active ? 'none' : '1px solid #E5E7EB' }}>
              {label}
            </Link>
          ))}
        </div>

        {loading || authLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading payments…</p>
          </div>
        ) : (
          <>
            {/* Summary card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div className="bg-white p-5 rounded-2xl border border-stone-100 text-center">
                <p className="text-xs text-[#6B645C] mb-1">Total Spent</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>${total.toLocaleString()}</p>
                <p className="text-xs text-stone-400 mt-0.5">≈ GH₵ {(total * 15.5).toLocaleString()}</p>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-stone-100 text-center">
                <p className="text-xs text-[#6B645C] mb-1">Transactions</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{payments.length}</p>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-stone-100 text-center">
                <p className="text-xs text-[#6B645C] mb-1">Refunds Received</p>
                <p className="text-2xl font-bold" style={{ color: '#2563EB' }}>
                  ${refunds.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Transactions list */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-100">
                <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>All Transactions</h3>
              </div>
              {payments.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="text-4xl mb-3">💳</div>
                  <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>No payments yet</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Payments from your bookings will show up here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-stone-50">
                  {payments.map((p) => {
                    const s = STATUS_UI[p.status] ?? STATUS_UI.PENDING
                    const method = methodLabel(p.method, p.momoNetwork)
                    return (
                      <div key={p.id} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-stone-50 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                            style={{ backgroundColor: '#F9FAFB' }}>
                            {methodIcon(p.method)}
                          </div>
                          <div>
                            <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                              {p.status === 'REFUNDED' ? 'Damage Deposit (Refunded)' : 'Booking Payment'}
                            </p>
                            <p className="text-xs text-[#6B645C]">{p.booking.listing.title}</p>
                            <p className="text-xs text-stone-400">
                              {method} · {new Date(p.createdAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-sm" style={{ color: p.status === 'REFUNDED' ? '#2563EB' : 'var(--brown-dark)' }}>
                            {p.status === 'REFUNDED' ? '+' : ''} ${p.amount.toLocaleString()}
                          </p>
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full mt-1"
                            style={{ backgroundColor: s.bg, color: s.color }}>
                            {s.icon} {s.label}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Security notice */}
            <div className="mt-6 p-4 rounded-2xl flex items-start gap-3"
              style={{ backgroundColor: '#FFF8EE', border: '1px solid var(--gold)' }}>
              <span className="text-lg">🛡️</span>
              <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                All payments are processed securely via <strong>Paystack</strong>. FieGH never asks you to pay outside the app.
                If you spot an unfamiliar transaction, contact <strong>support@fiegh.com</strong> immediately.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

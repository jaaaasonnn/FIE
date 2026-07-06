import Link from 'next/link'
import { CreditCard, CheckCircle, Clock, XCircle, Download } from 'lucide-react'

const MOCK_PAYMENTS = [
  { id: 'p1', booking: 'Luxury 3BR Apt, East Legon', date: '2024-12-15', amount: 1210, currency: 'USD', method: 'MTN MoMo', status: 'SUCCESS', ref: 'FIE-b1-1702685400000', type: 'Booking Payment' },
  { id: 'p2', booking: 'Furnished 2BR, Labone', date: '2024-11-01', amount: 2850, currency: 'USD', method: 'Visa Card', status: 'SUCCESS', ref: 'FIE-b2-1698825600000', type: 'Booking Payment' },
  { id: 'p3', booking: 'Furnished 2BR, Labone', date: '2024-11-01', amount: 200, currency: 'USD', method: 'Visa Card', status: 'REFUNDED', ref: 'FIE-dep-1698825601000', type: 'Damage Deposit (Refunded)' },
]

const STATUS_UI: Record<string, { icon: React.ReactNode; bg: string; color: string; label: string }> = {
  SUCCESS: { icon: <CheckCircle size={14} />, bg: '#D1FAE5', color: '#065F46', label: 'Paid' },
  PENDING: { icon: <Clock size={14} />, bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  FAILED: { icon: <XCircle size={14} />, bg: '#FEE2E2', color: '#991B1B', label: 'Failed' },
  REFUNDED: { icon: <CheckCircle size={14} />, bg: '#DBEAFE', color: '#1E40AF', label: 'Refunded' }
}

const METHOD_ICONS: Record<string, string> = {
  'MTN MoMo': '📱', 'Vodafone Cash': '📱', 'AirtelTigo Money': '📱',
  'Visa Card': '💳', 'Mastercard': '💳'
}

export default function GuestPaymentsPage() {
  const total = MOCK_PAYMENTS.filter((p) => p.status === 'SUCCESS').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--cream)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <CreditCard size={22} style={{ color: 'var(--gold)' }} />
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

        {/* Summary card */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white p-5 rounded-2xl border border-stone-100 text-center">
            <p className="text-xs text-stone-500 mb-1">Total Spent</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--brown-dark)' }}>${total.toLocaleString()}</p>
            <p className="text-xs text-stone-400 mt-0.5">≈ GH₵ {(total * 15.5).toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-stone-100 text-center">
            <p className="text-xs text-stone-500 mb-1">Transactions</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--brown-dark)' }}>{MOCK_PAYMENTS.length}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-stone-100 text-center">
            <p className="text-xs text-stone-500 mb-1">Refunds Received</p>
            <p className="text-2xl font-bold" style={{ color: '#2563EB' }}>
              ${MOCK_PAYMENTS.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + p.amount, 0).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Transactions list */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="font-bold" style={{ color: 'var(--brown-dark)' }}>All Transactions</h3>
          </div>
          <div className="divide-y divide-stone-50">
            {MOCK_PAYMENTS.map((p) => {
              const s = STATUS_UI[p.status]
              return (
                <div key={p.id} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-stone-50 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                      style={{ backgroundColor: '#F9FAFB' }}>
                      {METHOD_ICONS[p.method] || '💰'}
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>{p.type}</p>
                      <p className="text-xs text-stone-500">{p.booking}</p>
                      <p className="text-xs text-stone-400">{p.method} · {new Date(p.date).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
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
        </div>

        {/* Security notice */}
        <div className="mt-6 p-4 rounded-2xl flex items-start gap-3"
          style={{ backgroundColor: '#FFF8EE', border: '1px solid var(--gold)' }}>
          <span className="text-lg">🛡️</span>
          <p className="text-sm" style={{ color: 'var(--brown-dark)' }}>
            All payments are processed securely via <strong>Paystack</strong>. FieGH never asks you to pay outside the app.
            If you spot an unfamiliar transaction, contact <strong>support@fiegh.com</strong> immediately.
          </p>
        </div>
      </div>
    </div>
  )
}

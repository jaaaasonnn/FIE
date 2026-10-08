'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Percent, Wallet, ShieldCheck, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { COMMISSION_PERCENT, GUEST_FEE_LINE, HOST_KEEPS_PERCENT } from '@/lib/fees'

const POINTS = [
  {
    icon: Percent,
    title: `You keep ${HOST_KEEPS_PERCENT} of the rent`,
    body: `FieGH takes a ${COMMISSION_PERCENT} commission, which comes out of your payout. ${GUEST_FEE_LINE} You see what you will earn on every booking.`,
  },
  {
    icon: Wallet,
    title: 'You need a payout method to get paid',
    body: 'Add a mobile money number or bank account from your host dashboard. Payouts cannot be sent until it is saved.',
  },
  {
    icon: ShieldCheck,
    title: 'Verifying your ID earns the Verified badge',
    body: 'It is not required to start hosting, but guests can filter for verified hosts.',
  },
]

export default function BecomeAHostPage() {
  const router = useRouter()
  const { user, loading, updateUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // This page is for guests only. Hosts already have what it offers, and
  // admin accounts cannot host.
  useEffect(() => {
    if (loading) return
    if (!user) router.replace('/login?redirect=/become-a-host')
    else if (user.role === 'HOST') router.replace('/dashboard/host')
    else if (user.role !== 'GUEST') router.replace('/')
  }, [loading, user, router])

  async function becomeHost() {
    setBusy(true)
    setError('')
    try {
      // No body: the server takes the user from the session and can only set HOST
      const res = await fetch('/api/users/me/become-host', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not switch your account to hosting. Please try again.')
        setBusy(false)
        return
      }
      // The server reads the role on every request, so only this page's copy needs updating
      updateUser({ role: 'HOST' })
      router.replace('/dashboard/host')
    } catch {
      setError('Could not reach FieGH. Check your connection and try again.')
      setBusy(false)
    }
  }

  if (loading || !user || user.role !== 'GUEST') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} aria-label="Loading" />
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 md:pt-14 pb-16 md:pb-24">
        <header className="mb-8 md:mb-10">
          <h1 className="text-[2.25rem] md:text-[3rem]" style={{ color: 'var(--color-text-primary)' }}>
            Become a host
          </h1>
          <p className="mt-3 text-base md:text-lg max-w-[60ch]" style={{ color: 'var(--color-text-secondary)' }}>
            Your account switches from guest to host. Your bookings, favourites and messages stay exactly as they are.
          </p>
        </header>

        <ul className="border-t" style={{ borderColor: 'var(--color-border)' }}>
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 py-5 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <Icon size={18} strokeWidth={1.75} aria-hidden className="mt-0.5" style={{ color: 'var(--color-accent-deep)' }} />
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>{title}</h2>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          This cannot be undone from your account. You can still book stays as a host.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={becomeHost}
            disabled={busy}
            className="pressable focus-ring inline-flex items-center justify-center gap-2 px-7 h-12 rounded-full font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-70"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
            Become a host
          </button>
          <Link
            href="/dashboard/guest"
            className="focus-ring rounded-sm text-sm font-semibold underline underline-offset-4 decoration-1 text-center"
            style={{ color: 'var(--color-accent-deep)' }}
          >
            Not now
          </Link>
        </div>
      </div>
    </div>
  )
}

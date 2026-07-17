'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

type Tab = 'login' | 'signup'

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirect     = searchParams.get('redirect') ?? ''
  const { user, loading: authLoading, signIn, signUp } = useAuth()

  const [tab, setTab] = useState<Tab>('login')

  // ── Login state ──────────────────────────────────────────────────────────
  const [loginId,  setLoginId]  = useState('')
  const [loginPw,  setLoginPw]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loginErr, setLoginErr] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)

  // ── Sign-up state ────────────────────────────────────────────────────────
  const [name,      setName]      = useState('')
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [role,      setRole]      = useState<'GUEST' | 'HOST'>('GUEST')
  const [showPw2,   setShowPw2]   = useState(false)
  const [signupErr, setSignupErr] = useState('')
  const [signupBusy, setSignupBusy] = useState(false)

  // If already logged in, redirect away
  useEffect(() => {
    if (!authLoading && user) {
      router.replace(redirect || (user.role === 'HOST' ? '/dashboard/host' : '/dashboard/guest'))
    }
  }, [authLoading, user, redirect, router])

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginErr('')
    if (!loginId || !loginPw) { setLoginErr('Please fill in all fields.'); return }
    setLoginBusy(true)
    const result = await signIn(loginId, loginPw)
    setLoginBusy(false)
    if (result.error) { setLoginErr(result.error); return }
    // Redirect handled by the useEffect above once user state updates
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setSignupErr('')
    if (!name.trim())  { setSignupErr('Full name is required.'); return }
    if (!email.trim()) { setSignupErr('Email is required.'); return }
    if (password.length < 8) { setSignupErr('Password must be at least 8 characters.'); return }
    if (password !== confirmPw) { setSignupErr('Passwords do not match.'); return }
    setSignupBusy(true)
    const result = await signUp({ name: name.trim(), email: email.trim(), password, role })
    setSignupBusy(false)
    if (result.error) { setSignupErr(result.error); return }
  }

  if (authLoading) return null // Avoid flash before session check completes

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 mb-8 group">
        <Image src="/logo.png" alt="FieGH" width={44} height={44} style={{ width: 36, height: 'auto' }} />
        <span className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>FieGH</span>
      </Link>

      {/* Card */}
      <div
        className="w-full max-w-md bg-white rounded-3xl shadow-sm border p-8"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {/* Tabs */}
        <div
          className="flex rounded-2xl p-1 mb-8 gap-1"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          {(['login', 'signup'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setLoginErr(''); setSignupErr('') }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                backgroundColor: tab === t ? '#fff' : 'transparent',
                color:           tab === t ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                boxShadow:       tab === t ? '0 1px 4px rgba(31,27,22,0.08)' : 'none',
              }}
            >
              {t === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        {/* ── Login form ─────────────────────────────────────────────────── */}
        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Email or Phone Number
              </label>
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="you@example.com or 0241234567"
                autoComplete="username"
                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all"
                style={{
                  borderColor:     'var(--color-border)',
                  backgroundColor: 'var(--color-bg)',
                  color:           'var(--color-text-primary)',
                }}
                onFocus={(e)  => (e.target.style.borderColor = 'var(--color-accent)')}
                onBlur={(e)   => (e.target.style.borderColor = 'var(--color-border)')}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all pr-11"
                  style={{
                    borderColor:     'var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color:           'var(--color-text-primary)',
                  }}
                  onFocus={(e)  => (e.target.style.borderColor = 'var(--color-accent)')}
                  onBlur={(e)   => (e.target.style.borderColor = 'var(--color-border)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {loginErr && (
              <p className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                {loginErr}
              </p>
            )}

            <button
              type="submit"
              disabled={loginBusy}
              className="w-full py-3.5 rounded-full text-sm font-bold transition-all flex items-center justify-center gap-2 mt-2"
              style={{
                backgroundColor: 'var(--color-accent)',
                color:           '#fff',
                opacity:         loginBusy ? 0.7 : 1,
              }}
            >
              {loginBusy && <Loader2 size={15} className="animate-spin" />}
              {loginBusy ? 'Signing in…' : 'Log in'}
            </button>

            <p className="text-center text-xs mt-2" style={{ color: 'var(--color-text-secondary)' }}>
              No account?{' '}
              <button type="button" onClick={() => setTab('signup')}
                className="font-semibold underline" style={{ color: 'var(--color-accent)' }}>
                Sign up free
              </button>
            </p>
          </form>
        )}

        {/* ── Sign-up form ───────────────────────────────────────────────── */}
        {tab === 'signup' && (
          <form onSubmit={handleSignup} className="space-y-4">
            {/* Role picker */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>I want to…</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'GUEST', icon: '🔍', label: 'Find a place', sub: 'Browse & book rentals' },
                  { value: 'HOST',  icon: '🏠', label: 'List my place', sub: 'Earn from your property' },
                ] as const).map(({ value, icon, label, sub }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRole(value)}
                    className="p-3.5 rounded-2xl border-2 text-left transition-all"
                    style={{
                      borderColor:     role === value ? 'var(--color-accent)' : 'var(--color-border)',
                      backgroundColor: role === value ? '#FFF8EE' : '#fff',
                    }}
                  >
                    <div className="text-xl mb-1">{icon}</div>
                    <p className="text-xs font-bold" style={{ color: 'var(--color-text-primary)' }}>{label}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{sub}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Kwame Mensah"
                autoComplete="name"
                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                onFocus={(e)  => (e.target.style.borderColor = 'var(--color-accent)')}
                onBlur={(e)   => (e.target.style.borderColor = 'var(--color-border)')}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                onFocus={(e)  => (e.target.style.borderColor = 'var(--color-accent)')}
                onBlur={(e)   => (e.target.style.borderColor = 'var(--color-border)')}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw2 ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all pr-11"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                  onFocus={(e)  => (e.target.style.borderColor = 'var(--color-accent)')}
                  onBlur={(e)   => (e.target.style.borderColor = 'var(--color-border)')}
                />
                <button type="button" onClick={() => setShowPw2(!showPw2)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-text-secondary)' }}>
                  {showPw2 ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                onFocus={(e)  => (e.target.style.borderColor = 'var(--color-accent)')}
                onBlur={(e)   => (e.target.style.borderColor = 'var(--color-border)')}
              />
            </div>

            {signupErr && (
              <p className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                {signupErr}
              </p>
            )}

            <button
              type="submit"
              disabled={signupBusy}
              className="w-full py-3.5 rounded-full text-sm font-bold transition-all flex items-center justify-center gap-2 mt-2"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff', opacity: signupBusy ? 0.7 : 1 }}
            >
              {signupBusy && <Loader2 size={15} className="animate-spin" />}
              {signupBusy ? 'Creating account…' : 'Create account'}
            </button>

            <p className="text-center text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              By creating an account you agree to our{' '}
              <Link href="/terms" className="underline">Terms</Link> and{' '}
              <Link href="/privacy" className="underline">Privacy Policy</Link>.
            </p>

            <p className="text-center text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Already have an account?{' '}
              <button type="button" onClick={() => setTab('login')}
                className="font-semibold underline" style={{ color: 'var(--color-accent)' }}>
                Log in
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

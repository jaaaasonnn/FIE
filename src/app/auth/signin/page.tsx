'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, Eye, EyeOff, Phone } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function SignInPage() {
  const [form, setForm] = useState({ identifier: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sign in failed')
      router.push('/dashboard/guest')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--cream)' }}>
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative overflow-hidden"
        style={{ backgroundColor: 'var(--brown-dark)' }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1529516548873-9ce57c8f155e?w=800&q=60')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="relative z-10 text-center max-w-sm">
          <Link href="/" className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--gold)' }}>
              <Home size={24} style={{ color: 'var(--brown-dark)' }} />
            </div>
            <span className="text-3xl font-bold" style={{ fontFamily: 'Playfair Display, serif', color: 'var(--gold)' }}>
              FieGH
            </span>
          </Link>
          <h2 className="text-3xl font-bold mb-4" style={{ color: 'var(--cream)', fontFamily: 'Playfair Display, serif' }}>
            Welcome back 🇬🇭
          </h2>
          <p className="text-base leading-relaxed" style={{ color: 'rgba(250,247,242,0.6)' }}>
            Sign in to manage your bookings, messages, and saved properties across Ghana.
          </p>
          <div className="mt-10 p-5 rounded-2xl text-left" style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(245,192,106,0.2)' }}>
            <p className="text-sm italic mb-2" style={{ color: 'var(--gold)' }}>"Fie" means home in Twi.</p>
            <p className="text-xs" style={{ color: 'rgba(250,247,242,0.5)' }}>FieGH — Your home in Ghana 🏡</p>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <Link href="/" className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--brown-dark)' }}>
              <Home size={16} style={{ color: 'var(--gold)' }} />
            </div>
            <span className="text-xl font-bold" style={{ color: 'var(--brown-dark)', fontFamily: 'Playfair Display, serif' }}>FieGH</span>
          </Link>

          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--brown-dark)' }}>Sign In</h1>
          <p className="text-stone-500 mb-8">Enter your phone number or email to continue.</p>

          {error && (
            <div className="p-4 rounded-xl mb-4 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Phone or Email"
              type="text"
              placeholder="024XXXXXXX or you@email.com"
              value={form.identifier}
              onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              leftIcon={<Phone size={16} />}
              required
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPass ? 'text' : 'password'}
                placeholder="Your password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-9 text-stone-400 hover:text-stone-600"
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded border-stone-300" />
                <span className="text-stone-600">Remember me</span>
              </label>
              <Link href="/auth/forgot-password" style={{ color: 'var(--amber)' }} className="hover:underline">
                Forgot password?
              </Link>
            </div>

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Sign In
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-stone-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 text-xs text-stone-500 bg-cream" style={{ backgroundColor: 'var(--cream)' }}>or continue with</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 p-3 rounded-xl border border-stone-200 hover:bg-stone-50 transition-all text-sm font-medium text-stone-700">
              <span>📱</span> MTN MoMo OTP
            </button>
            <button className="flex items-center justify-center gap-2 p-3 rounded-xl border border-stone-200 hover:bg-stone-50 transition-all text-sm font-medium text-stone-700">
              <span>📧</span> Email OTP
            </button>
          </div>

          <p className="text-center mt-8 text-sm text-stone-600">
            New to FieGH?{' '}
            <Link href="/auth/signup" style={{ color: 'var(--amber)' }} className="font-semibold hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

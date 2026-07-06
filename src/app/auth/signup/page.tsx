'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Home, Eye, EyeOff, User, Building } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { validateGhanaPhone } from '@/lib/utils'
import { Suspense } from 'react'

function SignUpForm() {
  const params = useSearchParams()
  const defaultRole = params.get('role') === 'host' ? 'HOST' : 'GUEST'
  const [role, setRole] = useState<'GUEST' | 'HOST'>(defaultRole as 'GUEST' | 'HOST')
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: '',
    businessName: '', nationality: 'Ghanaian'
  })
  const [showPass, setShowPass] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function validate() {
    const e: Record<string, string> = {}
    if (!form.name) e.name = 'Name is required'
    if (!form.phone && !form.email) e.phone = 'Phone or email is required'
    if (form.phone && !validateGhanaPhone(form.phone)) e.phone = 'Enter a valid Ghana phone number (e.g. 0241234567)'
    if (form.password.length < 8) e.password = 'Password must be at least 8 characters'
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, role })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sign up failed')
      router.push('/auth/verify-id')
    } catch (err: unknown) {
      setErrors({ form: err instanceof Error ? err.message : 'Sign up failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative overflow-hidden"
        style={{ backgroundColor: 'var(--brown-dark)' }}>
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1611116524765-8e7ad0c0b169?w=800&q=60')`, backgroundSize: 'cover' }} />
        <div className="relative z-10 text-center max-w-sm">
          <Link href="/" className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent)' }}>
              <Home size={24} style={{ color: 'var(--color-text-primary)' }} />
            </div>
            <span className="text-3xl font-bold" style={{ color: 'var(--color-accent)' }}>FieGH</span>
          </Link>
          <h2 className="text-3xl font-bold mb-4" style={{ color: 'var(--cream)' }}>
            Join FieGH 🇬🇭
          </h2>
          <p className="text-base leading-relaxed mb-8" style={{ color: 'rgba(250,247,242,0.6)' }}>
            Ghana's premier rental platform. Find your perfect home or start earning from your property today.
          </p>
          {['Free to join', 'Ghana Card verification', 'MoMo & card payments', 'Escrow protection'].map((f) => (
            <div key={f} className="flex items-center gap-3 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>✓</div>
              <span className="text-sm text-left" style={{ color: 'rgba(250,247,242,0.7)' }}>{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-md py-8">
          <Link href="/" className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--brown-dark)' }}>
              <Home size={16} style={{ color: 'var(--color-accent)' }} />
            </div>
            <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>FieGH</span>
          </Link>

          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Create Account</h1>
          <p className="text-[#6B645C] mb-6">Join thousands of Ghanaians on FieGH.</p>

          {/* Role toggle */}
          <div className="flex gap-2 p-1 rounded-2xl mb-6" style={{ backgroundColor: '#F0EAE0' }}>
            {[
              { val: 'GUEST', icon: User, label: 'I want to rent' },
              { val: 'HOST', icon: Building, label: 'I want to host' },
            ].map(({ val, icon: Icon, label }) => (
              <button
                key={val}
                onClick={() => setRole(val as 'GUEST' | 'HOST')}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all"
                style={
                  role === val
                    ? { backgroundColor: 'var(--brown-dark)', color: 'var(--color-accent)' }
                    : { color: 'var(--color-text-primary)' }
                }
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          {errors.form && (
            <div className="p-4 rounded-xl mb-4 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
              {errors.form}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Full Name"
              placeholder="Kwame Asante"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={errors.name}
              required
            />

            {role === 'HOST' && (
              <Input
                label="Business Name (optional)"
                placeholder="Asante Properties Ltd"
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              />
            )}

            <Input
              label="Ghana Phone Number"
              type="tel"
              placeholder="0241 234 567"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              error={errors.phone}
              hint="Format: 024XXXXXXX or +233XXXXXXXXX"
            />

            <Input
              label="Email Address (optional)"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPass ? 'text' : 'password'}
                placeholder="Min. 8 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                error={errors.password}
                required
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-9 text-stone-400">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <Input
              label="Confirm Password"
              type="password"
              placeholder="Repeat password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              error={errors.confirmPassword}
              required
            />

            <p className="text-xs text-[#6B645C]">
              By creating an account you agree to our{' '}
              <Link href="/terms" style={{ color: 'var(--color-accent)' }}>Terms of Service</Link>
              {' '}and{' '}
              <Link href="/privacy" style={{ color: 'var(--color-accent)' }}>Privacy Policy</Link>.
            </p>

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Create {role === 'HOST' ? 'Host' : 'Guest'} Account
            </Button>
          </form>

          <p className="text-center mt-6 text-sm text-[#6B645C]">
            Already have an account?{' '}
            <Link href="/auth/signin" style={{ color: 'var(--color-accent)' }} className="font-semibold hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  )
}

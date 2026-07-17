'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: string           // GUEST | HOST | ADMIN
  profilePhoto: string | null
  isVerified: boolean
  isSuperhost: boolean
}

type SignInResult  = { error?: string }
type SignUpResult  = { error?: string }

export type SignUpData = {
  name: string
  email?: string
  phone?: string
  password: string
  role: 'GUEST' | 'HOST'
}

type AuthContextType = {
  user:    AuthUser | null
  loading: boolean
  signIn:  (identifier: string, password: string) => Promise<SignInResult>
  signUp:  (data: SignUpData) => Promise<SignUpResult>
  signOut: () => Promise<void>
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Rehydrate from the HttpOnly cookie on every page load
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const signIn = useCallback(async (identifier: string, password: string): Promise<SignInResult> => {
    const res  = await fetch('/api/auth/signin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ identifier, password }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Sign in failed' }
    setUser(data.user)
    return {}
  }, [])

  const signUp = useCallback(async (signUpData: SignUpData): Promise<SignUpResult> => {
    const res  = await fetch('/api/auth/signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(signUpData),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Sign up failed' }

    // Auto sign-in immediately after successful registration
    const loginId = signUpData.email ?? signUpData.phone ?? ''
    return signIn(loginId, signUpData.password)
  }, [signIn])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/signout', { method: 'POST' })
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

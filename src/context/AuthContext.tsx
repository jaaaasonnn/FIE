'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { checkSession } from '@/lib/clientFetch'
import { LoadFailedBar } from '@/components/ui/LoadFailed'

// ── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: string           // GUEST | HOST | ADMIN
  profilePhoto: string | null
  trustScore: number
  isVerified: boolean
  isSuperhost: boolean
  /** True while the person must confirm their email before they can book, list or pay */
  mustVerifyEmail?: boolean
}

type SignInResult  = { error?: string; user?: AuthUser }
type SignUpResult  = { error?: string; user?: AuthUser }

export type SignUpData = {
  name: string
  email?: string
  phone?: string
  password: string
  role: 'GUEST' | 'HOST'
  businessName?: string
  nationality?: string
}

type AuthContextType = {
  user:    AuthUser | null
  loading: boolean
  signIn:  (identifier: string, password: string) => Promise<SignInResult>
  signUp:  (data: SignUpData) => Promise<SignUpResult>
  signOut: () => Promise<void>
  updateUser: (patch: Partial<AuthUser>) => void
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // True when the session check got no answer to go on, even after its tries
  // (lib/clientFetch.ts). The person is then neither signed in nor out:
  // `loading` stays true so no page sends them to log in, and a bar offers
  // to try again.
  const [sessionUnknown, setSessionUnknown] = useState(false)
  const [check, setCheck] = useState(0)
  const retrySession = useCallback(() => { setSessionUnknown(false); setCheck((n) => n + 1) }, [])

  // Rehydrate from the HttpOnly cookie on every page load. Only a clear 401
  // means signed out (G1): a dropped connection, a 5xx or a page that is not
  // JSON is tried again, and never taken as signed out.
  useEffect(() => {
    let current = true
    checkSession().then((found) => {
      if (!current) return
      if (found.kind === 'unknown') { setSessionUnknown(true); return }
      setUser(found.kind === 'user' ? (found.user as AuthUser) : null)
      setLoading(false)
    })
    return () => { current = false }
  }, [check])

  // Back online: try the check again by itself
  useEffect(() => {
    if (!sessionUnknown) return
    window.addEventListener('online', retrySession)
    return () => window.removeEventListener('online', retrySession)
  }, [sessionUnknown, retrySession])

  const signIn = useCallback(async (identifier: string, password: string): Promise<SignInResult> => {
    const res  = await fetch('/api/auth/signin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ identifier, password }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Sign in failed' }
    setUser(data.user)
    return { user: data.user as AuthUser }
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
    const signInResult = await signIn(loginId, signUpData.password)
    return { error: signInResult.error, user: signInResult.user }
  }, [signIn])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/signout', { method: 'POST' })
    setUser(null)
  }, [])

  // Merge a partial update into the current user — used after a successful
  // profile edit so the navbar/session state reflects changes immediately.
  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, updateUser }}>
      {children}
      {sessionUnknown && <LoadFailedBar onRetry={retrySession} />}
    </AuthContext.Provider>
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

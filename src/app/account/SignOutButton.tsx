'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

/** Log out, as the header's menu does */
export function SignOutButton() {
  const { signOut } = useAuth()
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={async () => { await signOut(); router.push('/') }}
      className="account-row w-full text-left"
    >
      <LogOut size={20} strokeWidth={1.75} aria-hidden />
      <span>Log out</span>
    </button>
  )
}

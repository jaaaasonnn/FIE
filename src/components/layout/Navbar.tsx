'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'
import { Menu, X, Search, Heart, MessageSquare, ChevronDown, LayoutDashboard, LogOut, UserCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'

export function Navbar() {
  const router = useRouter()
  const { user, loading, signOut } = useAuth()

  const [menuOpen,    setMenuOpen]    = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function handleSignOut() {
    setDropdownOpen(false)
    setMenuOpen(false)
    await signOut()
    router.push('/')
  }

  const dashboardHref = user?.role === 'HOST' ? '/dashboard/host' : '/dashboard/guest'

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        backgroundColor: 'var(--color-bg-card)',
        borderBottom: '1px solid var(--color-border)',
        boxShadow: '0 1px 8px rgba(31,27,22,0.06)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[4.25rem]">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/logo.png"
              alt="FieGH"
              width={48}
              height={48}
              style={{ width: 40, height: 'auto' }}
              priority
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[1.25rem] font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
                FieGH
              </span>
              <span
                className="text-[9px] tracking-widest uppercase hidden sm:block"
                style={{ color: 'var(--color-text-muted)', letterSpacing: '0.15em' }}
              >
                Ghana Rentals
              </span>
            </div>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-7">
            {[
              { href: '/search?mode=SHORT_STAY', label: 'Short Stay' },
              { href: '/search?mode=TEMP_STAY',  label: 'Monthly' },
              { href: '/search?mode=PERMANENT',  label: 'Long-Term' },
              { href: '/how-it-works',            label: 'How it Works' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-medium relative group transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {label}
                <span
                  className="absolute -bottom-0.5 left-0 w-0 h-[2px] rounded-full group-hover:w-full transition-all duration-300"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                />
              </Link>
            ))}
          </nav>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-1">
            {[
              { href: '/search',                   Icon: Search },
              { href: '/dashboard/guest/wishlist', Icon: Heart },
              { href: '/dashboard/guest/messages', Icon: MessageSquare },
            ].map(({ href, Icon }) => (
              <Link
                key={href}
                href={href}
                className="p-2 rounded-full transition-colors hover:bg-stone-100"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <Icon size={18} />
              </Link>
            ))}

            <div className="w-px h-5 mx-2" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Auth area — skeleton while loading, user menu or login buttons after */}
            {loading ? (
              <div className="w-24 h-9 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
            ) : user ? (
              /* Logged-in: avatar + dropdown */
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-full transition-all hover:bg-stone-50 border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {user.profilePhoto ? (
                    <img src={user.profilePhoto} alt={user.name ?? ''} className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                    >
                      {(user.name ?? 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm font-medium max-w-[96px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {user.name?.split(' ')[0]}
                  </span>
                  <ChevronDown size={14} style={{ color: 'var(--color-text-secondary)' }} />
                </button>

                {dropdownOpen && (
                  <div
                    className="absolute right-0 mt-2 w-52 rounded-2xl border shadow-lg py-1.5 z-50"
                    style={{ backgroundColor: '#fff', borderColor: 'var(--color-border)' }}
                  >
                    <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <p className="text-xs font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{user.name}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{user.email ?? user.phone}</p>
                      <span
                        className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: user.role === 'HOST' ? '#FFF8EE' : '#EFF6FF', color: user.role === 'HOST' ? 'var(--color-accent)' : '#2563EB' }}
                      >
                        {user.role === 'HOST' ? '🏠 Host' : '🔍 Guest'}
                      </span>
                    </div>
                    <Link
                      href={dashboardHref}
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      <LayoutDashboard size={14} /> Dashboard
                    </Link>
                    <Link
                      href="/dashboard/guest/bookings"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      <UserCircle size={14} /> My Bookings
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm hover:bg-red-50 transition-colors"
                      style={{ color: '#DC2626' }}
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Logged-out: login + signup buttons */
              <>
                <Link
                  href="/login"
                  className="text-sm px-5 py-2 rounded-full font-semibold transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                >
                  Log in
                </Link>
                <Link
                  href="/login?tab=signup"
                  className="text-sm px-5 py-2 rounded-full font-semibold ml-1 transition-all hover:bg-stone-50"
                  style={{ border: '1.5px solid var(--color-border-strong)', color: 'var(--color-text-primary)' }}
                >
                  Sign up
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-lg transition-colors hover:bg-stone-100"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          className="md:hidden"
          style={{ backgroundColor: 'var(--color-bg-card)', borderTop: '1px solid var(--color-border)' }}
        >
          <div className="px-4 py-4 space-y-1">
            {[
              { href: '/search?mode=SHORT_STAY', label: '🌙 Short Stay' },
              { href: '/search?mode=TEMP_STAY',  label: '📅 Monthly' },
              { href: '/search?mode=PERMANENT',  label: '🏠 Long-Term' },
              { href: '/how-it-works',            label: 'How it Works' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="block py-2.5 px-2 text-sm font-medium rounded-lg hover:bg-stone-50 transition-colors"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {label}
              </Link>
            ))}

            <div className="border-t pt-3 mt-2 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)' }}>
              {user ? (
                <>
                  <div className="flex items-center gap-3 px-2 py-2">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                    >
                      {(user.name ?? 'U')[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{user.name}</p>
                      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{user.role}</p>
                    </div>
                  </div>
                  <Link
                    href={dashboardHref}
                    onClick={() => setMenuOpen(false)}
                    className="text-center py-2.5 rounded-full text-sm font-semibold"
                    style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                  >
                    Dashboard
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="text-center py-2.5 rounded-full text-sm font-semibold border"
                    style={{ borderColor: '#FECACA', color: '#DC2626' }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setMenuOpen(false)}
                    className="text-center py-2.5 rounded-full text-sm font-semibold"
                    style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                  >
                    Log in
                  </Link>
                  <Link
                    href="/login"
                    onClick={() => setMenuOpen(false)}
                    className="text-center py-2.5 rounded-full text-sm font-semibold"
                    style={{ border: '1.5px solid var(--color-border-strong)', color: 'var(--color-text-primary)' }}
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

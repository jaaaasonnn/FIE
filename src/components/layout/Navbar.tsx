'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'
import { Menu, X, Search, Heart, MessageSquare, ChevronDown, LayoutDashboard, LogOut, UserCircle, Settings } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'

export function Navbar() {
  const router = useRouter()
  const { user, loading, signOut } = useAuth()

  const [menuOpen, setMenuOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 32)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
  const logoSize = scrolled ? 36 : 40
  const barHeight = scrolled ? '3.75rem' : '4.25rem'

  return (
    <header
      className="sticky top-0 z-50 w-full transition-all duration-200 ease-out"
      style={{
        backgroundColor: scrolled
          ? 'rgba(255,255,255,0.88)'
          : 'rgba(250,247,242,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${scrolled ? 'rgba(232,225,214,0.9)' : 'var(--color-border)'}`,
        boxShadow: scrolled
          ? '0 8px 28px rgba(31,27,22,0.08)'
          : '0 2px 12px rgba(31,27,22,0.04)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className="flex items-center justify-between transition-all duration-200 ease-out"
          style={{ height: barHeight }}
        >
          {/* Logo — gold wordmark paired with mark (Airbnb-style brand lockup) */}
          <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
            <Image
              src="/logo.png"
              alt="Fie"
              width={48}
              height={48}
              style={{
                width: logoSize,
                height: 'auto',
                transition: 'width 200ms ease-out',
              }}
              priority
            />
            <span
              className="fie-wordmark transition-colors duration-200 group-hover:opacity-90"
              style={{
                color: '#D4A84A',
                fontWeight: 800,
                fontSize: scrolled ? '1.35rem' : '1.5rem',
                letterSpacing: '-0.045em',
                lineHeight: 1,
                WebkitTextStroke: '0.35px #D4A84A',
                paintOrder: 'stroke fill',
              }}
            >
              Fie
            </span>
          </Link>

          {/* Desktop nav — sits between logo and actions */}
          <nav className="hidden md:flex items-center gap-7 lg:gap-8 flex-1 justify-center px-6">
            {[
              { href: '/search?mode=SHORT_STAY', label: 'Short Stay' },
              { href: '/search?mode=TEMP_STAY',  label: 'Monthly' },
              { href: '/search?mode=PERMANENT',  label: 'Long-Term' },
              { href: '/how-it-works',            label: 'How it Works' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-[13px] font-medium relative group transition-colors duration-200 hover:text-[var(--color-text-primary)] whitespace-nowrap"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {label}
                <span
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-[1.5px] rounded-full group-hover:w-full transition-all duration-300"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                />
              </Link>
            ))}
          </nav>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-0.5 flex-shrink-0">
            {[
              { href: '/search',                   Icon: Search },
              { href: '/dashboard/guest/wishlist', Icon: Heart },
              { href: '/dashboard/guest/messages', Icon: MessageSquare },
            ].map(({ href, Icon }) => (
              <Link
                key={href}
                href={href}
                className="p-2.5 rounded-full transition-colors duration-200"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-accent-subtle)'
                  e.currentTarget.style.color = 'var(--color-accent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-secondary)'
                }}
              >
                <Icon size={18} />
              </Link>
            ))}

            <div className="w-px h-5 mx-2.5" style={{ backgroundColor: 'var(--color-border)' }} />

            {loading ? (
              <div className="w-24 h-9 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
            ) : user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full transition-all duration-200 hover:shadow-sm"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: scrolled ? '#fff' : 'transparent',
                  }}
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
                  <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                </button>

                {dropdownOpen && (
                  <div
                    className="absolute right-0 mt-2.5 w-52 rounded-2xl py-1.5 z-50"
                    style={{
                      backgroundColor: '#fff',
                      border: '1px solid var(--color-border)',
                      boxShadow: '0 12px 40px rgba(31,27,22,0.12)',
                    }}
                  >
                    <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <p className="text-xs font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{user.name}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{user.email ?? user.phone}</p>
                      <span
                        className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{
                          backgroundColor: user.role === 'HOST' ? 'var(--color-accent-subtle)' : '#EFF6FF',
                          color: user.role === 'HOST' ? 'var(--color-accent)' : '#2563EB',
                        }}
                      >
                        {user.role === 'HOST' ? 'Host' : 'Guest'}
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
                    <Link
                      href="/profile/edit"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      <Settings size={14} /> Edit Profile
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
              <>
                <Link
                  href="/login"
                  className="text-sm px-5 py-2 rounded-full font-semibold transition-all duration-200 hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                >
                  Log in
                </Link>
                <Link
                  href="/login?tab=signup"
                  className="text-sm px-4 py-2 rounded-full font-semibold ml-1.5 transition-all duration-200 hover:bg-[var(--color-accent-subtle)]"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Sign up
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-full transition-colors duration-200 hover:bg-[var(--color-accent-subtle)]"
            style={{ color: 'var(--color-text-primary)' }}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          className="md:hidden"
          style={{
            backgroundColor: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(12px)',
            borderTop: '1px solid var(--color-border)',
            boxShadow: '0 12px 32px rgba(31,27,22,0.08)',
          }}
        >
          <div className="px-4 py-4 space-y-1">
            {[
              { href: '/search?mode=SHORT_STAY', label: 'Short Stay' },
              { href: '/search?mode=TEMP_STAY',  label: 'Monthly' },
              { href: '/search?mode=PERMANENT',  label: 'Long-Term' },
              { href: '/how-it-works',            label: 'How it Works' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="block py-2.5 px-3 text-sm font-medium rounded-xl hover:bg-[var(--color-accent-subtle)] transition-colors"
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
                    className="text-center py-2.5 rounded-full text-sm font-semibold"
                    style={{ color: '#DC2626' }}
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
                    style={{ color: 'var(--color-text-primary)' }}
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

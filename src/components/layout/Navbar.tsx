'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { Menu, X, Search, Heart, MessageSquare } from 'lucide-react'

export function Navbar() {
  const [open, setOpen] = useState(false)

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
              <span
                className="text-[1.25rem] font-bold tracking-tight"
                style={{ color: 'var(--color-text-primary)' }}
              >
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

          {/* Desktop nav */}
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

            <Link
              href="/auth/signin"
              className="text-sm px-5 py-2 rounded-full font-semibold transition-all hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
            >
              Sign In
            </Link>
            <Link
              href="/auth/signup"
              className="text-sm px-5 py-2 rounded-full font-semibold ml-1 transition-all hover:bg-stone-50"
              style={{
                border: '1.5px solid var(--color-border-strong)',
                color: 'var(--color-text-primary)',
              }}
            >
              List Property
            </Link>
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 rounded-lg transition-colors hover:bg-stone-100"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          className="md:hidden"
          style={{
            backgroundColor: 'var(--color-bg-card)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <div className="px-4 py-4 space-y-1">
            {[
              { href: '/search?mode=SHORT_STAY', label: '🌙 Short Stay' },
              { href: '/search?mode=TEMP_STAY',  label: '📅 Monthly' },
              { href: '/search?mode=PERMANENT',  label: '🏠 Long-Term' },
              { href: '/how-it-works',            label: 'How it Works' },
              { href: '/faq',                     label: 'FAQ' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="block py-2.5 px-2 text-sm font-medium rounded-lg hover:bg-stone-50 transition-colors"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {label}
              </Link>
            ))}
            <div
              className="border-t pt-3 mt-2 flex flex-col gap-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="text-center py-2.5 rounded-full text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                onClick={() => setOpen(false)}
                className="text-center py-2.5 rounded-full text-sm font-semibold"
                style={{
                  border: '1.5px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              >
                List Your Property
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

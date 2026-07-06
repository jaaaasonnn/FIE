'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { Menu, X, Search, Heart, MessageSquare } from 'lucide-react'

export function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full" style={{ backgroundColor: 'var(--brown-dark)', borderBottom: '1px solid rgba(240,184,78,0.12)', boxShadow: '0 2px 24px rgba(0,0,0,0.5)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[4.25rem]">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/logo.png"
              alt="FieGH"
              width={48}
              height={48}
              style={{ mixBlendMode: 'screen' }}
              priority
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[1.35rem] font-bold tracking-wide" style={{ fontFamily: 'Playfair Display, serif', color: 'var(--gold)' }}>
                FieGH
              </span>
              <span className="text-[10px] tracking-widest uppercase hidden sm:block" style={{ color: 'rgba(240,184,78,0.5)', letterSpacing: '0.18em' }}>Ghana Rentals</span>
            </div>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-7">
            {[
              { href: '/search?mode=SHORT_STAY', label: 'Short Stay' },
              { href: '/search?mode=TEMP_STAY', label: 'Monthly' },
              { href: '/search?mode=PERMANENT', label: 'Long-Term' },
              { href: '/how-it-works', label: 'How it Works' },
            ].map(({ href, label }) => (
              <Link key={href} href={href}
                className="text-sm font-medium transition-all relative group"
                style={{ color: 'rgba(250,247,242,0.72)' }}
              >
                {label}
                <span className="absolute -bottom-0.5 left-0 w-0 h-px group-hover:w-full transition-all duration-300" style={{ backgroundColor: 'var(--gold)' }} />
              </Link>
            ))}
          </nav>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2">
            <Link href="/search" className="p-2 rounded-full transition-colors hover:bg-white/8" style={{ color: 'rgba(250,247,242,0.65)' }}>
              <Search size={17} />
            </Link>
            <Link href="/dashboard/guest/wishlist" className="p-2 rounded-full transition-colors hover:bg-white/8" style={{ color: 'rgba(250,247,242,0.65)' }}>
              <Heart size={17} />
            </Link>
            <Link href="/dashboard/guest/messages" className="p-2 rounded-full transition-colors hover:bg-white/8" style={{ color: 'rgba(250,247,242,0.65)' }}>
              <MessageSquare size={17} />
            </Link>
            <div className="w-px h-5 mx-1" style={{ backgroundColor: 'rgba(240,184,78,0.2)' }} />
            <Link
              href="/auth/signin"
              className="text-sm px-5 py-2 rounded-full font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: 'var(--gold)', color: 'var(--brown-dark)', letterSpacing: '0.01em' }}
            >
              Sign In
            </Link>
            <Link
              href="/auth/signup"
              className="text-sm px-5 py-2 rounded-full font-semibold transition-all hover:bg-white/10"
              style={{ border: '1px solid rgba(240,184,78,0.45)', color: 'var(--gold)' }}
            >
              List Property
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 rounded-lg"
            style={{ color: 'var(--cream)' }}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden" style={{ backgroundColor: 'var(--surface-dark)', borderTop: '1px solid rgba(240,184,78,0.1)' }}>
          <div className="px-4 py-4 space-y-3">
            {[
              { href: '/search?mode=SHORT_STAY', label: '🌙 Short Stay' },
              { href: '/search?mode=TEMP_STAY', label: '📅 Monthly' },
              { href: '/search?mode=PERMANENT', label: '🏠 Long-Term' },
              { href: '/how-it-works', label: 'How it Works' },
              { href: '/faq', label: 'FAQ' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="block py-2 text-sm font-medium"
                style={{ color: 'var(--cream)' }}
              >
                {label}
              </Link>
            ))}
            <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="text-center py-2.5 rounded-full text-sm font-medium"
                style={{ backgroundColor: 'var(--gold)', color: 'var(--brown-dark)' }}
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                onClick={() => setOpen(false)}
                className="text-center py-2.5 rounded-full text-sm font-medium border"
                style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
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

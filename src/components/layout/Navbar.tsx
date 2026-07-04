'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Menu, X, Home, Search, User, Heart, MessageSquare } from 'lucide-react'

export function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-amber/20" style={{ backgroundColor: 'var(--brown-dark)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--gold)' }}>
              <Home size={18} style={{ color: 'var(--brown-dark)' }} />
            </div>
            <span className="text-xl font-bold" style={{ fontFamily: 'Playfair Display, serif', color: 'var(--gold)' }}>
              FieGH
            </span>
            <span className="text-xs hidden sm:block" style={{ color: 'var(--gold-light)', opacity: 0.7 }}>🇬🇭</span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/search?mode=SHORT_STAY" className="text-sm transition-colors hover:text-amber-300" style={{ color: 'rgba(250,247,242,0.8)' }}>
              Short Stay
            </Link>
            <Link href="/search?mode=TEMP_STAY" className="text-sm transition-colors hover:text-amber-300" style={{ color: 'rgba(250,247,242,0.8)' }}>
              Monthly
            </Link>
            <Link href="/search?mode=PERMANENT" className="text-sm transition-colors hover:text-amber-300" style={{ color: 'rgba(250,247,242,0.8)' }}>
              Long-Term
            </Link>
            <Link href="/how-it-works" className="text-sm transition-colors hover:text-amber-300" style={{ color: 'rgba(250,247,242,0.8)' }}>
              How it Works
            </Link>
          </nav>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/search" className="p-2 rounded-full transition-colors hover:bg-white/10" style={{ color: 'var(--cream)' }}>
              <Search size={18} />
            </Link>
            <Link href="/dashboard/guest/wishlist" className="p-2 rounded-full transition-colors hover:bg-white/10" style={{ color: 'var(--cream)' }}>
              <Heart size={18} />
            </Link>
            <Link href="/dashboard/guest/messages" className="p-2 rounded-full transition-colors hover:bg-white/10" style={{ color: 'var(--cream)' }}>
              <MessageSquare size={18} />
            </Link>
            <div className="w-px h-6 bg-white/20" />
            <Link
              href="/auth/signin"
              className="text-sm px-4 py-2 rounded-full font-medium transition-all hover:opacity-90"
              style={{ backgroundColor: 'var(--gold)', color: 'var(--brown-dark)' }}
            >
              Sign In
            </Link>
            <Link
              href="/auth/signup"
              className="text-sm px-4 py-2 rounded-full font-medium border transition-all hover:bg-white/10"
              style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
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
        <div className="md:hidden border-t border-white/10" style={{ backgroundColor: 'var(--brown-mid)' }}>
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

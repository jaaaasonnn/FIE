'use client'

import Link from 'next/link'
import { Moon, CalendarDays, Key } from 'lucide-react'
import { useReveal } from '@/hooks/useReveal'

/** Shared warm gold family — cohesive with page accent (#C9932E / cream) */
const BRAND = {
  accent: 'var(--color-accent)',
  accentSoft: 'var(--color-accent-subtle)',
  cream: '#F7F0E4',
  creamSoft: '#FAF7F2',
}

const modes = [
  {
    icon: Moon,
    title: 'Short Stay',
    subtitle: 'Nightly & weekly',
    desc: "Perfect for Detty December, business trips, or holiday escapes. Book for 1 night or a few weeks with instant confirmation.",
    href: '/search?mode=SHORT_STAY',
    color: BRAND.accent,
    bg: BRAND.cream,
  },
  {
    icon: CalendarDays,
    title: 'Temporary Stay',
    subtitle: '1 to 11 months',
    desc: "Relocating for work? Visiting family from the diaspora? Monthly furnished rentals with flexible lease terms.",
    href: '/search?mode=TEMP_STAY',
    color: BRAND.accent,
    bg: BRAND.accentSoft,
    featured: true,
  },
  {
    icon: Key,
    title: 'Permanent Rental',
    subtitle: '12+ months lease',
    desc: "Long-term tenancy agreements with clear advance payment terms upfront. No surprises: everything is agreed before you move in.",
    href: '/search?mode=PERMANENT',
    color: BRAND.accent,
    bg: BRAND.creamSoft,
  },
]

export function RentalModeSection() {
  const sectionRef = useReveal<HTMLElement>()

  return (
    <section ref={sectionRef} className="py-24 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="reveal-item text-center mb-16">
          <p className="text-sm font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--color-accent)' }}>
            What are you looking for?
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            Three Ways to Rent
          </h2>
          <p className="text-[#6B645C] mt-4 max-w-xl mx-auto">
            Whether you need a place for a night or a year, there&apos;s a calm path to the right home.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {modes.map((m, i) => {
            const Icon = m.icon
            return (
              <Link
                key={m.title}
                href={m.href}
                className="reveal-item group block"
                style={{ '--i': i + 1 } as React.CSSProperties}
              >
                <div
                  className="relative rounded-2xl p-8 h-full transition-all duration-300 ease-out hover:-translate-y-0.5"
                  style={{
                    backgroundColor: m.bg,
                    boxShadow: '0 4px 18px rgba(31, 27, 22, 0.05)',
                  }}
                >
                  {m.featured && (
                    <div
                      className="absolute top-4 right-4 text-xs font-semibold px-3 py-1 rounded-full"
                      style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
                    >
                      Most Popular
                    </div>
                  )}

                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                    style={{
                      backgroundColor: 'rgba(201, 147, 46, 0.12)',
                      border: '1px solid rgba(201, 147, 46, 0.18)',
                    }}
                  >
                    <Icon size={24} style={{ color: 'var(--color-accent)' }} />
                  </div>

                  <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                    {m.title}
                  </h3>
                  <p className="text-sm font-medium mb-3" style={{ color: m.color }}>
                    {m.subtitle}
                  </p>
                  <p className="text-sm text-[#6B645C] leading-relaxed mb-5">
                    {m.desc}
                  </p>

                  <div className="flex items-center gap-1 text-sm font-semibold transition-all group-hover:gap-2" style={{ color: m.color }}>
                    Browse {m.title}s
                    <span>→</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}

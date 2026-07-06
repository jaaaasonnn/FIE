'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Moon, CalendarDays, Key } from 'lucide-react'

const modes = [
  {
    icon: Moon,
    emoji: '🌙',
    title: 'Short Stay',
    subtitle: 'Nightly & weekly',
    desc: "Perfect for Detty December, business trips, or holiday escapes. Book for 1 night or a few weeks with instant confirmation.",
    href: '/search?mode=SHORT_STAY',
    color: 'var(--amber)',
    bg: '#FFF8EE'
  },
  {
    icon: CalendarDays,
    emoji: '📅',
    title: 'Temporary Stay',
    subtitle: '1 to 11 months',
    desc: "Relocating for work? Visiting family from the diaspora? Monthly furnished rentals across Ghana with flexible lease terms.",
    href: '/search?mode=TEMP_STAY',
    color: '#2563EB',
    bg: '#EFF6FF',
    featured: true
  },
  {
    icon: Key,
    emoji: '🏠',
    title: 'Permanent Rental',
    subtitle: '12+ months lease',
    desc: "Long-term tenancy agreements with clear advance payment terms upfront. No surprises — everything agreed before you move in.",
    href: '/search?mode=PERMANENT',
    color: '#059669',
    bg: '#F0FDF4'
  },
]

export function RentalModeSection() {
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll('.mode-card')
    const heading = sectionRef.current?.querySelector('.mode-heading')
    if (!cards) return

    // Pre-hide
    cards.forEach((el) => { (el as HTMLElement).style.opacity = '0'; (el as HTMLElement).style.transform = 'translateY(60px)' })
    if (heading) { (heading as HTMLElement).style.opacity = '0'; (heading as HTMLElement).style.transform = 'translateY(30px)' }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            import('gsap').then(({ gsap }) => {
              const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
              if (heading) tl.to(heading, { y: 0, opacity: 1, duration: 0.7 })
              tl.to(cards, { y: 0, opacity: 1, stagger: 0.18, duration: 0.8 }, '-=0.3')
            })
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1 }
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={sectionRef} className="py-20 px-4" style={{ backgroundColor: 'var(--cream)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="mode-heading text-center mb-14">
          <p className="text-sm font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--amber)' }}>
            What are you looking for?
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold" style={{ color: 'var(--brown-dark)' }}>
            Three Ways to Rent
          </h2>
          <p className="text-stone-500 mt-4 max-w-xl mx-auto">
            Whether you need a place for a night or a year, FieGH has the right option for you.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {modes.map((m) => {
            const Icon = m.icon
            return (
              <Link key={m.title} href={m.href} className="mode-card group block">
                <div
                  className="relative rounded-2xl p-7 h-full transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border border-transparent hover:border-stone-100"
                  style={{ backgroundColor: m.bg }}
                >
                  {m.featured && (
                    <div
                      className="absolute top-4 right-4 text-xs font-semibold px-3 py-1 rounded-full"
                      style={{ backgroundColor: 'var(--gold)', color: 'var(--brown-dark)' }}
                    >
                      Most Popular
                    </div>
                  )}

                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 text-2xl"
                    style={{ backgroundColor: `${m.color}15` }}
                  >
                    {m.emoji}
                  </div>

                  <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--brown-dark)' }}>
                    {m.title}
                  </h3>
                  <p className="text-sm font-medium mb-3" style={{ color: m.color }}>
                    {m.subtitle}
                  </p>
                  <p className="text-sm text-stone-600 leading-relaxed mb-5">
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

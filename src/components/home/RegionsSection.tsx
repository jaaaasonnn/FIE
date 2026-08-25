'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const regions = [
  { name: 'Greater Accra', city: 'Accra',       img: 'https://images.unsplash.com/photo-1569880153113-76e33fc52d5f?w=400&q=70' },
  { name: 'Ashanti',       city: 'Kumasi',      img: 'https://images.unsplash.com/photo-1612686635542-2244ed9f8ddc?w=400&q=70' },
  { name: 'Western',       city: 'Takoradi',    img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=70' },
  { name: 'Central',       city: 'Cape Coast',  img: 'https://images.unsplash.com/photo-1548013146-72479768bada?w=400&q=70' },
  { name: 'Eastern',       city: 'Koforidua',   img: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&q=70' },
  { name: 'Northern',      city: 'Tamale',      img: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=400&q=70' },
]

// "Accra" / "Accra & Kumasi" / "Accra, Kumasi & Tamale" — natural join,
// not a hardcoded claim, so it stays accurate as more regions get listings.
function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} & ${items[1]}`
  return `${items.slice(0, -1).join(', ')} & ${items[items.length - 1]}`
}

export function RegionsSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const [counts, setCounts] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    fetch('/api/listings/region-counts')
      .then((r) => r.json())
      .then((data) => setCounts(data.counts ?? {}))
      .catch(() => setCounts({}))
  }, [])

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll('.region-card')
    const heading = sectionRef.current?.querySelector('.region-heading')
    cards?.forEach((el, i) => {
      (el as HTMLElement).style.opacity = '0'
      ;(el as HTMLElement).style.transform = i % 2 === 0 ? 'translateY(40px)' : 'translateY(60px)'
    })
    if (heading) { (heading as HTMLElement).style.opacity = '0'; (heading as HTMLElement).style.transform = 'translateX(-30px)' }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            import('gsap').then(({ gsap }) => {
              const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
              if (heading) tl.to(heading, { x: 0, opacity: 1, duration: 0.7 })
              tl.to(entry.target.querySelectorAll('.region-card'), {
                y: 0, opacity: 1, stagger: 0.08, duration: 0.65
              }, '-=0.3')
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

  const liveCities = counts
    ? regions.filter((r) => (counts[r.name] ?? 0) > 0).map((r) => r.city)
    : []

  return (
    <section ref={sectionRef} className="py-24 px-4 bg-[var(--color-bg)]">
      <div className="max-w-7xl mx-auto">
        <div className="region-heading flex items-end justify-between mb-12">
          <div>
            {liveCities.length > 0 && (
              <p className="text-sm font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--color-accent)' }}>
                Live in {joinNatural(liveCities)}
              </p>
            )}
            <h2 className="text-4xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Explore by Region 🇬🇭
            </h2>
          </div>
          <Link href="/search" className="hidden sm:block text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
            All regions →
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
          {regions.map(({ name, city, img }) => {
            const count = counts?.[name] ?? 0
            return (
              <Link
                key={name}
                href={`/search?region=${encodeURIComponent(name)}`}
                className="region-card group relative rounded-2xl overflow-hidden aspect-[3/4] block"
                style={{ boxShadow: '0 4px 16px rgba(31, 27, 22, 0.08)' }}
              >
                <img
                  src={img}
                  alt={name}
                  className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 hero-overlay" />
                <div className="absolute bottom-3 left-3 right-3">
                  <p className="text-white font-bold text-sm leading-tight">{city}</p>
                  {counts && (
                    <p className="text-xs" style={{ color: 'var(--color-accent)' }}>
                      {count > 0 ? `${count} ${count === 1 ? 'listing' : 'listings'}` : 'Coming soon'}
                    </p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}

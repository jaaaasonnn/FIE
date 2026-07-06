'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const regions = [
  { name: 'Greater Accra', city: 'Accra', img: 'https://images.unsplash.com/photo-1569880153113-76e33fc52d5f?w=400&q=70', count: 180 },
  { name: 'Ashanti', city: 'Kumasi', img: 'https://images.unsplash.com/photo-1612686635542-2244ed9f8ddc?w=400&q=70', count: 95 },
  { name: 'Western', city: 'Takoradi', img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=70', count: 42 },
  { name: 'Central', city: 'Cape Coast', img: 'https://images.unsplash.com/photo-1548013146-72479768bada?w=400&q=70', count: 38 },
  { name: 'Eastern', city: 'Koforidua', img: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&q=70', count: 27 },
  { name: 'Northern', city: 'Tamale', img: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=400&q=70', count: 19 },
]

export function RegionsSection() {
  const sectionRef = useRef<HTMLElement>(null)

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

  return (
    <section ref={sectionRef} className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="region-heading flex items-end justify-between mb-10">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--amber)' }}>
              16 Regions
            </p>
            <h2 className="text-4xl font-bold" style={{ color: 'var(--brown-dark)' }}>
              Explore by Region 🇬🇭
            </h2>
          </div>
          <Link href="/search" className="hidden sm:block text-sm font-semibold" style={{ color: 'var(--amber)' }}>
            All regions →
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {regions.map(({ name, city, img, count }) => (
            <Link
              key={name}
              href={`/search?region=${encodeURIComponent(name)}`}
              className="region-card group relative rounded-2xl overflow-hidden aspect-[3/4] block"
            >
              <img
                src={img}
                alt={name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
              />
              <div className="absolute inset-0 hero-overlay" />
              <div className="absolute bottom-3 left-3 right-3">
                <p className="text-white font-bold text-sm leading-tight">{city}</p>
                <p className="text-xs" style={{ color: 'var(--gold)' }}>{count} listings</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

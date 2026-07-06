'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Star, MapPin, Bed, Bath, Users, Heart } from 'lucide-react'

const MOCK_LISTINGS = [
  {
    id: '1',
    title: 'Luxury 3BR Apartment in East Legon',
    type: 'Apartment',
    city: 'Accra',
    neighbourhood: 'East Legon',
    bedrooms: 3, bathrooms: 2, maxGuests: 6,
    priceNightly: 120,
    rating: 4.9, reviews: 47,
    photo: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=75',
    modes: ['SHORT_STAY', 'TEMP_STAY'],
    verified: true, superhost: true,
  },
  {
    id: '2',
    title: 'Modern Studio in Cantonments',
    type: 'Studio',
    city: 'Accra',
    neighbourhood: 'Cantonments',
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    priceNightly: 65,
    rating: 4.8, reviews: 23,
    photo: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600&q=75',
    modes: ['SHORT_STAY'],
    verified: true, superhost: false,
  },
  {
    id: '3',
    title: 'Spacious 4BR House, Airport Hills',
    type: 'House',
    city: 'Accra',
    neighbourhood: 'Airport Hills',
    bedrooms: 4, bathrooms: 3, maxGuests: 8,
    priceMonthly: 1800,
    rating: 4.7, reviews: 12,
    photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600&q=75',
    modes: ['TEMP_STAY', 'PERMANENT'],
    verified: true, superhost: false,
  },
  {
    id: '4',
    title: 'Cosy Villa in Kumasi (Nhyiaeso)',
    type: 'Villa',
    city: 'Kumasi',
    neighbourhood: 'Nhyiaeso',
    bedrooms: 5, bathrooms: 4, maxGuests: 10,
    priceNightly: 200,
    rating: 5.0, reviews: 8,
    photo: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=600&q=75',
    modes: ['SHORT_STAY', 'TEMP_STAY'],
    verified: true, superhost: true,
  },
  {
    id: '5',
    title: 'Furnished 2BR Apartment, Labone',
    type: 'Apartment',
    city: 'Accra',
    neighbourhood: 'Labone',
    bedrooms: 2, bathrooms: 2, maxGuests: 4,
    priceMonthly: 950,
    rating: 4.6, reviews: 31,
    photo: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=75',
    modes: ['TEMP_STAY', 'PERMANENT'],
    verified: true, superhost: false,
  },
  {
    id: '6',
    title: 'Private Guestroom, Osu',
    type: 'Guestroom',
    city: 'Accra',
    neighbourhood: 'Osu',
    bedrooms: 1, bathrooms: 1, maxGuests: 2,
    priceNightly: 38,
    rating: 4.7, reviews: 55,
    photo: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=75',
    modes: ['SHORT_STAY'],
    verified: false, superhost: false,
  },
]

const MODE_LABELS: Record<string, string> = {
  SHORT_STAY: '🌙 Short Stay',
  TEMP_STAY:  '📅 Monthly',
  PERMANENT:  '🏠 Long-Term',
}

const GHS_RATE = 15.5

export function FeaturedListings() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const cards   = sectionRef.current?.querySelectorAll('.listing-card')
    const heading = sectionRef.current?.querySelector('.listing-heading')
    cards?.forEach((el) => {
      (el as HTMLElement).style.opacity = '0'
      ;(el as HTMLElement).style.transform = 'translateY(48px) scale(0.97)'
    })
    if (heading) {
      (heading as HTMLElement).style.opacity = '0'
      ;(heading as HTMLElement).style.transform = 'translateY(28px)'
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            import('gsap').then(({ gsap }) => {
              const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
              if (heading) tl.to(heading, { y: 0, opacity: 1, duration: 0.7 })
              tl.to(entry.target.querySelectorAll('.listing-card'), {
                y: 0, opacity: 1, scale: 1, stagger: 0.1, duration: 0.65,
              }, '-=0.2')
            })
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.05 },
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={sectionRef} className="py-20 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-7xl mx-auto">

        {/* Heading row */}
        <div className="listing-heading flex items-end justify-between mb-10">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: 'var(--color-accent)', letterSpacing: '0.1em' }}
            >
              Hand-picked for you
            </p>
            <h2 className="text-4xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Featured Properties
            </h2>
          </div>
          <Link
            href="/search"
            className="hidden sm:flex items-center gap-1 text-sm font-semibold transition-all hover:gap-2"
            style={{ color: 'var(--color-accent)' }}
          >
            View all <span>→</span>
          </Link>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {MOCK_LISTINGS.map((l) => {
            const price    = l.priceNightly ?? l.priceMonthly ?? 0
            const unit     = l.priceNightly ? '/night' : '/mo'
            const ghsPrice = Math.round(price * GHS_RATE).toLocaleString()

            return (
              // ── Entire card is a single clickable link ──────────────────
              <Link
                key={l.id}
                href={`/listings/${l.id}`}
                className="listing-card group block rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 2px 8px rgba(31,27,22,0.06)',
                  textDecoration: 'none',
                }}
              >
                {/* ── Image ─────────────────────────────────────────────── */}
                <div className="relative h-52 overflow-hidden bg-stone-100">
                  <img
                    src={l.photo}
                    alt={l.title}
                    className="listing-card-img w-full h-full object-cover transition-transform duration-500"
                    loading="lazy"
                  />

                  {/* Mode pill — top-left, single pill only */}
                  {l.modes[0] && (
                    <span
                      className="absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        backgroundColor: 'rgba(0,0,0,0.52)',
                        color: '#fff',
                        backdropFilter: 'blur(6px)',
                        letterSpacing: '0.01em',
                      }}
                    >
                      {MODE_LABELS[l.modes[0]]}
                    </span>
                  )}

                  {/* Heart — top-right */}
                  <button
                    onClick={(e) => e.preventDefault()}
                    className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
                    style={{ backgroundColor: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)' }}
                    aria-label="Save listing"
                  >
                    <Heart size={14} style={{ color: 'var(--color-text-secondary)' }} />
                  </button>
                </div>

                {/* ── Body ──────────────────────────────────────────────── */}
                <div className="p-4 pb-0">
                  {/* Title row + rating */}
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h3
                      className="font-semibold text-sm leading-snug flex-1 line-clamp-2"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {l.title}
                    </h3>
                    {/* Rating — top-right of text area */}
                    <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                      <Star size={11} className="fill-[#C9932E] text-[#C9932E]" />
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {l.rating}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        ({l.reviews})
                      </span>
                    </div>
                  </div>

                  {/* Location */}
                  <div
                    className="flex items-center gap-1 text-xs mb-2.5"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <MapPin size={11} className="flex-shrink-0" />
                    {l.neighbourhood}, {l.city}
                  </div>

                  {/* Specs */}
                  <div
                    className="flex items-center gap-3 text-xs mb-3"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <span className="flex items-center gap-1"><Bed size={11} />{l.bedrooms} bd</span>
                    <span className="flex items-center gap-1"><Bath size={11} />{l.bathrooms} ba</span>
                    <span className="flex items-center gap-1"><Users size={11} />Up to {l.maxGuests}</span>
                  </div>

                  {/* Compact trust badges — inline, subtle, secondary info */}
                  {(l.verified || l.superhost) && (
                    <div className="flex items-center gap-1.5 mb-3">
                      {l.verified && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: '#EBF0F7',
                            color: '#3A5A8A',
                            border: '1px solid #C8D8ED',
                          }}
                        >
                          ✓ Verified
                        </span>
                      )}
                      {l.superhost && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: 'var(--color-accent-subtle)',
                            color: '#8A5E10',
                            border: '1px solid #E5D0A8',
                          }}
                        >
                          ⭐ Superhost
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Price footer ───────────────────────────────────────── */}
                <div
                  className="px-4 py-3 mt-1 flex items-end justify-between"
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  {/* Price — bottom-left */}
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span
                        className="text-base font-bold"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        ${price.toLocaleString()}
                      </span>
                      <span
                        className="text-xs font-normal"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {unit}
                      </span>
                    </div>
                    {/* GH₵ conversion — smaller, lighter, secondary */}
                    <div
                      className="text-[11px] mt-0.5"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      ≈ GH₵ {ghsPrice}
                    </div>
                  </div>

                  {/* Subtle "tap to view" affordance — no button, just a caret */}
                  <span
                    className="text-xs font-semibold flex items-center gap-0.5 transition-all group-hover:gap-1.5"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    View <span className="text-sm">→</span>
                  </span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Mobile view-all CTA */}
        <div className="text-center mt-8 sm:hidden">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
          >
            View All Properties →
          </Link>
        </div>
      </div>
    </section>
  )
}

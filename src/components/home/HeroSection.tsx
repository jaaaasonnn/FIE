'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, MapPin, Calendar } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { GHANA_REGIONS } from '@/lib/utils'

export function HeroSection() {
  const heroRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const subtitleRef = useRef<HTMLParagraphElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)

  const [mode, setMode] = useState('SHORT_STAY')
  const [region, setRegion] = useState('')
  const [date, setDate] = useState('')
  const router = useRouter()

  useEffect(() => {
    // Pre-hide elements so GSAP reveal is visible
    const els = [titleRef.current, subtitleRef.current, searchRef.current]
    els.forEach((el) => { if (el) { el.style.opacity = '0'; el.style.transform = 'translateY(50px)' } })
    if (statsRef.current) {
      Array.from(statsRef.current.children).forEach((el) => {
        (el as HTMLElement).style.opacity = '0'
        ;(el as HTMLElement).style.transform = 'translateY(20px)'
      })
    }

    let animationFrame: number
    animationFrame = requestAnimationFrame(async () => {
      const { gsap } = await import('gsap')
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      tl.to(titleRef.current, { y: 0, opacity: 1, duration: 1.1 })
        .to(subtitleRef.current, { y: 0, opacity: 1, duration: 0.8 }, '-=0.6')
        .to(searchRef.current, { y: 0, opacity: 1, duration: 0.8 }, '-=0.5')
        .to(Array.from(statsRef.current?.children || []), {
          y: 0, opacity: 1, stagger: 0.15, duration: 0.6,
        }, '-=0.3')

      // Parallax on scroll
      ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          if (heroRef.current) {
            heroRef.current.style.backgroundPositionY = `${self.progress * 30}%`
          }
        },
      })
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams({ mode })
    if (region) params.set('region', region)
    if (date) params.set('checkIn', date)
    router.push(`/search?${params.toString()}`)
  }

  return (
    <section
      ref={heroRef}
      className="relative min-h-[92vh] flex items-center justify-center overflow-hidden"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1600&q=80')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center 40%',
      }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 hero-overlay" />

      {/* Decorative gold line */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: 'linear-gradient(90deg, transparent, var(--gold), transparent)' }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
        {/* Tag */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-6"
          style={{ backgroundColor: 'rgba(245,192,106,0.2)', border: '1px solid rgba(245,192,106,0.4)', color: 'var(--gold)' }}>
          🇬🇭 Ghana&apos;s Premier Rental Platform
        </div>

        {/* Title */}
        <h1
          ref={titleRef}
          className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight"
          style={{ color: 'var(--cream)', fontFamily: 'Playfair Display, serif' }}
        >
          Find Your{' '}
          <span className="text-shimmer">Fie</span>
          {' '}in Ghana
        </h1>

        {/* Subtitle */}
        <p
          ref={subtitleRef}
          className="text-lg sm:text-xl mb-10 max-w-2xl mx-auto leading-relaxed"
          style={{ color: 'rgba(250,247,242,0.85)' }}
        >
          Short stays, monthly lets, and long-term leases — all in one place.
          From Accra to Kumasi, Takoradi to Tamale.
        </p>

        {/* Search box */}
        <div ref={searchRef} className="max-w-3xl mx-auto">
          {/* Mode tabs */}
          <div className="flex gap-1 p-1 rounded-full mb-3 inline-flex mx-auto"
            style={{ backgroundColor: 'rgba(8,4,0,0.72)', backdropFilter: 'blur(12px)', border: '1px solid rgba(240,184,78,0.28)' }}>
            {[
              { val: 'SHORT_STAY', label: '🌙 Short Stay' },
              { val: 'TEMP_STAY', label: '📅 Monthly' },
              { val: 'PERMANENT', label: '🏠 Long-Term' },
            ].map(({ val, label }) => (
              <button
                key={val}
                onClick={() => setMode(val)}
                className="px-4 py-2 rounded-full text-sm font-medium transition-all"
                style={
                  mode === val
                    ? { backgroundColor: 'var(--gold)', color: 'var(--brown-dark)' }
                    : { color: 'rgba(250,247,242,0.7)' }
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search form */}
          <form
            onSubmit={handleSearch}
            className="flex flex-col sm:flex-row gap-2 p-2 rounded-2xl"
            style={{ backgroundColor: 'rgba(255,255,255,0.97)', boxShadow: '0 25px 50px rgba(26,18,8,0.4)' }}
          >
            <div className="flex items-center gap-2 flex-1 px-3">
              <MapPin size={18} style={{ color: 'var(--amber)' }} className="flex-shrink-0" />
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full text-sm border-none outline-none bg-transparent py-3"
                style={{ color: region ? 'var(--brown-dark)' : '#9CA3AF', fontFamily: 'DM Sans, sans-serif' }}
              >
                <option value="">All regions in Ghana</option>
                {GHANA_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="hidden sm:block w-px my-3" style={{ backgroundColor: '#E5E7EB' }} />

            <div className="flex items-center gap-2 px-3 sm:w-48">
              <Calendar size={18} style={{ color: 'var(--amber)' }} className="flex-shrink-0" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full text-sm border-none outline-none bg-transparent py-3"
                style={{ color: date ? 'var(--brown-dark)' : '#9CA3AF', fontFamily: 'DM Sans, sans-serif' }}
                placeholder="Move-in date"
              />
            </div>

            <button
              type="submit"
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all hover:opacity-90 sm:rounded-xl"
              style={{ backgroundColor: 'var(--amber)', color: '#fff', minWidth: '120px' }}
            >
              <Search size={16} />
              Search
            </button>
          </form>
        </div>

        {/* Stats */}
        <div ref={statsRef} className="flex flex-wrap items-center justify-center gap-8 mt-10">
          {[
            { num: '500+', label: 'Properties' },
            { num: '16', label: 'Regions' },
            { num: '1,200+', label: 'Happy Guests' },
            { num: '4.8★', label: 'Avg Rating' },
          ].map(({ num, label }) => (
            <div key={label} className="text-center px-4 border-r last:border-r-0" style={{ borderColor: 'rgba(245,192,106,0.2)' }}>
              <div className="text-3xl font-bold" style={{ color: 'var(--gold)', fontFamily: 'Playfair Display, serif' }}>
                {num}
              </div>
              <div className="text-xs tracking-wide mt-0.5" style={{ color: 'rgba(250,247,242,0.55)' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-24"
        style={{ background: 'linear-gradient(to top, var(--cream), transparent)' }}
      />
    </section>
  )
}

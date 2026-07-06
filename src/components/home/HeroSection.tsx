'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, MapPin, Calendar } from 'lucide-react'
import { useRouter } from 'next/navigation'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { GHANA_REGIONS } from '@/lib/utils'

// Shared radius token — used on pill, toggle, search card, search button
const R = { pill: '9999px', card: '20px', input: '12px' }

// Shared pill style (Platform tag + mode toggle items share this foundation)
const PILL_BASE: React.CSSProperties = {
  borderRadius: R.pill,
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: '0.01em',
  padding: '6px 14px',
  lineHeight: 1.4,
}

export function HeroSection() {
  const heroRef    = useRef<HTMLDivElement>(null)
  const titleRef   = useRef<HTMLHeadingElement>(null)
  const subtitleRef = useRef<HTMLParagraphElement>(null)
  const searchRef  = useRef<HTMLDivElement>(null)
  const statsRef   = useRef<HTMLDivElement>(null)

  const [mode, setMode]         = useState('SHORT_STAY')
  const [region, setRegion]     = useState('')
  const [startDate, setStartDate] = useState<Date | null>(null)
  const router = useRouter()

  useEffect(() => {
    const els = [titleRef.current, subtitleRef.current, searchRef.current]
    els.forEach((el) => { if (el) { el.style.opacity = '0'; el.style.transform = 'translateY(50px)' } })
    if (statsRef.current) {
      Array.from(statsRef.current.children).forEach((el) => {
        (el as HTMLElement).style.opacity = '0'
        ;(el as HTMLElement).style.transform = 'translateY(20px)'
      })
    }

    const af = requestAnimationFrame(async () => {
      const { gsap } = await import('gsap')
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .to(titleRef.current,    { y: 0, opacity: 1, duration: 1.1 })
        .to(subtitleRef.current, { y: 0, opacity: 1, duration: 0.8 }, '-=0.6')
        .to(searchRef.current,   { y: 0, opacity: 1, duration: 0.8 }, '-=0.5')
        .to(Array.from(statsRef.current?.children || []), { y: 0, opacity: 1, stagger: 0.15, duration: 0.6 }, '-=0.3')

      ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          if (heroRef.current) heroRef.current.style.backgroundPositionY = `${self.progress * 30}%`
        },
      })
    })
    return () => cancelAnimationFrame(af)
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams({ mode })
    if (region)    params.set('region', region)
    if (startDate) params.set('checkIn', startDate.toISOString().split('T')[0])
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
      {/* ── Gradient overlay: light at top → heavier at bottom for legibility ── */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.38) 45%, rgba(0,0,0,0.72) 100%)',
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">

        {/* ── Platform tag pill — same system as mode toggle pills ── */}
        <div
          className="inline-flex items-center gap-2 mb-7"
          style={{
            ...PILL_BASE,
            backgroundColor: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.22)',
            color: '#fff',
            backdropFilter: 'blur(8px)',
          }}
        >
          🇬🇭 Ghana&apos;s Premier Rental Platform
        </div>

        {/* ── Headline — weight 800, "Fie" in accent ── */}
        <h1
          ref={titleRef}
          className="text-5xl sm:text-6xl lg:text-7xl mb-6 leading-[1.05] tracking-tight"
          style={{ color: '#fff', fontWeight: 800 }}
        >
          Find Your{' '}
          <span className="text-shimmer">Fie</span>
          {' '}in Ghana
        </h1>

        {/* ── Subtitle ── */}
        <p
          ref={subtitleRef}
          className="text-lg sm:text-xl mb-10 max-w-2xl mx-auto leading-relaxed"
          style={{ color: 'rgba(255,255,255,0.82)', fontWeight: 400 }}
        >
          Short stays, monthly lets, and long-term leases — all in one place.
          From Accra to Kumasi, Takoradi to Tamale.
        </p>

        {/* ── Search card ── */}
        <div ref={searchRef} className="max-w-3xl mx-auto">

          {/* Mode toggle — same pill DNA as the platform tag above */}
          <div
            className="inline-flex gap-1 p-1 mb-3"
            style={{
              borderRadius: R.pill,
              backgroundColor: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.15)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {[
              { val: 'SHORT_STAY', label: '🌙 Short Stay' },
              { val: 'TEMP_STAY',  label: '📅 Monthly' },
              { val: 'PERMANENT',  label: '🏠 Long-Term' },
            ].map(({ val, label }) => (
              <button
                key={val}
                onClick={() => setMode(val)}
                style={
                  mode === val
                    ? { ...PILL_BASE, backgroundColor: 'var(--color-accent)', color: '#fff' }
                    : { ...PILL_BASE, backgroundColor: 'transparent', color: 'rgba(255,255,255,0.72)' }
                }
                className="transition-all"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search form card — border-radius: 20px throughout */}
          <form
            onSubmit={handleSearch}
            className="flex flex-col sm:flex-row gap-2 p-2"
            style={{
              backgroundColor: 'rgba(255,255,255,0.97)',
              borderRadius: R.card,
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          >
            {/* Region */}
            <div className="flex items-center gap-2 flex-1 px-3" style={{ minHeight: '52px' }}>
              <MapPin size={17} style={{ color: 'var(--color-accent)' }} className="flex-shrink-0" />
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full text-sm border-none outline-none bg-transparent"
                style={{
                  color: region ? 'var(--color-text-primary)' : '#9CA3AF',
                  height: '52px',
                  cursor: 'pointer',
                }}
              >
                <option value="">All regions in Ghana</option>
                {GHANA_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="hidden sm:block w-px my-2" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Date picker */}
            <div className="flex items-center gap-2 px-3 sm:w-52 hero-datepicker" style={{ minHeight: '52px' }}>
              <Calendar size={17} style={{ color: 'var(--color-accent)' }} className="flex-shrink-0" />
              <DatePicker
                selected={startDate}
                onChange={(d: Date | null) => setStartDate(d)}
                placeholderText="Move-in date"
                minDate={new Date()}
                dateFormat="dd MMM yyyy"
                className="w-full text-sm border-none outline-none bg-transparent py-3 cursor-pointer"
                calendarClassName="fiegh-cal"
                showPopperArrow={false}
                popperPlacement="bottom-start"
              />
            </div>

            {/* Search CTA */}
            <button
              type="submit"
              className="flex items-center justify-center gap-2 px-6 font-semibold text-sm transition-all active:scale-95 group"
              style={{
                backgroundColor: 'var(--color-accent)',
                color: '#fff',
                borderRadius: R.card,
                minWidth: '120px',
                height: '52px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent)')}
            >
              <Search size={16} />
              Search
            </button>
          </form>
        </div>

        {/* ── Stats row ── */}
        <div ref={statsRef} className="flex flex-wrap items-center justify-center gap-8 mt-10">
          {[
            { num: '500+',   label: 'Properties' },
            { num: '16',     label: 'Regions' },
            { num: '1,200+', label: 'Happy Guests' },
            { num: '4.8★',  label: 'Avg Rating' },
          ].map(({ num, label }) => (
            <div key={label} className="text-center px-4 border-r last:border-r-0" style={{ borderColor: 'rgba(255,255,255,0.15)' }}>
              <div className="text-3xl font-bold" style={{ color: 'var(--color-accent)' }}>{num}</div>
              <div className="text-xs tracking-wider mt-0.5" style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom fade into page background ── */}
      <div
        className="absolute bottom-0 left-0 right-0 h-28"
        style={{ background: 'linear-gradient(to top, var(--color-bg), transparent)' }}
      />
    </section>
  )
}

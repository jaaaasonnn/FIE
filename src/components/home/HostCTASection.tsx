'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { DollarSign, Calendar, Shield, TrendingUp } from 'lucide-react'

export function HostCTASection() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const left = sectionRef.current?.querySelector('.cta-left')
    const right = sectionRef.current?.querySelector('.cta-right')
    if (left) { (left as HTMLElement).style.opacity = '0'; (left as HTMLElement).style.transform = 'translateX(-50px)' }
    if (right) { (right as HTMLElement).style.opacity = '0'; (right as HTMLElement).style.transform = 'translateX(50px)' }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            import('gsap').then(({ gsap }) => {
              gsap.to([left, right], { x: 0, opacity: 1, stagger: 0.15, duration: 0.9, ease: 'power3.out' })
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
    <section ref={sectionRef} className="py-20 px-4" style={{ backgroundColor: 'var(--brown-dark)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="cta-left">
            <p className="text-sm font-medium uppercase tracking-widest mb-4" style={{ color: 'var(--color-accent)' }}>
              For Property Owners
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight" style={{ color: 'var(--cream)' }}>
              Turn Your Property<br />
              <span style={{ color: 'var(--color-accent)' }}>Into Income</span>
            </h2>
            <p className="text-base mb-8 leading-relaxed" style={{ color: 'rgba(250,247,242,0.7)' }}>
              List your apartment, house, villa, or guestroom on FieGH and start earning.
              Choose short stays, monthly lets, or long-term leases — you decide.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-8">
              {[
                { icon: DollarSign, label: 'MoMo & Bank Payouts', color: 'var(--color-accent)' },
                { icon: Calendar, label: 'Full Calendar Control', color: '#60A5FA' },
                { icon: Shield, label: 'Verified Guest System', color: '#34D399' },
                { icon: TrendingUp, label: 'Real-Time Analytics', color: '#F472B6' },
              ].map(({ icon: Icon, label, color }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${color}20` }}>
                    <Icon size={16} style={{ color }} />
                  </div>
                  <span className="text-sm" style={{ color: 'rgba(250,247,242,0.75)' }}>{label}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/auth/signup?role=host"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full font-semibold text-sm transition-all hover:opacity-90"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
              >
                Start Hosting Today
              </Link>
              <Link
                href="/how-it-works#hosts"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full font-semibold text-sm border transition-all hover:bg-white/10"
                style={{ borderColor: 'rgba(245,192,106,0.4)', color: 'var(--cream)' }}
              >
                Learn How Hosting Works
              </Link>
            </div>
          </div>

          {/* Earnings preview card */}
          <div className="cta-right relative">
            <div
              className="rounded-2xl p-6"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(245,192,106,0.2)' }}
            >
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-semibold" style={{ color: 'var(--cream)' }}>
                  Host Earnings Preview
                </h4>
                <span className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'rgba(245,192,106,0.2)', color: 'var(--color-accent)' }}>
                  Sample
                </span>
              </div>

              <div className="space-y-4 mb-6">
                {[
                  { label: '2BR Apt, East Legon (Short Stay)', rate: '$80/night', monthly: '$1,680', nights: 21 },
                  { label: 'Studio, Cantonments (Monthly)', rate: '$600/mo', monthly: '$600', nights: null },
                ].map((item) => (
                  <div key={item.label} className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <p className="text-xs mb-2" style={{ color: 'rgba(250,247,242,0.6)' }}>{item.label}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm" style={{ color: 'var(--color-accent)' }}>{item.rate}</span>
                      <span className="text-sm font-bold" style={{ color: 'var(--cream)' }}>
                        {item.monthly}<span className="text-xs font-normal text-stone-400">/mo</span>
                      </span>
                    </div>
                    {item.nights && (
                      <p className="text-xs mt-1" style={{ color: 'rgba(250,247,242,0.4)' }}>{item.nights} nights booked</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="border-t pt-4" style={{ borderColor: 'rgba(245,192,106,0.15)' }}>
                <div className="flex justify-between items-center">
                  <span className="text-sm" style={{ color: 'rgba(250,247,242,0.6)' }}>After 8% platform fee</span>
                  <span className="text-xl font-bold" style={{ color: 'var(--color-accent)' }}>
                    $2,092/mo
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'rgba(250,247,242,0.35)' }}>
                  ≈ GH₵ 32,426/month
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

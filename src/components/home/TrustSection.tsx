'use client'

import { useEffect, useRef } from 'react'
import { Shield, CreditCard, MessageSquare, BadgeCheck } from 'lucide-react'

const trust = [
  {
    icon: BadgeCheck,
    title: 'ID Verified Hosts',
    desc: 'Every host goes through Ghana Card, Passport, or Voter ID verification before listing a property.',
    color: '#2563EB',
  },
  {
    icon: Shield,
    title: 'Escrow Protection',
    desc: 'Your payment is held securely until check-in is confirmed. Raise a dispute within 24 hours if anything is wrong.',
    color: '#059669',
  },
  {
    icon: CreditCard,
    title: 'MoMo & Card Payments',
    desc: 'Pay with MTN MoMo, Vodafone Cash, AirtelTigo Money, or Visa/Mastercard via Paystack.',
    color: 'var(--amber)',
  },
  {
    icon: MessageSquare,
    title: 'In-App Messaging',
    desc: 'Chat directly with your host before booking. No need to share phone numbers until you\'re ready.',
    color: '#7C3AED',
  },
]

export function TrustSection() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            import('gsap').then(({ gsap }) => {
              gsap.from(entry.target.querySelectorAll('.trust-card'), {
                y: 40, opacity: 0, stagger: 0.12, duration: 0.7, ease: 'power2.out',
              })
            })
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={ref} className="py-20 px-4" style={{ backgroundColor: 'var(--brown-dark)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-sm font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>
            Built for Ghana
          </p>
          <h2 className="text-4xl font-bold" style={{ color: 'var(--cream)' }}>
            Rent with Confidence
          </h2>
          <p className="mt-4 text-sm max-w-xl mx-auto" style={{ color: 'rgba(250,247,242,0.6)' }}>
            FieGH was built around Ghanaian culture, trust systems, and payment infrastructure.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {trust.map(({ icon: Icon, title, desc, color }) => (
            <div
              key={title}
              className="trust-card p-6 rounded-2xl border"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(245,192,106,0.15)' }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                style={{ backgroundColor: `${color}20` }}
              >
                <Icon size={22} style={{ color }} />
              </div>
              <h4 className="font-semibold mb-2" style={{ color: 'var(--cream)' }}>{title}</h4>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(250,247,242,0.55)' }}>{desc}</p>
            </div>
          ))}
        </div>

        {/* Scam warning */}
        <div
          className="mt-10 p-5 rounded-2xl flex items-start gap-3"
          style={{ backgroundColor: 'rgba(200,135,63,0.15)', border: '1px solid rgba(200,135,63,0.3)' }}
        >
          <span className="text-xl flex-shrink-0">⚠️</span>
          <p className="text-sm" style={{ color: 'rgba(250,247,242,0.8)' }}>
            <strong style={{ color: 'var(--gold)' }}>Stay safe:</strong> Never pay outside the FieGH app.
            FieGH does not support direct bank transfers or cash payments. Report any host asking you
            to pay outside the platform immediately.
          </p>
        </div>
      </div>
    </section>
  )
}

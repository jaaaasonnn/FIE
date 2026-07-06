'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const steps = [
  { num: '01', title: 'Search & Filter', desc: 'Choose your rental mode, region, dates and budget. Browse verified listings.' },
  { num: '02', title: 'Book & Pay Safely', desc: 'Instant Book or send a request. Pay via MoMo or card — funds held in escrow.' },
  { num: '03', title: 'Move In', desc: 'Get your confirmation with address and host contact. Payment releases to host on arrival.' },
  { num: '04', title: 'Review', desc: 'After your stay, rate your experience. Build trust in the Ghana rental community.' },
]

export function HowItWorksPreview() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const steps = sectionRef.current?.querySelectorAll('.step-item')
    const line = sectionRef.current?.querySelector('.step-line')
    const heading = sectionRef.current?.querySelector('.step-heading')

    steps?.forEach((el) => { (el as HTMLElement).style.opacity = '0'; (el as HTMLElement).style.transform = 'translateY(40px)' })
    if (heading) { (heading as HTMLElement).style.opacity = '0'; (heading as HTMLElement).style.transform = 'translateY(30px)' }
    if (line) { (line as HTMLElement).style.transform = 'scaleX(0)'; (line as HTMLElement).style.transformOrigin = 'left' }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            import('gsap').then(({ gsap }) => {
              const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
              if (heading) tl.to(heading, { y: 0, opacity: 1, duration: 0.7 })
              if (line) tl.to(line, { scaleX: 1, duration: 0.8, ease: 'power2.inOut' }, '-=0.2')
              tl.to(entry.target.querySelectorAll('.step-item'), {
                y: 0, opacity: 1, stagger: 0.18, duration: 0.7
              }, '-=0.5')
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
        <div className="step-heading text-center mb-14">
          <p className="text-sm font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--amber)' }}>
            Simple Process
          </p>
          <h2 className="text-4xl font-bold" style={{ color: 'var(--brown-dark)' }}>
            How FieGH Works
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
          {/* Connecting line */}
          <div
            className="step-line hidden lg:block absolute top-10 left-[12.5%] right-[12.5%] h-px"
            style={{ background: 'linear-gradient(90deg, transparent, var(--gold), transparent)', transformOrigin: 'left' }}
          />

          {steps.map(({ num, title, desc }) => (
            <div key={num} className="step-item relative text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 text-xl font-bold relative z-10"
                style={{
                  backgroundColor: 'var(--brown-dark)',
                  color: 'var(--gold)',
                  boxShadow: '0 8px 24px rgba(26,18,8,0.2)'
                }}
              >
                {num}
              </div>
              <h4 className="font-bold mb-2" style={{ color: 'var(--brown-dark)' }}>{title}</h4>
              <p className="text-sm text-stone-600 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--amber)' }}
          >
            Learn more about how FieGH works →
          </Link>
        </div>
      </div>
    </section>
  )
}

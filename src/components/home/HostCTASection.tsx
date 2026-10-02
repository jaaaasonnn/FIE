import Link from 'next/link'

export function HostCTASection() {
  return (
    <section className="pt-14 md:pt-20 pb-14 md:pb-20" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div
        className="pt-8 md:pt-10 border-t flex flex-col md:flex-row md:items-center md:justify-between gap-5"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <p className="text-lg md:text-xl font-semibold" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}>
          Have a home in Ghana? List it for short stays, monthly lets or long-term leases.
        </p>
        <Link
          href="/login?tab=signup&role=host"
          className="pressable focus-ring self-start md:self-auto flex-shrink-0 inline-flex items-center justify-center h-12 px-7 rounded-full text-sm font-bold whitespace-nowrap hover:bg-[var(--color-accent-hover)]"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
        >
          Start hosting
        </Link>
      </div>
      </div>
    </section>
  )
}

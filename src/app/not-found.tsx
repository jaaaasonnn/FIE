import Link from 'next/link'
import { House } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: 'var(--color-accent-subtle)' }}>
          <House size={36} strokeWidth={1.75} aria-hidden style={{ color: 'var(--color-accent-deep)' }} />
        </div>
        <h1 className="text-[2.25rem] mb-3" style={{ color: 'var(--color-text-primary)' }}>
          Page not found
        </h1>
        <p className="text-[#6B645C] mb-8">
          We couldn&apos;t find that page. The property might have been removed or the link is wrong.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="px-7 py-3.5 rounded-full text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
            Go home
          </Link>
          <Link href="/search" className="px-7 py-3.5 rounded-full text-sm font-semibold border"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-primary)' }}>
            Browse properties
          </Link>
        </div>
      </div>
    </div>
  )
}

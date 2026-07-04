import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--cream)' }}>
      <div className="max-w-md w-full text-center">
        <div className="text-8xl mb-6">🏠</div>
        <h1 className="text-4xl font-bold mb-3" style={{ color: 'var(--brown-dark)', fontFamily: 'Playfair Display, serif' }}>
          Page Not Found
        </h1>
        <p className="text-stone-600 mb-8">
          Hmm, we couldn't find that page. The property might have been removed or the link is wrong.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="px-7 py-3.5 rounded-full text-sm font-semibold"
            style={{ backgroundColor: 'var(--amber)', color: '#fff' }}>
            Go Home 🇬🇭
          </Link>
          <Link href="/search" className="px-7 py-3.5 rounded-full text-sm font-semibold border-2"
            style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
            Browse Properties
          </Link>
        </div>
      </div>
    </div>
  )
}

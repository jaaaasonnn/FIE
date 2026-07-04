import Link from 'next/link'
import { Home, Mail, Phone, MapPin } from 'lucide-react'

export function Footer() {
  return (
    <footer style={{ backgroundColor: 'var(--brown-dark)', color: 'var(--cream)' }}>
      {/* Warning banner */}
      <div className="bg-amber-900/40 border-b border-amber/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <p className="text-center text-sm" style={{ color: 'var(--gold-light)' }}>
            🛡️ Never pay outside the app. FieGH does not support direct bank transfers or cash payments.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--gold)' }}>
                <Home size={18} style={{ color: 'var(--brown-dark)' }} />
              </div>
              <span className="text-xl font-bold" style={{ fontFamily: 'Playfair Display, serif', color: 'var(--gold)' }}>
                FieGH
              </span>
            </Link>
            <p className="text-sm mb-4" style={{ color: 'rgba(250,247,242,0.65)', lineHeight: '1.6' }}>
              "Fie" means "home" in Twi. 🇬🇭<br />
              Ghana's premier rental marketplace connecting guests and hosts across all 16 regions.
            </p>
            <p className="text-xs italic" style={{ color: 'var(--gold)' }}>
              "Your home in Ghana"
            </p>
          </div>

          {/* Explore */}
          <div>
            <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--gold)', fontFamily: 'Playfair Display, serif' }}>
              Explore
            </h4>
            <ul className="space-y-2 text-sm" style={{ color: 'rgba(250,247,242,0.7)' }}>
              {[
                { href: '/search?mode=SHORT_STAY', label: 'Short Stays' },
                { href: '/search?mode=TEMP_STAY', label: 'Monthly Rentals' },
                { href: '/search?mode=PERMANENT', label: 'Long-Term Leases' },
                { href: '/search?region=Greater+Accra', label: 'Accra Properties' },
                { href: '/search?region=Ashanti', label: 'Kumasi Properties' },
              ].map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className="hover:text-amber-300 transition-colors">{label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Hosting */}
          <div>
            <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--gold)', fontFamily: 'Playfair Display, serif' }}>
              Hosting
            </h4>
            <ul className="space-y-2 text-sm" style={{ color: 'rgba(250,247,242,0.7)' }}>
              {[
                { href: '/auth/signup?role=host', label: 'Become a Host' },
                { href: '/how-it-works#hosts', label: 'How Hosting Works' },
                { href: '/dashboard/host', label: 'Host Dashboard' },
                { href: '/faq#hosting', label: 'Hosting FAQ' },
              ].map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className="hover:text-amber-300 transition-colors">{label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--gold)', fontFamily: 'Playfair Display, serif' }}>
              Support
            </h4>
            <ul className="space-y-2 text-sm mb-6" style={{ color: 'rgba(250,247,242,0.7)' }}>
              {[
                { href: '/how-it-works', label: 'How it Works' },
                { href: '/faq', label: 'FAQ' },
                { href: '/terms', label: 'Terms of Service' },
                { href: '/privacy', label: 'Privacy Policy' },
              ].map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className="hover:text-amber-300 transition-colors">{label}</Link>
                </li>
              ))}
            </ul>
            <div className="space-y-2 text-sm" style={{ color: 'rgba(250,247,242,0.5)' }}>
              <div className="flex items-center gap-2">
                <MapPin size={14} style={{ color: 'var(--gold)' }} />
                <span>Accra, Ghana 🇬🇭</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail size={14} style={{ color: 'var(--gold)' }} />
                <span>hello@fiegh.com</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone size={14} style={{ color: 'var(--gold)' }} />
                <span>+233 XX XXX XXXX</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs" style={{ color: 'rgba(250,247,242,0.4)' }}>
            © {new Date().getFullYear()} FieGH. Made with ❤️ in Ghana.
          </p>
          <div className="flex items-center gap-4 text-xs" style={{ color: 'rgba(250,247,242,0.4)' }}>
            <span>Payments by Paystack 🔒</span>
            <span>•</span>
            <span>MoMo & Card accepted</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

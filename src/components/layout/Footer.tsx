import Link from 'next/link'
import Image from 'next/image'
import { Mail, Phone, MapPin } from 'lucide-react'

export function Footer() {
  return (
    <footer style={{ backgroundColor: 'var(--brown-dark)', color: 'var(--cream)' }}>
      {/* Warning banner */}
      <div style={{ backgroundColor: 'rgba(200,135,63,0.12)', borderBottom: '1px solid rgba(240,184,78,0.15)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <p className="text-center text-sm" style={{ color: 'var(--gold-light)' }}>
            🛡️ Never pay outside the app. FieGH does not support direct bank transfers or cash payments.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-3 mb-5">
              <Image src="/logo.png" alt="FieGH" width={48} height={48} style={{ width: 48, height: 'auto' }} />
              <div className="flex flex-col leading-tight">
                <span className="text-xl font-bold" style={{ color: 'var(--gold)' }}>FieGH</span>
                <span className="text-[10px] tracking-widest" style={{ color: 'rgba(240,184,78,0.45)', letterSpacing: '0.18em' }}>GHANA RENTALS</span>
              </div>
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
            <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--gold)' }}>
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
            <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--gold)' }}>
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
            <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--gold)' }}>
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

        <div className="mt-12 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3" style={{ borderTop: '1px solid rgba(240,184,78,0.12)' }}>
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

import type { Metadata, Viewport } from 'next'
import { Manrope, Unbounded } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Toaster } from '@/components/ui/Toaster'
import { AuthProvider } from '@/context/AuthContext'
import { ExchangeRateProvider } from '@/context/ExchangeRateContext'
import { CHUNK_GUARD_SCRIPT } from '@/lib/chunkGuard'
import { BAR_LOADER_SCRIPT } from '@/lib/bottomBar'
import { APP_DESCRIPTION, APP_NAME } from '@/lib/appManifest'

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-manrope',
})

// Logo wordmark only ("fie."), never body or headline text
const unbounded = Unbounded({
  subsets: ['latin'],
  weight: ['900'],
  display: 'swap',
  variable: '--font-unbounded',
})

export const metadata: Metadata = {
  title: 'FieGH | Find your fie',
  description: APP_DESCRIPTION,
  keywords: 'FieGH, rental, Accra apartments, short stay, monthly rental, Kumasi, fie means home Twi, Ghanaian hospitality',
  openGraph: {
    title: 'FieGH | Find your fie',
    description: 'Premium short stays, monthly lets, and long-term leases. Homes with Ghanaian roots.',
    type: 'website',
    locale: 'en_GH'
  },
  // The installed app on an iPhone (stage 4): its name under the icon, and the status bar drawn above the page, not
  // over it ("default"), so nothing sits under the Dynamic Island. The manifest (src/lib/appManifest.ts) has the rest.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'default' },
}

// viewport-fit=cover: the phone's bottom bar reaches the bottom edge and keeps clear of the iPhone's home bar
// with env(safe-area-inset-bottom) (globals.css)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${unbounded.variable}`}>
      <head>
        {/* Notices an app script that did not arrive (lib/chunkGuard.ts). A module, so the page is not held
            at it until the stylesheets above it have loaded, as a plain inline script would be: files that
            fail before it runs are found by its check when the page has loaded. */}
        <script type="module" dangerouslySetInnerHTML={{ __html: CHUNK_GUARD_SCRIPT }} />
        {/* The phone's bottom bar: its unread badge (public/bar.js), loaded at phone widths only (lib/bottomBar.ts) */}
        <script dangerouslySetInnerHTML={{ __html: BAR_LOADER_SCRIPT }} type="module" />
      </head>
      <body className={manrope.className}>
        <AuthProvider>
          <ExchangeRateProvider>
            <Navbar />
            <main className="min-h-screen">
              {children}
            </main>
            <Footer />
            <Toaster />
          </ExchangeRateProvider>
        </AuthProvider>
      </body>
    </html>
  )
}

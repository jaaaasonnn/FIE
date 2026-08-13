import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Toaster } from '@/components/ui/Toaster'
import { AuthProvider } from '@/context/AuthContext'

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-manrope',
})

export const metadata: Metadata = {
  title: 'FieGH — Find your fie',
  description: 'Short stays, monthly lets, and long-term leases — with Ghanaian roots and warm hospitality. Find your perfect home or start hosting on FieGH.',
  keywords: 'FieGH, rental, Accra apartments, short stay, monthly rental, Kumasi, fie means home Twi, Ghanaian hospitality',
  openGraph: {
    title: 'FieGH — Find your fie',
    description: 'Premium short stays, monthly lets, and long-term leases. Homes with Ghanaian roots.',
    type: 'website',
    locale: 'en_GH'
  }
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className={manrope.className}>
        <AuthProvider>
          <Navbar />
          <main className="min-h-screen">
            {children}
          </main>
          <Footer />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  )
}

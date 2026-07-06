import type { Metadata } from 'next'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Toaster } from '@/components/ui/Toaster'

export const metadata: Metadata = {
  title: 'FieGH — Your Home in Ghana 🇬🇭',
  description: 'Find your perfect short stay, temporary or permanent rental across all 16 regions of Ghana. FieGH connects guests and hosts for premium Ghanaian living.',
  keywords: 'Ghana rental, Accra apartments, short stay Ghana, monthly rental Kumasi, FieGH, fie means home Twi',
  openGraph: {
    title: 'FieGH — Your Home in Ghana 🇬🇭',
    description: 'Premium property rentals across Ghana. Short stays, monthly lets, and long-term leases.',
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
    <html lang="en">
      <body>
        <Navbar />
        <main className="min-h-screen">
          {children}
        </main>
        <Footer />
        <Toaster />
      </body>
    </html>
  )
}

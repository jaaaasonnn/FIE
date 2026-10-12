// Every page of the site, for each kind of visitor, with real ids filled in.
import type { Actor, World } from './world'

export type Visitor = 'signed out' | 'guest' | 'host' | 'admin'
export type Stop = { name: string; path: string }
export type Site = { guest: Actor; host: Actor; admin: Actor; listingId: string; bookingId: string; pages: Record<Visitor, Stop[]> }

/** Makes one host with a home, one guest with an unpaid booking there, and one admin, and lists every page each can open. */
export async function buildSite(world: World): Promise<Site> {
  const admin = await world.admin()
  const host = await world.host()
  const guest = await world.guest()
  const home = await world.listing(host, { title: `E2E crawl home ${Date.now().toString(36)}` })
  const bookingId = await world.mustBook(guest, home.id)
  const L = home.id
  const pages: Record<Visitor, Stop[]> = {
    'signed out': [
      { name: 'home', path: '/' }, { name: 'search', path: '/search' }, { name: 'search (short stays in Cape Coast)', path: '/search?mode=SHORT_STAY&city=Cape+Coast' },
      { name: 'listing', path: `/listings/${L}` }, { name: 'host profile', path: `/profile/${host.id}` },
      { name: 'log in', path: '/login' }, { name: 'sign up', path: '/login?tab=signup' }, { name: 'sign up as host', path: '/login?tab=signup&role=host' },
      { name: 'forgot password', path: '/auth/forgot-password' }, { name: 'reset password (bad link)', path: '/auth/reset-password?token=not-a-real-token' },
      { name: 'confirm email (bad link)', path: '/auth/confirm-email?token=not-a-real-token' },
      { name: 'faq', path: '/faq' }, { name: 'how it works', path: '/how-it-works' }, { name: 'privacy', path: '/privacy' }, { name: 'terms', path: '/terms' },
    ],
    guest: [
      { name: 'guest dashboard', path: '/dashboard/guest' }, { name: 'guest messages', path: '/dashboard/guest/messages' }, { name: 'guest payments', path: '/dashboard/guest/payments' },
      { name: 'wishlist', path: '/dashboard/guest/wishlist' }, { name: 'booking', path: `/bookings/${bookingId}` }, { name: 'report a problem', path: `/bookings/${bookingId}/problem` },
      { name: 'checkout', path: `/checkout/${bookingId}` }, { name: 'edit profile', path: '/profile/edit' }, { name: 'send ID', path: '/auth/verify-id' },
      { name: 'become a host', path: '/become-a-host' }, { name: 'listing (signed in)', path: `/listings/${L}` }, { name: 'home (signed in)', path: '/' },
    ],
    host: [
      { name: 'host dashboard', path: '/dashboard/host' }, { name: 'host bookings', path: '/dashboard/host/bookings' }, { name: 'new listing', path: '/dashboard/host/listings/new' },
      { name: 'edit listing', path: `/dashboard/host/listings/${L}/edit` }, { name: 'calendar', path: `/dashboard/host/listings/${L}/calendar` },
      { name: 'host messages', path: '/dashboard/host/messages' }, { name: 'payouts', path: '/dashboard/host/payouts' }, { name: 'edit profile (host)', path: '/profile/edit' },
    ],
    admin: [{ name: 'admin', path: '/admin' }],
  }
  return { guest, host, admin, listingId: L, bookingId, pages }
}
export const ADMIN_TABS = ['Overview', 'Users', 'Listings', 'Bookings', 'Payments', 'Verifications', 'Listing checks', 'Disputes', 'Rent', 'Messages', 'Reviews', 'Settings']

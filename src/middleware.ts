import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware runs at the Edge — no Prisma/Node.js available.
 * Strategy: check for the presence of the session cookie.
 *   • Cookie present  → allow through (the route handler / client validates fully)
 *   • Cookie absent   → redirect to /login?redirect=<original-path>
 *
 * Protected prefixes: /dashboard, /checkout
 * Public: everything else (homepage, /search, /listings/*, /login, /api/*)
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const session = request.cookies.get('fiegh_session')

  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  // Only run middleware on routes that need protection
  matcher: ['/dashboard/:path*', '/checkout/:path*'],
}

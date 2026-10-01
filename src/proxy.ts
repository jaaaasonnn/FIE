import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Proxy runs before routes are rendered (Next.js 16 equivalent of middleware).
 * Strategy: check for the presence of the session cookie.
 *   • Cookie present  → allow through (full validation happens in the route handler)
 *   • Cookie absent   → redirect to /login?redirect=<original-path-and-query>
 *
 * Protected prefixes: /dashboard, /checkout, /admin
 * Public: everything else (homepage, /search, /listings/*, /login, /api/*)
 * Role checks (e.g. ADMIN) happen in page/API handlers — proxy only checks session cookie.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const session = request.cookies.get('fiegh_session')

  if (!session) {
    const loginUrl = new URL('/login', request.url)
    // Keep the query (e.g. ?guestId=…) so deep links survive the login round trip
    loginUrl.searchParams.set('redirect', pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/checkout/:path*', '/admin', '/admin/:path*'],
}

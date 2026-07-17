import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Proxy runs before routes are rendered (Next.js 16 equivalent of middleware).
 * Strategy: check for the presence of the session cookie.
 *   • Cookie present  → allow through (full validation happens in the route handler)
 *   • Cookie absent   → redirect to /login?redirect=<original-path>
 *
 * Protected prefixes: /dashboard, /checkout
 * Public: everything else (homepage, /search, /listings/*, /login, /api/*)
 */
export function proxy(request: NextRequest) {
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
  matcher: ['/dashboard/:path*', '/checkout/:path*'],
}

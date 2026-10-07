import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { hostAreaRedirect } from '@/lib/roles'

/**
 * Everything under /dashboard/host is for hosts. The check runs on the server
 * before any host page is sent: a guest goes to /become-a-host, an admin to
 * the admin panel, and a visitor whose session has gone to log in. (A visitor
 * with no session cookie at all is already sent to log in by src/proxy.ts,
 * which keeps the address they asked for.)
 *
 * This decides what is shown. What can be done is decided again by each API
 * route, with requireHost() from lib/roles.ts.
 */
export default async function HostAreaLayout({ children }: { children: React.ReactNode }) {
  const to = hostAreaRedirect(await getSessionUser())
  if (to) redirect(to)
  return <>{children}</>
}

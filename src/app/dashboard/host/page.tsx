import { GET as session } from '@/app/api/auth/session/route'
import { GET as listings } from '@/app/api/listings/route'
import { GET as bookings } from '@/app/api/bookings/route'
import { GET as notifications } from '@/app/api/notifications/route'
import { GET as payouts } from '@/app/api/payouts/route'
import { serverRead } from '@/lib/serverRead'
import type { AuthUser } from '@/context/AuthContext'
import type { Notification } from '@/components/NotificationsList'
import type { HostIdLoaded } from '@/components/host/HostIdNotice'
import { HostDashboardClient, type HostDashboardInitial } from './HostDashboardClient'

// The dashboard comes with its data (lib/serverRead.ts): the same session check and the same reads the
// browser makes, including those of the notices above it, so nothing arrives later and pushes the page
// down. If the listings or bookings have no answer, the page fetches them in the browser as before.
// (layout.tsx has already sent anyone who is not a host elsewhere.)
export default async function HostDashboardPage() {
  const me = await serverRead<{ user: AuthUser }>('/api/auth/session', session)
  let initial: HostDashboardInitial = null
  if (me?.user) {
    const id = encodeURIComponent(me.user.id)
    const [l, b, n, p] = await Promise.all([
      serverRead<{ listings?: unknown }>(`/api/listings?hostId=${id}&limit=50`, listings),
      serverRead<{ bookings?: unknown }>(`/api/bookings?hostId=${id}`, bookings),
      serverRead<{ notifications: Notification[] }>('/api/notifications', notifications),
      serverRead<{ idState?: HostIdLoaded['idState']; waitingForId?: HostIdLoaded['waitingForId'] }>(`/api/payouts?hostId=${id}`, payouts),
    ])
    if (l && b) {
      initial = {
        user: me.user,
        listings: Array.isArray(l.listings) ? l.listings : [],
        bookings: Array.isArray(b.bookings) ? b.bookings : [],
        notifications: n?.notifications ?? null,
        hostId: p?.idState ? { idState: p.idState, waitingForId: p.waitingForId ?? null } : null,
      }
    }
  }
  return <HostDashboardClient initial={initial} />
}

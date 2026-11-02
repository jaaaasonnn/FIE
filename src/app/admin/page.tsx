import { GET as session } from '@/app/api/auth/session/route'
import { GET as admin } from '@/app/api/admin/route'
import { GET as notifications } from '@/app/api/notifications/route'
import { serverRead } from '@/lib/serverRead'
import type { AuthUser } from '@/context/AuthContext'
import type { Notification } from '@/components/NotificationsList'
import { AdminClient, type AdminInitial } from './AdminClient'

// The Overview comes with the page (lib/serverRead.ts): the same session check and the same two reads the
// browser makes for it. The routes decide who may read them (requireAdmin); anyone else gets no answer
// here and the page goes on as before. The other tabs load in the browser when they are opened.
export default async function AdminPage() {
  const me = await serverRead<{ user: AuthUser }>('/api/auth/session', session)
  let initial: AdminInitial = null
  if (me?.user?.role === 'ADMIN') {
    const [stats, rate, unread] = await Promise.all([
      serverRead<NonNullable<AdminInitial>['stats']>('/api/admin?type=stats', admin),
      serverRead<NonNullable<AdminInitial>['rate']>('/api/admin?type=exchange-rate', admin),
      serverRead<{ notifications: Notification[] }>('/api/notifications', notifications),
    ])
    if (stats && rate) initial = { user: me.user, stats, rate, notifications: unread?.notifications ?? null }
  }
  return <AdminClient initial={initial} />
}

import { GET as session } from '@/app/api/auth/session/route'
import { GET as bookings } from '@/app/api/bookings/route'
import { GET as wishlists } from '@/app/api/wishlists/route'
import { GET as reviews } from '@/app/api/reviews/route'
import { GET as messages } from '@/app/api/messages/route'
import { GET as notifications } from '@/app/api/notifications/route'
import type { Notification } from '@/components/NotificationsList'
import { serverRead } from '@/lib/serverRead'
import type { AuthUser } from '@/context/AuthContext'
import { GuestDashboardClient, type GuestDashboardInitial } from './GuestDashboardClient'
import { BottomBar } from '@/components/layout/BottomBar'

// The dashboard comes with its data (lib/serverRead.ts): the same session check and the same five reads
// the browser makes, in the same process. If any has no answer, the page does it all in the browser as before.
type Answer = Record<string, unknown>

export default async function GuestDashboardPage() {
  const me = await serverRead<{ user: AuthUser }>('/api/auth/session', session)
  let initial: GuestDashboardInitial = null
  if (me?.user) {
    const id = encodeURIComponent(me.user.id)
    const [unread, ...answers] = await Promise.all([
      serverRead<{ notifications: Notification[] }>('/api/notifications', notifications),
      serverRead<Answer>(`/api/bookings?guestId=${id}`, bookings),
      serverRead<Answer>(`/api/wishlists?userId=${id}`, wishlists),
      serverRead<Answer>(`/api/reviews?reviewerId=${id}`, reviews),
      serverRead<Answer>('/api/messages', messages),
      serverRead<Answer>('/api/reviews?mine=true', reviews),
    ])
    if (answers.every((a) => a !== null)) {
      initial = { user: me.user, answers: answers as NonNullable<GuestDashboardInitial>['answers'], notifications: unread?.notifications ?? null }
    }
  }
  return <><GuestDashboardClient initial={initial} /><BottomBar active="trips" /></>
}

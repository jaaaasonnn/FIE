import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'

// The bottom bar's Messages tab (components/layout/BottomBar.tsx): one address for everyone, sent on to the
// right inbox here, on the server. Signed out, the proxy has already sent the person to log in and back.
export default async function MessagesPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?redirect=/messages')
  redirect(user.role === 'HOST' ? '/dashboard/host/messages' : '/dashboard/guest/messages')
}

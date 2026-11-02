import { BottomBar } from '@/components/layout/BottomBar'
import BookingConfirmationPage from './BookingPageClient'

// A booking, reached from Trips: the page itself is BookingPageClient.tsx, unchanged; this adds the phone's
// bottom bar on the server. (Not as a layout: /bookings/[id]/problem, a form, has no bar.)
export default function BookingPage() {
  return <><BookingConfirmationPage /><BottomBar active="trips" /></>
}

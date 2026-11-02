import { GET } from '@/app/api/bookings/route'
import { serverRead } from '@/lib/serverRead'
import { CheckoutClient, type CheckoutInitial } from './CheckoutClient'

// The booking comes with the page (lib/serverRead.ts). If the server has no answer for it, the page
// fetches it in the browser as before.
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const initial = await serverRead<CheckoutInitial>(`/api/bookings?id=${encodeURIComponent(id)}`, GET)
  return <CheckoutClient key={id} initial={initial} />
}

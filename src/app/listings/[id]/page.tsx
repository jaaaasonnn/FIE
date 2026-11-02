import { GET as session } from '@/app/api/auth/session/route'
import { GET as listingGet } from '@/app/api/listings/[id]/route'
import { GET as availabilityGet } from '@/app/api/listings/[id]/availability/route'
import { serverRead } from '@/lib/serverRead'
import type { AuthUser } from '@/context/AuthContext'
import { ListingClient, type ListingInitial } from './ListingClient'

// The listing comes with the page (lib/serverRead.ts), so its first photo and title are in the HTML. If
// the server has no answer for it (not found included), the page fetches it in the browser as before.
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ListingPage({ params, searchParams }: Props) {
  const { id } = await params
  const q = await searchParams
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : null)
  const path = `/api/listings/${encodeURIComponent(id)}`
  const route = async () => ({ id })
  const [me, listing, availability] = await Promise.all([
    serverRead<{ user: AuthUser }>('/api/auth/session', session),
    serverRead<{ listing: NonNullable<ListingInitial['listing']> }>(path, (req) => listingGet(req, { params: route() })),
    serverRead<NonNullable<ListingInitial['availability']>>(`${path}/availability`, (req) => availabilityGet(req, { params: route() })),
  ])
  const initial: ListingInitial = {
    user: me?.user ?? null,
    listing: listing?.listing ?? null,
    availability: availability ? { bookedRanges: availability.bookedRanges ?? [], blockedDates: availability.blockedDates ?? [] } : null,
    prefill: { mode: one('mode'), checkIn: one('checkIn'), checkOut: one('checkOut'), months: one('months') },
  }
  return <ListingClient key={id} initial={initial} />
}

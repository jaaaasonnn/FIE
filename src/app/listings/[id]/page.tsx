import { GET as session } from '@/app/api/auth/session/route'
import { GET as listingGet } from '@/app/api/listings/[id]/route'
import { GET as availabilityGet } from '@/app/api/listings/[id]/availability/route'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { serverRead } from '@/lib/serverRead'
import type { AuthUser } from '@/context/AuthContext'
import { ListingClient, type ListingInitial } from './ListingClient'

// The listing comes with the page (lib/serverRead.ts), so its first photo and title are in the HTML. If
// the server has no answer for it (not found included), the page fetches it in the browser as before.
// Only when there is no listing with this id at all is the answer a real 404 (AS22). A listing that exists but
// is not shown to this person (switched off, on hold, host suspended) is left exactly as it was: 200, and the
// browser asks for it, as its host, an admin or a guest who booked it may be signed in there.
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
  // Asked only when the listing did not come: one lookup by id, and if that fails the page goes on as before
  if (!listing && !(await listingExists(id))) notFound()
  const initial: ListingInitial = {
    user: me?.user ?? null,
    listing: listing?.listing ?? null,
    availability: availability ? { bookedRanges: availability.bookedRanges ?? [], blockedDates: availability.blockedDates ?? [] } : null,
    prefill: { mode: one('mode'), checkIn: one('checkIn'), checkOut: one('checkOut'), months: one('months') },
  }
  return <ListingClient key={id} initial={initial} />
}

/** Whether any listing has this id, whoever may see it. True when the database cannot say, or not within a second
 *  (then the page goes on exactly as before: the browser asks). */
async function listingExists(id: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const late = new Promise<true>((resolve) => { timer = setTimeout(() => resolve(true), 1000) })
    const found = db.listing.findUnique({ where: { id }, select: { id: true } }).then((l) => !!l)
    return await Promise.race([found, late])
  } catch {
    return true
  } finally {
    clearTimeout(timer)
  }
}

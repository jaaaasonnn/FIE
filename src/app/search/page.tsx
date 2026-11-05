import { GET } from '@/app/api/listings/route'
import { serverRead } from '@/lib/serverRead'
import { searchQuery, startingFilters } from '@/lib/searchQuery'
import { livePlaces, shownRate } from '@/lib/explore'
import { ghanaToday } from '@/lib/stayDates'
import { SearchSheet } from '@/components/search/SearchSheet'
import { SearchClient, type SearchInitial } from './SearchClient'

// The first search runs with the page (lib/serverRead.ts), so the first homes and their photos are in the
// HTML. The same query the browser would send, for the address's filters (lib/searchQuery.ts). Without an
// answer the page searches from the browser as before. Everything after the first search (typing,
// filters) is the browser's, as it always was.
//
// On a phone the search is changed in the search sheet (components/search/SearchSheet.tsx), drawn here with the
// address's values so it works with no script; its places to suggest and the rate the cards are drawn with are
// read here too. Either read failing leaves the page as it would be without it.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function SearchPage({ searchParams }: Props) {
  const q = await searchParams
  const get = (key: string) => (typeof q[key] === 'string' ? (q[key] as string) : null)
  const filters = startingFilters(get)
  const [initial, places, rate] = await Promise.all([
    serverRead<NonNullable<SearchInitial>>(`/api/listings?${searchQuery(filters)}`, GET),
    livePlaces().catch(() => [] as string[]),
    shownRate().catch(() => undefined),
  ])
  return (
    <>
      <SearchClient initial={initial} rate={rate} />
      <SearchSheet places={places} today={ghanaToday()}
        values={{ q: filters.query, mode: filters.mode, checkIn: filters.checkIn, checkOut: filters.checkOut, months: filters.months, guests: filters.guests }} />
    </>
  )
}

import { GET } from '@/app/api/listings/route'
import { serverRead } from '@/lib/serverRead'
import { searchQuery, startingFilters } from '@/lib/searchQuery'
import { SearchClient, type SearchInitial } from './SearchClient'

// The first search runs with the page (lib/serverRead.ts), so the first homes and their photos are in the
// HTML. The same query the browser would send, for the address's filters (lib/searchQuery.ts). Without an
// answer the page searches from the browser as before. Everything after the first search (typing,
// filters) is the browser's, as it always was.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function SearchPage({ searchParams }: Props) {
  const q = await searchParams
  const filters = startingFilters((key) => (typeof q[key] === 'string' ? (q[key] as string) : null))
  const initial = await serverRead<NonNullable<SearchInitial>>(`/api/listings?${searchQuery(filters)}`, GET)
  return <SearchClient initial={initial} />
}

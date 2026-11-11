import { ListingNotFound } from './ListingNotFound'

// There is no listing with this id at all (page.tsx calls notFound()): the same words as the page draws for a
// listing it cannot show, with HTTP 404 (AS22)
export default function ListingMissing() {
  return <ListingNotFound />
}

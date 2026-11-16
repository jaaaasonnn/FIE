import { db } from './db'

// Photos for a test home (tester-fixes-2). The addresses are Unsplash's, which the browser fetches from the fake
// storage server (lib/test.ts routes images.unsplash.com there); each address gives one of its test pictures.
export function photoUrls(n = 6): string[] {
  return Array.from({ length: n }, (_, i) => `https://images.unsplash.com/photo-15026722${60 + i}2-1c1ef2d93688?w=1200&q=80`)
}

/** Gives the listing `n` photos, as a host's uploads would leave them (one JSON column) */
export async function withPhotos(listingId: string, n = 6): Promise<string[]> {
  const photos = photoUrls(n)
  await db.listing.update({ where: { id: listingId }, data: { photos: JSON.stringify(photos) } })
  return photos
}

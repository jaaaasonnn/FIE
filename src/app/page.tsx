import { db } from '@/lib/db'
import { RENTAL_MODES, type RentalMode } from '@/lib/rentalModes'
import { HeroSection, type ModePhoto } from '@/components/home/HeroSection'
import { FeaturedListings } from '@/components/home/FeaturedListings'
import { RegionsSection } from '@/components/home/RegionsSection'
import { HostCTASection } from '@/components/home/HostCTASection'

// The hero photos come from live listings, so refresh them hourly rather
// than baking one set in at build time.
export const revalidate = 3600

// next/image resizes the hero photos per device, so Unsplash is asked for one
// generous source size and local files are used as they are.
const HERO_SOURCE_WIDTH = 1600

// Used only when a rental type has no active listing with a usable cover
// photo (or the database is unreachable); the panel then has no link. All
// three are Unsplash photographs taken in Ghana.
const FALLBACK_PHOTOS: Record<RentalMode, Omit<ModePhoto, 'listingId' | 'location'>> = {
  SHORT_STAY: {
    src: 'https://images.unsplash.com/photo-1591465709469-5de113a071cc?w=1400&q=80',
    alt: 'A two-storey house behind coconut palms and a lawn in Prampram',
  },
  TEMP_STAY: {
    src: 'https://images.unsplash.com/photo-1568025848823-86404cd04ad1?w=1400&q=80',
    alt: 'Accra seen from above',
  },
  PERMANENT: {
    src: 'https://images.unsplash.com/photo-1589749714123-a1a4ee1702ff?w=1400&q=80',
    alt: 'A row of family houses behind plantain trees in Sekondi-Takoradi',
  },
}

// Cover photos that must never reach the hero, matched by Unsplash photo id.
// A listing whose cover is here is passed over for the next one.
const HERO_REJECTED = [
  'photo-1777052854737', // Kumasi villa patio: overexposed
  'photo-1757862351841', // Cantonments studio: blown-out window, sofa cut off
]

// Monthly chooses first, so it keeps the same home when the other two types
// are also drawing from listings. After that, the type with the fewest
// listings goes first so it is not left without a pick.
const FIRST_PICK: RentalMode = 'TEMP_STAY'

function heroSrc(url: string) {
  if (!url.includes('images.unsplash.com')) return url
  return url.replace(/([?&])w=\d+/, `$1w=${HERO_SOURCE_WIDTH}`)
}

/**
 * One real listing per rental type, shown by its cover photo and linked to its
 * page. Never the same home or the same photo twice.
 */
async function getModePhotos(): Promise<Record<RentalMode, ModePhoto>> {
  const photos = {} as Record<RentalMode, ModePhoto>
  const usedListings = new Set<string>()
  const usedPhotos = new Set<string>()
  const rejected = (photo: string) => HERO_REJECTED.some((id) => photo.includes(id))

  const candidates = await Promise.all(
    RENTAL_MODES.map(async ({ value }) => {
      try {
        const listings = await db.listing.findMany({
          where: { isActive: true, rentalModes: { contains: value }, NOT: { photos: '[]' } },
          orderBy: [{ isFeatured: 'desc' }, { avgRating: 'desc' }],
          select: { id: true, title: true, city: true, neighbourhood: true, photos: true },
          take: 8,
        })
        return { value, listings }
      } catch {
        return { value, listings: [] }
      }
    }),
  )

  const order = [...candidates].sort(
    (a, b) => Number(b.value === FIRST_PICK) - Number(a.value === FIRST_PICK) || a.listings.length - b.listings.length,
  )

  for (const { value, listings } of order) {
    const pick = listings
      .map((l) => ({ ...l, photo: (JSON.parse(l.photos || '[]') as string[])[0] }))
      .find((l) => l.photo && !rejected(l.photo) && !usedListings.has(l.id) && !usedPhotos.has(l.photo))

    if (pick) {
      usedListings.add(pick.id)
      usedPhotos.add(pick.photo)
      photos[value] = {
        src: heroSrc(pick.photo),
        alt: pick.title,
        listingId: pick.id,
        location: [pick.neighbourhood, pick.city].filter(Boolean).join(', '),
      }
    } else {
      const fallback = FALLBACK_PHOTOS[value]
      photos[value] = { ...fallback, src: heroSrc(fallback.src) }
    }
  }

  return photos
}

export default async function HomePage() {
  const modePhotos = await getModePhotos()

  return (
    <>
      <HeroSection photos={modePhotos} />
      <FeaturedListings />
      <RegionsSection />
      <HostCTASection />
    </>
  )
}

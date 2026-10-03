import { preconnect, preload } from 'react-dom'
import { db } from '@/lib/db'
import { RENTAL_MODES, type RentalMode } from '@/lib/rentalModes'
import { HeroSection, type ModePhoto } from '@/components/home/HeroSection'
import { FeaturedListings } from '@/components/home/FeaturedListings'
import { RegionsSection } from '@/components/home/RegionsSection'
import { HostCTASection } from '@/components/home/HostCTASection'

// The hero photos come from live listings, so refresh them hourly rather
// than baking one set in at build time.
export const revalidate = 3600

// Used when a rental type has no listing with a photo yet (or the database
// is unreachable). All three are geotagged Ghana photographs.
const FALLBACK_PHOTOS: Record<RentalMode, { src: string; alt: string }> = {
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

// Rental types that always show their curated photo. The short-stay and
// long-term listings seeded so far do not lead with a photo fit for the hero;
// remove an entry once real listings of that type have good photography.
const CURATED_ONLY = new Set<RentalMode>(['SHORT_STAY', 'PERMANENT'])

// Listing photos that must never reach the hero (overexposed, off-subject).
// A listing whose lead photo is here is passed over for the next one.
const HERO_REJECTED = new Set([
  'https://images.unsplash.com/photo-1777052854737-7893f50de539?w=900&q=80',
])

// Unsplash serves any width on request, so hero photos get a srcset and
// phones are not sent the desktop-sized file. Other hosts (listing uploads)
// are used as they are.
const HERO_WIDTHS = [640, 960, 1400]
const HERO_SIZES = '(min-width: 768px) 720px, 100vw'

function heroPhoto(url: string) {
  if (!url.includes('images.unsplash.com')) return { src: url }
  const at = (w: number) => url.replace(/([?&])w=\d+/, `$1w=${w}`).replace(/([?&])q=\d+/, '$1q=70')
  return {
    src: at(1400),
    srcSet: HERO_WIDTHS.map((w) => `${at(w)} ${w}w`).join(', '),
    sizes: HERO_SIZES,
  }
}

/** One real listing photo per rental type, never the same home or photo twice. */
async function getModePhotos(): Promise<Record<RentalMode, ModePhoto>> {
  const photos = {} as Record<RentalMode, ModePhoto>
  const usedListings = new Set<string>()
  const usedPhotos = new Set<string>(HERO_REJECTED)

  // Fill the type with the fewest listings first so it gets first pick.
  const candidates = await Promise.all(
    RENTAL_MODES.map(async ({ value }) => {
      if (CURATED_ONLY.has(value)) return { value, listings: [] }
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

  for (const { value, listings } of [...candidates].sort((a, b) => a.listings.length - b.listings.length)) {
    const pick = listings
      .map((l) => ({ ...l, photo: (JSON.parse(l.photos || '[]') as string[])[0] }))
      .find((l) => l.photo && !usedListings.has(l.id) && !usedPhotos.has(l.photo))

    if (pick) {
      usedListings.add(pick.id)
      usedPhotos.add(pick.photo)
      photos[value] = {
        ...heroPhoto(pick.photo),
        alt: pick.title,
        listingId: pick.id,
        location: [pick.neighbourhood, pick.city].filter(Boolean).join(', '),
      }
    } else {
      const fallback = FALLBACK_PHOTOS[value]
      photos[value] = { ...heroPhoto(fallback.src), alt: fallback.alt }
    }
  }

  return photos
}

export default async function HomePage() {
  const modePhotos = await getModePhotos()

  // The first panel's photo is the largest thing above the fold: tell the
  // browser about it before it reaches the <img>.
  const lead = modePhotos.SHORT_STAY
  preconnect('https://images.unsplash.com')
  preload(lead.src, {
    as: 'image',
    imageSrcSet: lead.srcSet,
    imageSizes: lead.sizes,
    fetchPriority: 'high',
  })

  return (
    <>
      <HeroSection photos={modePhotos} />
      <FeaturedListings />
      <RegionsSection />
      <HostCTASection />
    </>
  )
}

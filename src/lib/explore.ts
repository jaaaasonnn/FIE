import { db } from '@/lib/db'
import { cached } from '@/lib/shortCache'
import { HOST_NOT_SUSPENDED } from '@/lib/suspension'
import { liveChecksInclude } from '@/lib/listingChecks'
import { liveCheck, publicCheck, type PublicCheck } from '@/lib/listingCheckRules'
import { CARDS_PER_ROW, MIN_CITY_ROWS, cardPrice, cityKey, pickCities, type CardPrice } from '@/lib/exploreRows'

// What Explore shows on a phone (app shell, stage 2): rows of live homes per city, read with the home page.
// The page is kept ready made and drawn again at most once a minute or after a change that could take a home
// off it (lib/homePage.ts), so these reads run then, never once per visit: one read of every live home's city,
// then one per row, at most five in all.

/**
 * A live home: switched on, not on hold, its host not suspended, with a photo. A home on hold has isActive
 * false, so isActive alone already leaves it out; moderationHold is named too, as the hero's query does.
 */
export const LIVE_HOME = {
  isActive: true,
  moderationHold: false,
  host: { ...HOST_NOT_SUSPENDED },
  NOT: { photos: '[]' },
} as const

export type ExploreCard = {
  id: string
  title: string
  city: string
  neighbourhood: string | null
  photo: string
  avgRating: number
  reviewCount: number
  price: CardPrice | null
  check: PublicCheck | null
}

export type ExploreRow = { kind: 'city'; city: string; homes: ExploreCard[] } | { kind: 'more'; homes: ExploreCard[] }

export type Explore = {
  rows: ExploreRow[]
  /** USD to GHS, as guests are shown it (GET /api/exchange-rate) */
  rate: number
  /** Places to suggest in the search sheet: the cities with live homes, the most homes first */
  places: string[]
  /** The database could not be read while the site was being built: the rows say so and link to search */
  failed: boolean
}

const CARD_SELECT = {
  id: true, title: true, city: true, neighbourhood: true, photos: true, avgRating: true, reviewCount: true,
  rentalModes: true, priceNightly: true, priceMonthly: true, priceAnnual: true,
} as const

const ORDER = [{ isFeatured: 'desc' as const }, { avgRating: 'desc' as const }, { createdAt: 'desc' as const }]

function parseList(value: string | null | undefined): string[] {
  try {
    const list = JSON.parse(value || '[]')
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
  } catch {
    return []
  }
}

type Row = {
  id: string; title: string; city: string; neighbourhood: string | null; photos: string; avgRating: number
  reviewCount: number; rentalModes: string; priceNightly: number | null; priceMonthly: number | null
  priceAnnual: number | null; checks?: { checkedAt: Date; expiresAt: Date; revokedAt: Date | null }[]
}

function toCard(l: Row, now: Date): ExploreCard | null {
  const photo = parseList(l.photos)[0]
  if (!photo) return null
  return {
    id: l.id, title: l.title, city: l.city, neighbourhood: l.neighbourhood, photo,
    avgRating: l.avgRating, reviewCount: l.reviewCount,
    price: cardPrice({ rentalModes: parseList(l.rentalModes), priceNightly: l.priceNightly, priceMonthly: l.priceMonthly, priceAnnual: l.priceAnnual }),
    check: publicCheck(liveCheck(l.checks, now)),
  }
}

/** The rate guests are shown: the same read, and the same short-kept answer, as GET /api/exchange-rate */
export function shownRate(): Promise<number> {
  return cached('exchange-rate', async () => {
    const rateRow = await db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' }, select: { usdToGhs: true } })
    return rateRow?.usdToGhs ?? Number(process.env.INITIAL_USD_TO_GHS ?? 15.5)
  })
}

async function readExplore(now: Date): Promise<Omit<Explore, 'failed'>> {
  const [homes, rate] = await Promise.all([
    db.listing.findMany({ where: LIVE_HOME, select: { city: true } }),
    shownRate(),
  ])
  const cities = pickCities(homes.map((h) => h.city))
  const include = { checks: liveChecksInclude(now) }

  const cityRows = await Promise.all(cities.map(async (c) => {
    const found = await db.listing.findMany({
      where: { ...LIVE_HOME, city: { in: c.variants } },
      select: { ...CARD_SELECT, ...include }, orderBy: ORDER, take: CARDS_PER_ROW,
    }) as Row[]
    return { kind: 'city' as const, city: c.label, homes: found.map((l) => toCard(l, now)).filter((x): x is ExploreCard => !!x) }
  }))
  const rows: ExploreRow[] = cityRows.filter((r) => r.homes.length > 0)

  if (rows.length < MIN_CITY_ROWS && homes.length > 0) {
    const shown = rows.flatMap((r) => r.homes.map((h) => h.id))
    const more = await db.listing.findMany({
      where: { ...LIVE_HOME, ...(shown.length ? { id: { notIn: shown } } : {}) },
      select: { ...CARD_SELECT, ...include }, orderBy: ORDER, take: CARDS_PER_ROW,
    }) as Row[]
    const cards = more.map((l) => toCard(l, now)).filter((x): x is ExploreCard => !!x)
    if (cards.length > 0) rows.push({ kind: 'more', homes: cards })
  }

  return { rows, rate, places: placesOf(homes) }
}

/**
 * Places to suggest in the search sheet (components/search/SearchSheet.tsx): every city with a live home, the
 * most homes first, one spelling each. Kept for a few seconds (lib/shortCache.ts): the search page asks on
 * every visit.
 */
export function livePlaces(): Promise<string[]> {
  return cached('live-places', async () => placesOf(await db.listing.findMany({ where: LIVE_HOME, select: { city: true } })))
}

function placesOf(homes: { city: string }[]): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  for (const { city } of homes) {
    const key = cityKey(city)
    if (!key) continue
    const seen = counts.get(key)
    counts.set(key, { label: seen?.label ?? city.trim().replace(/\s+/g, ' '), n: (seen?.n ?? 0) + 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'en')).map((p) => p.label)
}

/**
 * Explore's rows. If the database cannot be read while the page is being drawn again, this throws, so Next
 * keeps serving the last good copy; only while the site is being built (no copy yet) does it answer with
 * `failed`, and the rows then say so and link to search.
 */
export async function getExplore(now: Date = new Date()): Promise<Explore> {
  try {
    return { ...(await readExplore(now)), failed: false }
  } catch (error) {
    if (process.env.NEXT_PHASE !== 'phase-production-build') throw error
    console.error('[Explore] could not read the homes while building:', error instanceof Error ? error.message : 'unknown')
    return { rows: [], rate: Number(process.env.INITIAL_USD_TO_GHS ?? 15.5), places: [], failed: true }
  }
}

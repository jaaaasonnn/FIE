'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

// Unsplash photo ids, each geotagged to the region it stands for
const regions = [
  // Aerial Accra cityscape, geotagged "Accra, Ghana"
  { name: 'Greater Accra', city: 'Accra',      photo: 'photo-1568025848823-86404cd04ad1' },
  // Aerial Adum, Kumasi, geotagged "Adum, Kumasi, Ghana"
  { name: 'Ashanti',       city: 'Kumasi',     photo: 'photo-1506126208421-3345d63a05d8' },
  // Atlantic coastline, geotagged "Takoradi, Ghana"
  { name: 'Western',       city: 'Takoradi',   photo: 'photo-1624832040555-d9f92f7be672' },
  // Elmina Castle (Central region, near Cape Coast), geotagged "Elmina, Ghana"
  { name: 'Central',       city: 'Cape Coast', photo: 'photo-1769297468250-dfdea4662b00' },
  // Aburi hills (Eastern region), geotagged "Aburi, Ghana"
  { name: 'Eastern',       city: 'Koforidua',  photo: 'photo-1670615431202-6a7159da3f6c' },
  // Aerial village, captioned "Drone Image from the Northern Region of Ghana"
  { name: 'Northern',      city: 'Tamale',     photo: 'photo-1680199489033-bc336166482b' },
]

type Region = (typeof regions)[number]

function RegionTile({
  region, counts, sizes, lead = false,
}: {
  region: Region
  counts: Record<string, number> | null
  /** How wide the tile renders, for next/image */
  sizes: string
  lead?: boolean
}) {
  const count = counts?.[region.name] ?? 0
  return (
    <Link
      href={`/search?region=${encodeURIComponent(region.name)}`}
      className={`photo-zoom-host focus-ring rounded-2xl flex flex-col ${lead ? 'lg:h-full' : ''}`}
    >
      <div
        className={`relative rounded-2xl overflow-hidden aspect-[4/3] ${lead ? 'lg:aspect-auto lg:flex-1 lg:min-h-0' : ''}`}
        style={{ backgroundColor: 'var(--color-border)' }}
      >
        <Image
          src={`https://images.unsplash.com/${region.photo}?w=1200&q=80`}
          alt=""
          fill
          sizes={sizes}
          className="photo-zoom object-cover"
        />
      </div>
      <div className="pt-2.5 flex items-baseline gap-2 text-sm">
        <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{region.city}</span>
        {/* Reserve the line while counts load so the tiles do not jump */}
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {counts === null
            ? ' '
            : count > 0
            ? `${count} ${count === 1 ? 'home' : 'homes'}`
            : 'Coming soon'}
        </span>
      </div>
    </Link>
  )
}

export function RegionsSection() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    fetch('/api/listings/region-counts')
      .then((r) => r.json())
      .then((data) => setCounts(data.counts ?? {}))
      .catch(() => setCounts({}))
  }, [])

  const [lead, ...rest] = regions

  return (
    <section className="pt-14 md:pt-20" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-baseline justify-between gap-4 mb-7">
          <h2 className="text-[1.75rem] md:text-[2rem]" style={{ color: 'var(--color-text-primary)' }}>
            Explore by region
          </h2>
          <Link
            href="/search"
            className="focus-ring rounded-sm text-sm font-semibold underline underline-offset-4 decoration-1 whitespace-nowrap"
            style={{ color: 'var(--color-accent-deep)' }}
          >
            All regions
          </Link>
        </div>

        {/* Below lg: six equal tiles, two per row.
            lg and up: Accra leads at full height, then a row of two and a row of three. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-[5fr_7fr] lg:gap-5">
          <RegionTile region={lead} counts={counts} sizes="(min-width: 1024px) 520px, 50vw" lead />
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            <div className="contents lg:grid lg:grid-cols-2 lg:gap-5">
              {rest.slice(0, 2).map((r) => (
                <RegionTile key={r.name} region={r} counts={counts} sizes="(min-width: 1024px) 360px, 50vw" />
              ))}
            </div>
            <div className="contents lg:grid lg:grid-cols-3 lg:gap-5">
              {rest.slice(2).map((r) => (
                <RegionTile key={r.name} region={r} counts={counts} sizes="(min-width: 1024px) 240px, 50vw" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

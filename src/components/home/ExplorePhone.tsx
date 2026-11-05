import Link from 'next/link'
import Image, { getImageProps } from 'next/image'
import { preload } from 'react-dom'
import { ClipboardCheck, Search, Star } from 'lucide-react'
import { RENTAL_MODES } from '@/lib/rentalModes'
import { CHECK_CHIP_LABEL } from '@/lib/listingCheckRules'
import { aboutCedis, type CardPrice } from '@/lib/exploreRows'
import { formatUsdCompact } from '@/lib/utils'
import type { Explore, ExploreCard, ExploreRow } from '@/lib/explore'
import { CheckedBadge } from '@/components/listing/CheckedBadge'
import { HeartButton } from '@/components/listing/HeartButton'
import { SearchSheet } from '@/components/search/SearchSheet'
import { ghanaToday } from '@/lib/stayDates'

// Explore on a phone (app shell, stage 2). Drawn on the server into the kept home page (refreshed every 60 s and
// after changes, lib/homePage.ts), and shown below 768 px only (globals.css .explore-phone); a desktop keeps the
// page it had. Rows swipe with CSS alone; the hearts are the only browser code (HeartButton).

const CARD_SIZES = '(max-width: 767px) 72vw, 300px'
const PHONE_ONLY = '(max-width: 767px)'

const CHIPS: { href: string; label: string; icon: typeof Search }[] = [
  ...RENTAL_MODES.map((m) => ({ href: `/search?mode=${m.value}`, label: m.label, icon: m.icon })),
  { href: '/search?checked=true', label: CHECK_CHIP_LABEL, icon: ClipboardCheck },
]

function Price({ price, rate }: { price: CardPrice | null; rate: number }) {
  if (!price) return <><p className="explore-card-line explore-card-price">&nbsp;</p><p className="explore-card-line">&nbsp;</p></>
  return (
    <>
      <p className="explore-card-line explore-card-price">
        <strong>{aboutCedis(price.usd, rate)}</strong> <span className="explore-card-unit">{price.unit}</span>
      </p>
      <p className="explore-card-line explore-card-usd">{formatUsdCompact(price.usd)}</p>
    </>
  )
}

function Card({ home, rate, first }: { home: ExploreCard; rate: number; first: boolean }) {
  const place = [home.neighbourhood, home.city].filter(Boolean).join(', ')
  if (first) {
    // The first photo on a phone is the largest thing on its first screen: asked for at once, on phones only (a
    // desktop never shows it). The photo itself stays lazy, so a desktop does not fetch it either.
    const { props } = getImageProps({ src: home.photo, alt: '', fill: true, sizes: CARD_SIZES })
    preload(props.src, { as: 'image', imageSrcSet: props.srcSet, imageSizes: props.sizes, media: PHONE_ONLY, fetchPriority: 'high' })
  }
  return (
    <li className="explore-card">
      <Link href={`/listings/${home.id}`} className="explore-card-link focus-ring">
        <span className="explore-card-photo">
          <Image src={home.photo} alt="" fill sizes={CARD_SIZES} loading="lazy" fetchPriority={first ? 'high' : undefined} className="object-cover" />
        </span>
        <span className="explore-card-body">
          <span className="explore-card-top">
            <span className="explore-card-title">{home.title}</span>
            <span className="explore-card-rating">
              {home.reviewCount > 0 ? (
                <>
                  <Star size={12} className="fill-current" aria-hidden />
                  {home.avgRating.toFixed(1)}
                  <span className="sr-only"> out of 5, {home.reviewCount} {home.reviewCount === 1 ? 'review' : 'reviews'}</span>
                </>
              ) : 'New'}
            </span>
          </span>
          <span className="explore-card-line explore-card-place">{place}</span>
          <Price price={home.price} rate={rate} />
          <span className="explore-card-badge">{home.check && <CheckedBadge check={home.check} />}</span>
        </span>
      </Link>
      <HeartButton listingId={home.id} title={home.title} className="explore-card-heart" />
    </li>
  )
}

function Row({ row, index, rate }: { row: ExploreRow; index: number; rate: number }) {
  const id = `explore-row-${index}`
  const title = row.kind === 'city' ? `Homes in ${row.city}` : 'More homes on FieGH'
  const all = row.kind === 'city' ? `/search?q=${encodeURIComponent(row.city)}` : '/search'
  return (
    <section className="explore-row" aria-labelledby={id}>
      <div className="explore-row-head">
        <h2 id={id}>{title}</h2>
        <Link href={all} className="explore-row-all focus-ring" aria-label={`See all: ${title}`}>See all</Link>
      </div>
      <ul className="explore-strip" data-explore-strip={index}>
        {row.homes.map((home, i) => <Card key={home.id} home={home} rate={rate} first={index === 0 && i === 0} />)}
      </ul>
    </section>
  )
}

export function ExplorePhone({ explore }: { explore: Explore }) {
  const { rows, rate, failed, places } = explore
  return (
    <div className="explore-phone">
      <h1 className="sr-only">Find your fie: homes to rent in Ghana</h1>

      <div className="explore-top">
        {/* Opens the search sheet (a link to it, so it opens with no script too) */}
        <a href="#search-sheet" className="explore-pill focus-ring" data-search-pill>
          <Search size={18} strokeWidth={2.25} aria-hidden />
          <span>Where to?</span>
        </a>
        <nav aria-label="Rental types" className="explore-chips-wrap">
          <ul className="explore-chips">
            {CHIPS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link href={href} className="explore-chip focus-ring">
                  <Icon size={15} strokeWidth={1.75} aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {rows.length > 0 ? (
        rows.map((row, i) => <Row key={row.kind === 'city' ? row.city : 'more'} row={row} index={i} rate={rate} />)
      ) : failed ? (
        <div className="explore-empty">
          <p className="explore-empty-text">Homes could not be shown here just now.</p>
          <Link href="/search" className="explore-empty-action focus-ring">See all homes</Link>
        </div>
      ) : (
        <div className="explore-empty">
          <p className="explore-empty-title">Homes are on their way.</p>
          <p className="explore-empty-text">FieGH is just getting started.</p>
          <Link href="/become-a-host" className="explore-empty-action focus-ring">List your home</Link>
        </div>
      )}

      {/* Not under the empty state, which has its own one action */}
      {(rows.length > 0 || failed) && <section className="explore-host" aria-labelledby="explore-host-title">
        <h2 id="explore-host-title">Host on FieGH</h2>
        <p>Have a home in Ghana? List it for short stays, monthly lets or long-term leases.</p>
        <Link href="/login?tab=signup&role=host" className="explore-host-action focus-ring">Start hosting</Link>
      </section>}

      <SearchSheet places={places} today={ghanaToday()} />
    </div>
  )
}

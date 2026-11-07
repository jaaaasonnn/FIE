'use client'

// A phone's own parts of the search page (app shell stage 2), in their own file so that desktop search never
// downloads them (AS8, stage 3). SearchClient.tsx draws them through lib/phoneOnly.ts: the server draws them into
// every page, the browser fetches this file only at a phone's width. Desktop keeps its own bar, card text and
// empty state, beside these.
import { useEffect, useRef, useState } from 'react'
import { Map as MapIcon, Search, SlidersHorizontal, Star, X } from 'lucide-react'
import { MODE_ICONS } from '@/lib/rentalModes'
import { formatUsdCompact } from '@/lib/utils'
import { CheckedBadge } from '@/components/listing/CheckedBadge'
import { PhoneEmpty } from '@/components/ui/PhoneEmpty'
import { CHECK_CHIP_LABEL } from '@/lib/listingCheckRules'
import { aboutCedis, cardPriceFor, stayPrice } from '@/lib/exploreRows'
import { fromSheet, searchSummary, sheetParams } from '@/lib/searchSheet'
import type { ApiListing, SearchFilters } from '@/lib/searchQuery'

const MODES = ['SHORT_STAY', 'TEMP_STAY', 'PERMANENT'] as const
const MODE_LABELS: Record<string, string> = { SHORT_STAY: 'Short Stay', TEMP_STAY: 'Monthly', PERMANENT: 'Long-Term' }

export type PhoneBarProps = {
  filters: SearchFilters
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>
  showFilters: boolean
  toggleFilters: () => void
  warmPanel: () => void
  /** The server's copy: its buttons are disabled, since in the browser it is kept as drawn, with nothing behind
   * them, until this file has come (a tap before then would be lost); the pill is a link and works anyway */
  waiting?: boolean
}

/** The search as one pill that opens the search sheet (components/search/SearchSheet.tsx), and the filters as a
 * row of chips. The sheet (public/shell.js) reads the search shown from here and changes it in place. */
export function PhoneBar({ filters, setFilters, showFilters, toggleFilters, warmPanel, waiting }: PhoneBarProps) {
  const shown = useRef(filters)
  useEffect(() => { shown.current = filters }, [filters])
  useEffect(() => {
    const read = (e: Event) => { (e as CustomEvent<{ params: string | null }>).detail.params = sheetParams(shown.current) }
    const apply = (e: Event) => {
      const detail = (e as CustomEvent<{ handled: boolean; params: string }>).detail
      detail.handled = true
      setFilters((f) => fromSheet(f, detail.params))
    }
    document.addEventListener('fiegh:sheet-read', read)
    document.addEventListener('fiegh:sheet-apply', apply)
    return () => { document.removeEventListener('fiegh:sheet-read', read); document.removeEventListener('fiegh:sheet-apply', apply) }
  }, [setFilters])
  const summary = searchSummary(filters)

  return (
    <div className="md:hidden">
      <a href="#search-sheet" data-search-pill className="search-summary focus-ring"
        aria-label={`Change search: ${summary ?? 'Where to?'}`}>
        <Search size={17} strokeWidth={2.25} aria-hidden className="flex-shrink-0" />
        <span className="search-summary-text">{summary ?? 'Where to?'}</span>
      </a>
      <div className="search-chips" role="group" aria-label="Filters">
        <button type="button" onClick={toggleFilters} aria-expanded={showFilters} disabled={waiting}
          onPointerDown={warmPanel} className="search-chip" data-on={showFilters || undefined}>
          <SlidersHorizontal size={15} aria-hidden /> Filters
        </button>
        {MODES.map((m) => {
          const Icon = MODE_ICONS[m]
          return (
            <button key={m} type="button" aria-pressed={filters.mode === m} disabled={waiting}
              onClick={() => setFilters((f) => ({ ...f, mode: f.mode === m ? '' : m }))}
              className="search-chip" data-on={filters.mode === m || undefined}>
              {Icon && <Icon size={13} strokeWidth={1.75} aria-hidden />}{MODE_LABELS[m]}
            </button>
          )
        })}
        <button type="button" aria-pressed={filters.checked} disabled={waiting}
          onClick={() => setFilters((f) => ({ ...f, checked: !f.checked }))}
          className="search-chip" data-on={filters.checked || undefined}>
          {CHECK_CHIP_LABEL}
        </button>
      </div>
    </div>
  )
}

export type PhoneCardTextProps = { listing: ApiListing; filters: SearchFilters; dated: boolean; rate: number }

/** A phone's card text: cedis first, as the listing page writes them, and the stay price for the dates; every
 * line a fixed height (globals.css .search-card-text) */
export function PhoneCardText({ listing: l, filters, dated, rate }: PhoneCardTextProps) {
  const price = cardPriceFor(l, filters.mode)
  const stay = stayPrice(price, filters)
  return (
    <span className="search-card-text md:hidden">
      <span className="search-card-top">
        <span className="search-card-title">{l.title}</span>
        <span className="search-card-rating">
          {l.reviewCount > 0 ? <><Star size={12} className="fill-current" aria-hidden />{l.avgRating.toFixed(1)}<span className="sr-only"> out of 5</span></> : 'New'}
        </span>
      </span>
      <span className="search-card-line">{[l.neighbourhood, l.city].filter(Boolean).join(', ')}</span>
      <span className="search-card-line search-card-price">
        {price && <><strong>{aboutCedis(price.usd, rate)}</strong> <span className="search-card-unit">{price.unit}</span> · {formatUsdCompact(price.usd)}</>}
      </span>
      {dated && (
        <span className="search-card-line search-card-stay">
          {stay && <>{aboutCedis(stay.usd, rate)} for {stay.units} {stay.units === 1 ? stay.unit : `${stay.unit}s`} · {formatUsdCompact(stay.usd)}</>}
        </span>
      )}
      <span className="search-card-badge">{l.check && <CheckedBadge check={l.check} />}</span>
    </span>
  )
}

/** A phone's "nothing found", in the owner's words (`waiting`: the server's copy, as PhoneBar's) */
export function PhoneNoResults({ clearAll, waiting }: { clearAll: () => void; waiting?: boolean }) {
  return <PhoneEmpty title="No homes match all of that." text="Try fewer filters or other dates." action={{ label: 'Clear filters', onClick: clearAll, disabled: waiting }} />
}

/** The map on a phone: a button floating above the bottom bar, and the map full screen when it is pressed. Only
 * ever drawn in the browser, at a phone's width (it is fixed to the screen, so it moves nothing). */
export function PhoneMap({ total, map }: { total: number; map: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="search-map-button focus-ring md:hidden">
        <MapIcon size={16} aria-hidden /> Map
      </button>
    )
  }
  return (
    <div className="sheet-slide fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
        <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Map view · {total} {total === 1 ? 'property' : 'properties'}
        </span>
        <button onClick={() => setOpen(false)}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
          <X size={14} /> Close
        </button>
      </div>
      <div className="flex-1">{map}</div>
    </div>
  )
}

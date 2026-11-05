'use client'

import { GHANA_REGIONS, PROPERTY_TYPES } from '@/lib/utils'
import { CHECK_FILTER_LABEL, HOST_ID_BADGE } from '@/lib/listingCheckRules'
import type { SearchFilters } from '@/lib/searchQuery'

// The search page's filter panel (app/search/SearchClient.tsx), in a file of its own so its code is fetched when
// the panel is first wanted, not with the page (G5: desktop search is at its budget). Unchanged otherwise.

const SORT_OPTIONS = [
  { value: 'newest',        label: 'Newest' },
  { value: 'price_asc',    label: 'Price: low to high' },
  { value: 'price_desc',   label: 'Price: high to low' },
  { value: 'top_rated',    label: 'Top Rated' },
  { value: 'most_reviewed', label: 'Most Reviewed' },
]

export function FilterPanel({ filters, setFilters }: { filters: SearchFilters; setFilters: React.Dispatch<React.SetStateAction<SearchFilters>> }) {
  return (
    <div className="mt-3 pt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
      style={{ borderTop: '1px solid var(--color-border)' }}>
      {[
        { label: 'Region',   value: filters.region,       key: 'region',       options: GHANA_REGIONS.map((r) => ({ val: r, label: r })) },
        { label: 'Type',     value: filters.propertyType, key: 'propertyType', options: PROPERTY_TYPES.map((t) => ({ val: t, label: t })) },
        { label: 'Bedrooms', value: filters.bedrooms,     key: 'bedrooms',     options: [1,2,3,4,5].map((n) => ({ val: String(n), label: `${n}+ beds` })) },
        { label: 'Sort',     value: filters.sort,         key: 'sort',         options: SORT_OPTIONS.map((o) => ({ val: o.value, label: o.label })) },
      ].map(({ label, value, key, options }) => (
        <select key={key} aria-label={label} value={value}
          onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
          className="text-xs p-2 rounded-lg"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>
          <option value="">{label}</option>
          {options.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
      ))}

      <div className="flex gap-2 items-center">
        <input aria-label="Lowest price in dollars" type="number" placeholder="Min $" value={filters.minPrice}
          onChange={(e) => setFilters((f) => ({ ...f, minPrice: e.target.value }))}
          className="w-full text-xs p-2 rounded-lg"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }} />
        <span style={{ color: 'var(--color-text-muted)' }}>to</span>
        <input aria-label="Highest price in dollars" type="number" placeholder="Max $" value={filters.maxPrice}
          onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
          className="w-full text-xs p-2 rounded-lg"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }} />
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        {[
          { key: 'checked',       label: CHECK_FILTER_LABEL, checked: filters.checked },
          { key: 'hostIdChecked', label: HOST_ID_BADGE,      checked: filters.hostIdChecked },
          { key: 'superhost', label: 'Superhost', checked: filters.superhost },
        ].map(({ key, label, checked }) => (
          <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer"
            style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={checked}
              onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))} />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}

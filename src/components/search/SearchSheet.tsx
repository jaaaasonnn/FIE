import { X, Minus, Plus } from 'lucide-react'
import { GHANA_REGIONS } from '@/lib/utils'
import { RENTAL_MODES } from '@/lib/rentalModes'

// The search sheet (app shell, stage 2), on phones only: Explore's "Where to?" pill and the search page's summary
// pill open it. Drawn on the server, a plain form that GETs /search, so it works with no script at all: the pill
// is a link to #search-sheet and CSS opens the sheet as the link's target (globals.css .search-sheet). On a phone
// public/shell.js then makes it feel native: Back closes it, focus stays inside, the page behind is inert, the
// guest steppers work, the date fields show "Wed, 13 Nov", and on the search page it changes the search in place.
// No React code of its own, so nothing is added to any page's script.

export type SheetValues = { q?: string; mode?: string; checkIn?: string; checkOut?: string; months?: string; guests?: string }

const MODES = [{ value: '', label: 'All types' }, ...RENTAL_MODES.map((m) => ({ value: m.value, label: m.label }))]

export function SearchSheet({ places, today, values = {} }: { places: string[]; today: string; values?: SheetValues }) {
  const mode = MODES.some((m) => m.value === values.mode) ? values.mode ?? '' : ''
  const suggestions = [...new Set([...places, ...GHANA_REGIONS])]
  return (
    <div id="search-sheet" className="search-sheet" role="dialog" aria-modal="true" aria-labelledby="search-sheet-title" data-search-sheet>
      <div className="search-sheet-panel" tabIndex={-1}>
        <div className="search-sheet-head">
          <h2 id="search-sheet-title">Search homes</h2>
          <a href="#" className="search-sheet-close focus-ring" aria-label="Close search" data-sheet-close>
            <X size={20} aria-hidden />
          </a>
        </div>

        <form action="/search" method="get" className="search-sheet-form" data-sheet-form>
          <fieldset className="sheet-group">
            <legend className="sheet-label">Rental type</legend>
            <div className="sheet-modes">
              {MODES.map((m) => (
                <label key={m.value || 'all'} className="sheet-mode">
                  <input type="radio" name="mode" value={m.value} defaultChecked={m.value === mode} />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="sheet-group">
            <span className="sheet-label">Where</span>
            <input type="search" name="q" list="search-sheet-places" defaultValue={values.q ?? ''} placeholder="City, area or region"
              autoComplete="off" enterKeyHint="search" maxLength={100} className="sheet-input focus-ring" />
          </label>
          <datalist id="search-sheet-places">
            {suggestions.map((p) => <option key={p} value={p} />)}
          </datalist>

          <div className="sheet-group sheet-dates">
            <label className="sheet-date">
              <span className="sheet-label"><span className="sheet-when-stay">Check-in</span><span className="sheet-when-move">Move-in</span></span>
              <span className="date-field">
                <input type="date" name="checkIn" min={today} defaultValue={values.checkIn ?? ''} className="date-field-input sheet-input focus-ring" />
                <span className="date-field-face" data-empty="true" aria-hidden>Add date</span>
              </span>
            </label>
            <label className="sheet-date sheet-checkout">
              <span className="sheet-label">Check-out</span>
              <span className="date-field">
                <input type="date" name="checkOut" min={today} defaultValue={values.checkOut ?? ''} className="date-field-input sheet-input focus-ring" />
                <span className="date-field-face" data-empty="true" aria-hidden>Add date</span>
              </span>
            </label>
            <label className="sheet-date sheet-months">
              <span className="sheet-label">Months</span>
              <select name="months" defaultValue={values.months || '1'} className="sheet-input focus-ring">
                {Array.from({ length: 11 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <p className="sheet-year">Checks one year from this date.</p>
          </div>

          <div className="sheet-group">
            <label htmlFor="sheet-guests" className="sheet-label">Guests</label>
            <div className="sheet-stepper">
              <button type="button" className="sheet-step focus-ring" data-step="-1" aria-label="Fewer guests"><Minus size={16} aria-hidden /></button>
              <input id="sheet-guests" type="number" name="guests" min={1} max={16} inputMode="numeric" placeholder="Any"
                defaultValue={values.guests ?? ''} className="sheet-input sheet-guests focus-ring" />
              <button type="button" className="sheet-step focus-ring" data-step="1" aria-label="More guests"><Plus size={16} aria-hidden /></button>
            </div>
          </div>

          <div className="search-sheet-foot">
            <button type="reset" className="sheet-clear focus-ring">Clear all</button>
            <button type="submit" className="sheet-submit focus-ring">Search</button>
          </div>
        </form>
      </div>
    </div>
  )
}

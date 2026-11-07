import type { SearchFilters } from '@/lib/searchQuery'
import { formatDay } from '@/lib/dateText'

// The phone's search sheet and summary pill (app shell stage 2). Their own file so that only a phone's code
// (app/search/phoneParts.tsx) carries them (AS8): desktop search never downloads them.

/** The search shown, as the sheet's fields are named */
export function sheetParams(f: SearchFilters): string {
  const p = new URLSearchParams()
  if (f.query.trim()) p.set('q', f.query.trim())
  if (f.mode) p.set('mode', f.mode)
  if (f.checkIn) p.set('checkIn', f.checkIn)
  if (f.checkOut) p.set('checkOut', f.checkOut)
  if (f.months && f.months !== '1') p.set('months', f.months)
  if (f.guests) p.set('guests', f.guests)
  return p.toString()
}

/** The sheet's answer, as filters: only the fields the sheet has, the rest kept */
export function fromSheet(f: SearchFilters, params: string): SearchFilters {
  const p = new URLSearchParams(params)
  return { ...f, query: (p.get('q') || '').slice(0, 100), mode: p.get('mode') || '', checkIn: p.get('checkIn') || '', checkOut: p.get('checkOut') || '', months: p.get('months') || '1', guests: p.get('guests') || '' }
}

const day = (key: string) => formatDay(`${key}T12:00:00Z`, { day: 'numeric', month: 'short' })

/** The phone's summary pill: "Accra · 10 to 12 Mar · 2 guests", or null when nothing is chosen ("Where to?"). */
export function searchSummary(f: SearchFilters): string | null {
  const place = f.query.trim() || f.region
  let dates = ''
  if (f.checkIn) {
    if (f.mode === 'TEMP_STAY') dates = `From ${day(f.checkIn)}, ${f.months === '1' || !f.months ? '1 month' : `${f.months} months`}`
    else if (f.mode === 'PERMANENT' || !f.checkOut) dates = `From ${day(f.checkIn)}`
    else {
      const a = f.checkIn.slice(0, 7) === f.checkOut.slice(0, 7)
      dates = `${a ? String(Number(f.checkIn.slice(8, 10))) : day(f.checkIn)} to ${day(f.checkOut)}`
    }
  }
  const n = parseInt(f.guests, 10)
  const guests = n > 0 ? `${n} ${n === 1 ? 'guest' : 'guests'}` : ''
  if (!place && !dates && !guests) return null
  return [place || 'Anywhere', dates, guests].filter(Boolean).join(' · ')
}

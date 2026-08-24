import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Fallback only — matches the backend's INITIAL_USD_TO_GHS default. Components
// should read the live rate from useExchangeRate() (@/context/ExchangeRateContext),
// which starts at this value and updates once /api/exchange-rate resolves.
export const GHS_RATE = 15.5

export function formatCurrency(usd: number, showGhs = true): string {
  const usdStr = `$${usd.toFixed(2)}`
  if (!showGhs) return usdStr
  const ghs = (usd * GHS_RATE).toFixed(2)
  return `${usdStr} (GH₵ ${ghs})`
}

export function formatPrice(usd: number, mode: 'nightly' | 'monthly' | 'annual'): string {
  const label = mode === 'nightly' ? '/night' : mode === 'monthly' ? '/month' : '/year'
  return `$${usd.toFixed(0)}${label}`
}

export function ghsAmount(usd: number): string {
  return `GH₵ ${(usd * GHS_RATE).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`
}

export function validateGhanaPhone(phone: string): boolean {
  return /^(\+233|0)[2-5]\d{8}$/.test(phone.replace(/\s/g, ''))
}

export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\s/g, '')
  if (cleaned.startsWith('0')) return '+233' + cleaned.slice(1)
  return cleaned
}

export const GHANA_REGIONS = [
  'Greater Accra', 'Ashanti', 'Central', 'Western', 'Eastern',
  'Volta', 'Northern', 'Upper East', 'Upper West', 'Brong-Ahafo',
  'Oti', 'Savannah', 'Bono East', 'Ahafo', 'North East', 'Western North',
]

export const PROPERTY_TYPES = [
  'Apartment', 'House', 'Villa', 'Studio', 'Townhouse',
  'Guestroom', 'Entire compound', 'Serviced apartment',
]

export const AMENITIES_LIST = [
  'WiFi', 'Generator/Inverter', 'Prepaid Electricity Meter', 'Air Conditioning',
  'Water Storage Tank', 'Borehole Water', 'Swimming Pool', 'Security Guard',
  'CCTV', 'Parking', 'Furnished', 'Unfurnished', 'Kitchen', 'Washing Machine',
  'Gym', 'Garden', 'Boys Quarters', 'Pet Friendly', 'Wheelchair Accessible',
]

export const MOMO_NETWORKS = ['MTN', 'Vodafone', 'AirtelTigo']

export const RENTAL_MODES = {
  SHORT_STAY: { label: 'Short Stay', desc: 'Nightly or weekly', icon: '🌙' },
  TEMP_STAY: { label: 'Temporary Stay', desc: '1–11 months', icon: '📅' },
  PERMANENT: { label: 'Permanent Rental', desc: '12+ months lease', icon: '🏠' }
}

export const SERVICE_FEE_RATE = 0.12
export const PLATFORM_COMMISSION = 0.08

// Applied on top of the raw market rate when the exchange-rate cron stores a
// freshly-fetched USD→GHS rate (see /api/cron/update-exchange-rate). Rounds
// slightly in FieGH's favor to absorb FX movement during the up-to-6h window
// between fetches, so a real charge never settles for less GHS than the
// USD price implied at the moment the rate was quoted.
export const EXCHANGE_RATE_BUFFER = 0.01

export function calculateFees(basePrice: number) {
  const serviceFee = basePrice * SERVICE_FEE_RATE
  const total = basePrice + serviceFee
  const hostPayout = basePrice * (1 - PLATFORM_COMMISSION)
  return { basePrice, serviceFee, total, hostPayout }
}

// Picks whichever price actually applies to a listing, preferring its own
// rental mode(s) over any one hardcoded field — a listing with only
// TEMP_STAY/PERMANENT modes has no priceNightly at all, so displaying that
// field unconditionally (as opposed to falling back through the others)
// shows a placeholder instead of the listing's real price.
export function getPrimaryPrice(listing: {
  priceNightly: number | null
  priceMonthly: number | null
  priceAnnual:  number | null
  rentalModes:  string[]
}): { price: number | null; unit: string } {
  if (listing.rentalModes.includes('SHORT_STAY') && listing.priceNightly) {
    return { price: listing.priceNightly, unit: '/night' }
  }
  if (listing.rentalModes.includes('TEMP_STAY') && listing.priceMonthly) {
    return { price: listing.priceMonthly, unit: '/mo' }
  }
  if (listing.rentalModes.includes('PERMANENT') && listing.priceAnnual) {
    return { price: listing.priceAnnual, unit: '/year' }
  }
  // Fallback in case rentalModes and the populated price fields disagree
  if (listing.priceNightly) return { price: listing.priceNightly, unit: '/night' }
  if (listing.priceMonthly) return { price: listing.priceMonthly, unit: '/mo' }
  if (listing.priceAnnual)  return { price: listing.priceAnnual,  unit: '/year' }
  return { price: null, unit: '' }
}

export function getDaysArray(start: Date, end: Date): Date[] {
  const arr: Date[] = []
  const dt = new Date(start)
  while (dt <= end) {
    arr.push(new Date(dt))
    dt.setDate(dt.getDate() + 1)
  }
  return arr
}

export function truncateText(text: string, len: number): string {
  return text.length > len ? text.slice(0, len) + '...' : text
}

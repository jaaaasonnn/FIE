// What a host may put on a listing, checked in one place for creating and
// editing alike. Money first: a price or a deposit that is negative, not a
// number or absurdly large would end up in what a guest is charged and what
// a host is paid.

import { parseMoney, parseText, parseTextList, parseWhole, type Parsed } from '@/lib/validate'

/** The most a night, a month or a year may cost, in dollars. */
export const MAX_PRICE_USD = 1_000_000
/** The most a damage deposit may be, in dollars. */
export const MAX_DEPOSIT_USD = 100_000

const MONEY_FIELDS = {
  priceNightly: { label: 'The nightly price', max: MAX_PRICE_USD },
  priceMonthly: { label: 'The monthly price', max: MAX_PRICE_USD },
  priceAnnual: { label: 'The yearly rent', max: MAX_PRICE_USD },
  // A deposit of nothing is allowed; a deposit below nothing would be taken
  // off what the guest pays while the host is still paid for the whole stay
  damageDeposit: { label: 'The damage deposit', max: MAX_DEPOSIT_USD, allowZero: true },
} as const

export type MoneyField = keyof typeof MONEY_FIELDS
export const LISTING_MONEY_FIELDS = Object.keys(MONEY_FIELDS) as MoneyField[]

/**
 * The money fields a request sent, checked. A field that was not sent is left
 * out; one sent empty is null (no price for that kind of stay, no deposit).
 */
export function parseListingMoney(body: Record<string, unknown>): Parsed<Partial<Record<MoneyField, number | null>>> {
  const value: Partial<Record<MoneyField, number | null>> = {}
  for (const field of LISTING_MONEY_FIELDS) {
    if (body[field] === undefined) continue
    const parsed = parseMoney(body[field], MONEY_FIELDS[field])
    if (!parsed.ok) return parsed
    // No deposit is stored as null, as it always has been
    value[field] = field === 'damageDeposit' && parsed.value === 0 ? null : parsed.value
  }
  return { ok: true, value }
}

/** True when a stored deposit is one a booking may be made with: none, or a real amount that is not negative. */
export function depositIsSound(deposit: number | null | undefined): boolean {
  return deposit === null || deposit === undefined || (Number.isFinite(deposit) && deposit >= 0 && deposit <= MAX_DEPOSIT_USD)
}

// ── Everything else a host types ───────────────────────────────────────────


export const LISTING_LIMITS = {
  title: 120, description: 5000, propertyType: 60, region: 60, city: 80, neighbourhood: 80, welcomeMessage: 1000,
  amenities: { maxItems: 60, maxEach: 80 }, rules: { maxItems: 30, maxEach: 200 },
} as const

const MODES = ['SHORT_STAY', 'TEMP_STAY', 'PERMANENT']

type Details = Partial<{
  title: string; description: string; propertyType: string; region: string; city: string; neighbourhood: string | null
  lat: number | null; lng: number | null; bedrooms: number; bathrooms: number; maxGuests: number; minStayNights: number
  rentalModes: string; amenities: string; rules: string; instantBook: boolean; welcomeMessage: string | null
}>

/** A point on the map: a real number inside the range, or none. */
function parseCoordinate(value: unknown, label: string, limit: number): Parsed<number | null> {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  const raw = typeof value === 'number' ? value : typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? Number(value) : NaN
  if (!Number.isFinite(raw) || Math.abs(raw) > limit) return { ok: false, error: `${label} is not a valid map position` }
  return { ok: true, value: raw }
}

/**
 * The words and numbers on a listing, checked: each the right type, a
 * sensible size, and (for the title and the other one-line fields) with no
 * line breaks, so a title can never pass for something else in an email.
 * Only what was sent is returned, ready to store; with `creating`, what a new
 * listing needs is required and the rest gets its default.
 */
export function parseListingDetails(body: Record<string, unknown>, { creating }: { creating: boolean }): Parsed<Details> {
  const out: Details = {}
  const sent = (field: string) => creating || body[field] !== undefined

  const texts = [
    ['title', 'The title', true, false], ['propertyType', 'The property type', true, false], ['region', 'The region', true, false],
    ['city', 'The city', true, false], ['neighbourhood', 'The neighbourhood', false, false],
    ['description', 'The description', false, true], ['welcomeMessage', 'The welcome message', false, true],
  ] as const
  for (const [field, label, required, lines] of texts) {
    if (!sent(field)) continue
    const parsed = parseText(body[field], { label, max: LISTING_LIMITS[field], required, lines })
    if (!parsed.ok) return parsed
    if (field === 'description') out.description = parsed.value ?? ''
    else if (field === 'neighbourhood' || field === 'welcomeMessage') out[field] = parsed.value
    else out[field] = parsed.value!
  }

  const wholes = [
    ['bedrooms', 'Bedrooms', 1, 50, null], ['bathrooms', 'Bathrooms', 1, 50, 1],
    ['maxGuests', 'The number of guests', 1, 100, 2], ['minStayNights', 'The shortest stay', 1, 365, 1],
  ] as const
  for (const [field, label, min, max, fallback] of wholes) {
    if (!sent(field)) continue
    const parsed = parseWhole(body[field], { label, min, max })
    if (!parsed.ok) return parsed
    if (parsed.value === null && fallback === null) return { ok: false, error: `${label} must be a whole number` }
    out[field] = parsed.value ?? fallback!
  }

  for (const [field, label, limit] of [['lat', 'The latitude', 90], ['lng', 'The longitude', 180]] as const) {
    if (!sent(field)) continue
    const parsed = parseCoordinate(body[field], label, limit)
    if (!parsed.ok) return parsed
    out[field] = parsed.value
  }

  if (sent('rentalModes')) {
    const modes = body.rentalModes ?? []
    if (!Array.isArray(modes) || modes.some((m) => !MODES.includes(m as string))) {
      return { ok: false, error: 'Choose the kinds of stay from the list' }
    }
    out.rentalModes = JSON.stringify([...new Set(modes)])
  }
  for (const [field, label] of [['amenities', 'Amenities'], ['rules', 'House rules']] as const) {
    if (!sent(field)) continue
    const parsed = parseTextList(body[field], { label, ...LISTING_LIMITS[field] })
    if (!parsed.ok) return parsed
    out[field] = JSON.stringify(parsed.value)
  }
  if (sent('instantBook')) {
    if (body.instantBook !== undefined && body.instantBook !== null && typeof body.instantBook !== 'boolean') {
      return { ok: false, error: 'Instant booking must be on or off' }
    }
    out.instantBook = body.instantBook === true
  }
  return { ok: true, value: out }
}

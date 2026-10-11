// What a host may put on a listing, checked in one place for creating and
// editing alike. Money first: a price or a deposit that is negative, not a
// number or absurdly large would end up in what a guest is charged and what
// a host is paid.

import { parseMoney, type Parsed } from '@/lib/validate'

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

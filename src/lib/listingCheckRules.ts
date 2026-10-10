// "Address and photos checked": what the badge means, when a listing has it,
// what an admin must record to give it, and which edits take it away. Pure
// rules and wording, no database and no network, so the pages, the routes and
// the admin screen all read the same thing.
//
// What it claims, and all it claims: on a given date FieGH looked up the
// listing's Ghana Post digital address, saw the home on a video call or a
// visit, and confirmed the photos show that home. It says nothing about who
// owns the home and promises nothing about it. Every sentence a person reads
// about it is written here, once, so the site cannot say more than that.

export type CheckRow = {
  checkedAt: Date | string
  expiresAt: Date | string
  revokedAt?: Date | string | null
}

/** How long a check lasts. */
export const CHECK_VALID_MONTHS = 12
/** The host is reminded, and the admin queue lists the listing, this many days before it runs out. */
export const CHECK_REMINDER_DAYS = 30
export const MIN_CHECK_NOTE = 20
export const MAX_CHECK_NOTE = 1000

const DAY_MS = 86_400_000

// ── When a listing has the badge ───────────────────────────────────────────

/** When a check made at this moment runs out: the same day and time, CHECK_VALID_MONTHS on. */
export function checkExpiry(checkedAt: Date): Date {
  const month = checkedAt.getUTCMonth() + CHECK_VALID_MONTHS
  const lastDay = new Date(Date.UTC(checkedAt.getUTCFullYear(), month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(
    checkedAt.getUTCFullYear(), month, Math.min(checkedAt.getUTCDate(), lastDay),
    checkedAt.getUTCHours(), checkedAt.getUTCMinutes(), checkedAt.getUTCSeconds(), checkedAt.getUTCMilliseconds(),
  ))
}

/**
 * True while a check stands: not revoked, and not yet expired. Worked out
 * from the dates each time it is asked, so an expired badge is gone the
 * moment it expires with no job to run or to fail.
 */
export function isLive(check: CheckRow, now: Date = new Date()): boolean {
  return !check.revokedAt && new Date(check.expiresAt).getTime() > now.getTime()
}

/** The check a listing's badge comes from: its newest one that stands. Null when it has none. */
export function liveCheck<T extends CheckRow>(checks: T[] | null | undefined, now: Date = new Date()): T | null {
  return [...(checks ?? [])]
    .filter((c) => isLive(c, now))
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())[0] ?? null
}

/** The same rule as a database filter on ListingCheck rows. */
export function liveCheckWhere(now: Date = new Date()) {
  return { revokedAt: null, expiresAt: { gt: now } }
}

/** True for a standing check that runs out within CHECK_REMINDER_DAYS. */
export function expiresSoon(check: CheckRow, now: Date = new Date()): boolean {
  return isLive(check, now) && new Date(check.expiresAt).getTime() - now.getTime() <= CHECK_REMINDER_DAYS * DAY_MS
}

/** What anyone may know about a listing's check: the two dates, and nothing else. */
export type PublicCheck = { checkedAt: string; expiresAt: string }
export function publicCheck(check: CheckRow | null): PublicCheck | null {
  return check ? { checkedAt: new Date(check.checkedAt).toISOString(), expiresAt: new Date(check.expiresAt).toISOString() } : null
}

// ── What an admin records ──────────────────────────────────────────────────

export const CHECK_ITEMS = {
  ADDRESS_MATCHES: 'I looked up the digital address and it points to the neighbourhood and city on the listing',
  PHOTOS_MATCH: 'The photos on the listing show the home at that address',
  HOST_HAD_ACCESS: 'The host was at the home and could get in during the call or visit',
} as const
export type CheckItem = keyof typeof CHECK_ITEMS
export const CHECK_ITEM_KEYS = Object.keys(CHECK_ITEMS) as CheckItem[]

export const CHECK_METHODS = { VIDEO_CALL: 'A video call', VISIT: 'A visit in person' } as const
export type CheckMethod = keyof typeof CHECK_METHODS

export type CheckInput = { method?: unknown; checks?: unknown; note?: unknown }
export type CheckableListing = { digitalAddress: string | null; photos: string; isActive: boolean; moderationHold: boolean }

export function photoList(photos: string | null | undefined): string[] {
  try {
    const list = JSON.parse(photos || '[]')
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string' && p.length > 0) : []
  } catch {
    return []
  }
}

/**
 * Why this listing cannot be marked as checked, or null when it can. Nothing
 * with no photos or no digital address can ever be marked: there would be
 * nothing to have checked.
 */
export function markRefusal(listing: CheckableListing, input: CheckInput): string | null {
  if (listing.moderationHold) return 'This listing is on hold. Clear the hold before recording a check.'
  if (!listing.isActive) return 'This listing is switched off. It can be checked once it is live.'
  if (!listing.digitalAddress) return 'This listing has no digital address, so there is no address to have checked. Ask the host to add one.'
  if (photoList(listing.photos).length === 0) return 'This listing has no photos, so there are no photos to have checked.'

  if (typeof input.method !== 'string' || !Object.prototype.hasOwnProperty.call(CHECK_METHODS, input.method)) {
    return 'Say how you saw the home: a video call or a visit in person.'
  }
  const ticked = Array.isArray(input.checks) ? input.checks : []
  if (!CHECK_ITEM_KEYS.every((item) => ticked.includes(item))) return 'Every item on the checklist must be confirmed before a listing is marked as checked.'
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length < MIN_CHECK_NOTE) return `Write a note of what you checked (at least ${MIN_CHECK_NOTE} characters). Only admins see it.`
  if (note.length > MAX_CHECK_NOTE) return `The note can be at most ${MAX_CHECK_NOTE} characters.`
  return null
}

// ── What takes it away ─────────────────────────────────────────────────────

export type RevokeReason = 'ADMIN' | 'ADDRESS_CHANGED' | 'DETAILS_CHANGED' | 'PHOTOS_CHANGED' | 'LISTING_HELD' | 'REPLACED'

/** Changing any of these changes where the home is said to be. */
export const ADDRESS_FIELDS = ['digitalAddress', 'region', 'city', 'neighbourhood', 'lat', 'lng'] as const
/** Changing either of these changes what the home is said to be. */
export const DETAIL_FIELDS = ['propertyType', 'bedrooms'] as const

const same = (a: unknown, b: unknown) => {
  const blank = (v: unknown) => v === null || v === undefined || v === ''
  if (blank(a) && blank(b)) return true
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return typeof a === 'string' && typeof b === 'string' ? a.trim() === b.trim() : a === b
}

/**
 * Whether an edit takes the badge away, and why. `before` is the listing as
 * stored; `changes` is what the edit sets. Only a field that is really given a
 * different value counts. Title, description, prices, amenities, rules, the
 * cancellation policy, the calendar and pausing never do.
 */
export function editRevokes(before: Record<string, unknown>, changes: Record<string, unknown>): RevokeReason | null {
  const changed = (field: string) => field in changes && !same(before[field], changes[field])
  if (ADDRESS_FIELDS.some(changed)) return 'ADDRESS_CHANGED'
  if (DETAIL_FIELDS.some(changed)) return 'DETAILS_CHANGED'
  return null
}

/** Why a check was removed, as the host is told. */
export function removalReasonText(reason: string | null | undefined, note?: string | null): string {
  if (reason === 'ADDRESS_CHANGED') return 'the address was changed'
  if (reason === 'DETAILS_CHANGED') return 'the property type or the number of bedrooms was changed'
  if (reason === 'PHOTOS_CHANGED') return 'the photos were changed'
  if (reason === 'LISTING_HELD') return 'the listing was put on hold'
  return `removed by our team${note ? `: ${note}` : ''}`
}

// ── The words ──────────────────────────────────────────────────────────────
// Approved wording. The badge never says "verified", and never says or
// implies that ownership was checked or that anything is guaranteed.

export const CHECK_BADGE = 'Address and photos checked'
export const CHECK_FILTER_LABEL = 'Address and photos checked by FieGH'
/** The badge for a host whose ID FieGH has checked. About the person, not the home. */
export const HOST_ID_BADGE = 'Host ID checked'
/** The same badge on someone who is not a host. */
export const ID_BADGE = 'ID checked'

const longDate = (value: Date | string) =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The tooltip, and the line under the badge on the listing page. */
export function checkExplanation(check: { checkedAt: Date | string; expiresAt: Date | string }): string {
  return `FieGH checked this listing's address and photos on ${longDate(check.checkedAt)}. This is not proof of who owns the home and it is not a guarantee. We check again by ${longDate(check.expiresAt)}.`
}

/** What the public listing page says about the digital address: that there is one, never what it is. */
export const DIGITAL_ADDRESS_PUBLIC = 'On file with FieGH. You will see it once your booking is confirmed.'

export const CHECK_FAQ = [
  {
    q: `What does "${CHECK_BADGE}" mean?`,
    a: "It means a member of the FieGH team looked up the listing's Ghana Post digital address, saw the home on a video call or a visit, and confirmed that the photos show that home. The date of the check is shown on the listing. It does not mean FieGH has confirmed who owns the home, and it is not a guarantee about the home or the host. If something is wrong when you arrive, report it from your booking by the end of the day after check-in.",
  },
  {
    q: 'How long does the check last?',
    a: 'Twelve months. It is also removed straight away if the host changes the address or the photos, until we have checked again. A listing without it has not been checked yet; that does not mean anything is wrong with it.',
  },
]

export const CHECK_TERMS =
  `Some listings show "${CHECK_BADGE}". This records that FieGH checked the listing's digital address and photos on the date shown. It is not verification of ownership or of the host's right to let the home, and it is not a warranty or guarantee of the home's condition, safety or availability. FieGH may remove it at any time. Clause 9 (Limitation of Liability) applies in full.`

/** Shown to a host before they save an edit that would take the badge away. */
export const EDIT_REMOVES_CHECK =
  `This listing shows "${CHECK_BADGE}". Changing the address, the property type, the number of bedrooms or the photos removes it until our team has checked again.`

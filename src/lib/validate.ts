// Small checks for what a request sends, used by the routes so each one
// applies the same rules: the right type, a sensible size, nothing hidden.
// Nothing here touches the database.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Characters that have no business in stored text: control codes, and marks that reorder or hide text. */
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF]/g

/**
 * One line of text (a title, a name, a town): line breaks and runs of
 * spaces become a single space, hidden characters go, the ends are trimmed.
 * A title can therefore never start a new paragraph in an email.
 */
export function oneLine(value: string): string {
  return value.replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(HIDDEN, '').replace(/ {2,}/g, ' ').trim()
}

/** Text of several lines (a description, a message): line breaks stay, hidden characters go. */
export function manyLines(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').replace(HIDDEN, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * A text field from a request. `undefined` is "not sent". Empty text, or
 * null, is null when the field is optional and refused when it is required.
 * Anything that is not a string, or is longer than `max`, is refused.
 */
export function parseText(
  value: unknown,
  { label, max, required = false, lines = false }: { label: string; max: number; required?: boolean; lines?: boolean },
): Parsed<string | null> {
  if (value === null || value === undefined || value === '') {
    return required ? { ok: false, error: `${label} is required` } : { ok: true, value: null }
  }
  if (typeof value !== 'string') return { ok: false, error: `${label} must be text` }
  const text = lines ? manyLines(value) : oneLine(value)
  if (!text) return required ? { ok: false, error: `${label} is required` } : { ok: true, value: null }
  if (text.length > max) return { ok: false, error: `${label} can be at most ${max} characters` }
  return { ok: true, value: text }
}

/**
 * An amount of money in dollars. Empty or null is "none". It must be a real
 * number, not negative (and not zero unless `allowZero`), and no more than
 * `max`. Kept to whole cents.
 */
export function parseMoney(
  value: unknown,
  { label, max, allowZero = false }: { label: string; max: number; allowZero?: boolean },
): Parsed<number | null> {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  const raw = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value) ? Number(value) : NaN
  if (!Number.isFinite(raw)) return { ok: false, error: `${label} must be a number` }
  if (raw < 0 || (raw === 0 && !allowZero)) return { ok: false, error: allowZero ? `${label} cannot be less than zero` : `${label} must be more than zero` }
  if (raw > max) return { ok: false, error: `${label} can be at most $${max.toLocaleString('en-US')}` }
  return { ok: true, value: Math.round(raw * 100) / 100 }
}

/** A whole number between two limits. Empty or null is "none". */
export function parseWhole(
  value: unknown,
  { label, min, max }: { label: string; min: number; max: number },
): Parsed<number | null> {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  const raw = typeof value === 'number' ? value : typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN
  if (!Number.isInteger(raw)) return { ok: false, error: `${label} must be a whole number` }
  if (raw < min || raw > max) return { ok: false, error: `${label} must be between ${min} and ${max}` }
  return { ok: true, value: raw }
}

/** A list of short pieces of text (amenities, house rules). Not a list, too many, or too long: refused. */
export function parseTextList(
  value: unknown,
  { label, maxItems, maxEach }: { label: string; maxItems: number; maxEach: number },
): Parsed<string[]> {
  if (value === null || value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: `${label} must be a list` }
  if (value.length > maxItems) return { ok: false, error: `${label} can have at most ${maxItems} entries` }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, error: `${label} must be a list of text` }
    const text = oneLine(item)
    if (text.length > maxEach) return { ok: false, error: `Each entry in ${label.toLowerCase()} can be at most ${maxEach} characters` }
    if (text) out.push(text)
  }
  return { ok: true, value: out }
}

/** Sizes for the things people type about themselves. */
export const ACCOUNT_LIMITS = { name: 80, bio: 500, nationality: 60, businessName: 120 } as const
/** No real password is longer; anything more is refused before it is hashed. */
export const MAX_PASSWORD_LENGTH = 200

/** The most rows one request for a list may ask for. */
export const MAX_PAGE_SIZE = 50

/** A whole number from a query string, kept inside its limits; anything else is the fallback. */
export function clampWhole(raw: string | null, fallback: number, min: number, max: number): number {
  const value = raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : fallback
  return Math.min(max, Math.max(min, value))
}

// ── Request bodies ─────────────────────────────────────────────────────────

// As loose as req.json() itself: each route checks the type of what it uses
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonBody = Record<string, any>

/** What a person is told when a request's body is not a JSON object. */
export const BODY_NOT_READABLE = 'The request could not be read. Please try again.'

/**
 * A request's body as a JSON object, or null when it is empty, is not JSON, or
 * is JSON that is not an object (null, a number, a list, a string). Never
 * throws, so a route cannot answer a body it cannot read with a 500.
 *
 * Null too when any text in it, at any depth, holds a null byte. Postgres
 * refuses the byte, so an id or an address carrying one would end as a 500.
 */
export async function jsonObject(req: Request): Promise<JsonBody | null> {
  let body: unknown
  try { body = await req.json() } catch { return null }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  return holdsNullByte(body) ? null : (body as JsonBody)
}

/** True when a string anywhere in the value (a key or a value, at any depth) holds a null byte. */
function holdsNullByte(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000')
  if (value === null || typeof value !== 'object') return false
  // Deeper than any real request: refused rather than walked
  if (depth > 64) return true
  if (Array.isArray(value)) return value.some((item) => holdsNullByte(item, depth + 1))
  return Object.entries(value).some(([key, item]) => key.includes('\u0000') || holdsNullByte(item, depth + 1))
}

/** The answer to a body that could not be read: 400, the same from every route. */
export function unreadableBody(): Response {
  return Response.json({ error: BODY_NOT_READABLE }, { status: 400 })
}

// ── Query strings ──────────────────────────────────────────────────────────

/** What a person is told when a filter in the address cannot be used. */
export const QUERY_NOT_READABLE = 'That request could not be read. Please check the address and try again.'

/**
 * True when any name or value in the query string holds a null byte. Postgres
 * refuses the byte in text, so a filter carrying one would end as a 500.
 */
export function hasNullByte(searchParams: URLSearchParams): boolean {
  for (const [key, value] of searchParams) if (key.includes('\u0000') || value.includes('\u0000')) return true
  return false
}

/** The answer to a query string that cannot be used: 400, the same from every route. */
export function unreadableQuery(): Response {
  return Response.json({ error: QUERY_NOT_READABLE }, { status: 400 })
}

/** A whole number from the query string within a range, or null when it is anything else ("abc", "2.5", "1e9"). */
export function wholeFromQuery(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,9}$/.test(raw.trim())) return null
  const value = Number(raw.trim())
  return value >= min && value <= max ? value : null
}


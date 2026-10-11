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

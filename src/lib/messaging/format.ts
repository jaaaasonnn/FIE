// How amounts, dates and addresses are written in messages. Everything here
// is put together by hand rather than through a locale, so an email reads the
// same whatever server or time zone renders it.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A date in Ghana (UTC all year): "Tue 10 Nov 2026", or "10 Nov" when short. */
export function ghanaDate(value: Date | string, short = false): string {
  const d = new Date(value)
  const dayMonth = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  return short ? dayMonth : `${DAYS[d.getUTCDay()]} ${dayMonth} ${d.getUTCFullYear()}`
}

/** A time of day in Ghana: "7:05 pm". */
export function ghanaTime(value: Date | string): string {
  const d = new Date(value)
  const h = d.getUTCHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

const grouped = (n: number, decimals: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

export const usd = (amount: number) => `$${grouped(amount, 2)}`
/** Cedis actually charged or sent, from pesewas: "GH₵ 1,240.00". */
export const ghs = (pesewas: number) => `GH₵ ${grouped(pesewas / 100, 2)}`
/** The same for SMS. The cedi sign is not in the SMS alphabet and would triple the cost. */
export const smsGhs = (pesewas: number) => `GHS ${grouped(pesewas / 100, 2)}`
/** A dollar amount not yet paid, in cedis at a rate, for SMS: "about GHS 15,000". */
export const aboutSmsGhs = (amountUsd: number, usdToGhs: number) => `about GHS ${grouped(Math.round(amountUsd * usdToGhs), 0)}`
/** A dollar price in cedis at a rate, rounded, for amounts not yet paid: "about GH₵ 1,130". */
export const aboutGhs = (amountUsd: number, usdToGhs: number) => `about GH₵ ${grouped(Math.round(amountUsd * usdToGhs), 0)}`

/** First name only, or nothing. */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

// ── SMS ────────────────────────────────────────────────────────────────────

export const SMS_MAX = 160

// The SMS alphabet (GSM 03.38). Every printable ASCII character is in its
// basic table except these: the backtick is not in it at all (one would turn
// the whole message into the Unicode encoding, 70 characters a message), and
// the rest are in the extension table, which costs two characters each.
/** Characters a network counts twice. */
export const GSM_EXTENSION = '[]{}\\^~|'
const GSM_SWAP: Record<string, string> = { '[': '(', ']': ')', '{': '(', '}': ')', '\\': '/', '|': '/', '^': '', '~': '-', '`': "'" }

/**
 * Text an SMS can carry in one plain segment: printable ASCII, with nothing
 * from the extension table and no backtick, so every character counts once.
 * "%" is written out: some gateways refuse a message that holds it.
 */
export function smsSafe(text: string): string {
  return text
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')      // accents off: "Cafe" with an accent to "Cafe"
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u20B5/g, 'GHS')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[[\]{}\\|^~`]/g, (c) => GSM_SWAP[c])
    .replace(/%/g, ' percent')
    .replace(/\s+/g, ' ').trim()
}

/**
 * The length of a text as a network counts it in the plain SMS alphabet: one
 * for each basic character, two for each extension character. Null when the
 * text holds anything outside the alphabet, which would force Unicode.
 */
export function gsmLength(text: string): number | null {
  // The basic table's printable ASCII: everything from space to "~" but the backtick and the extension characters
  let length = 0
  for (const c of text) {
    if (GSM_EXTENSION.includes(c)) length += 2
    else if (c >= ' ' && c <= '~' && c !== '`') length += 1
    else return null
  }
  return length
}

/**
 * One SMS of at most 160 plain characters. `write` is given the listing title,
 * which is cut shorter and shorter until the whole message fits.
 */
export function sms(title: string | undefined, write: (title: string) => string): string {
  const clean = smsSafe(title ?? '') || 'your booking'
  for (const length of [30, 22, 14, 8]) {
    const cut = clean.length > length ? `${clean.slice(0, length - 2).trimEnd()}..` : clean
    const text = smsSafe(write(cut))
    if (text.length <= SMS_MAX) return text
  }
  return smsSafe(write('your booking')).slice(0, SMS_MAX)
}

// ── Addresses ──────────────────────────────────────────────────────────────

/** "kofi.mensah@gmail.com" as "k***@gmail.com": enough to recognise, not to use. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 1)}***@${domain}` : '***'
}

/** "+233241234567" as "+233 24 *** **67". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\s/g, '')
  return digits.length >= 8 ? `${digits.slice(0, 4)} ${digits.slice(4, 6)} *** **${digits.slice(-2)}` : '***'
}

/** A provider's error, with anything shaped like an email address or a phone number taken out. */
export function scrub(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[number]')
    .slice(0, 300)
}

// What is taken out of an error report before it leaves for Sentry. Reports
// are for finding bugs: they need IDs and stack traces, never a person's
// email, phone number, cookie, or a single-use link.
//
// Used by all three Sentry set-ups (browser, server, edge). Nothing here
// imports anything, so it is safe in every runtime.

type Bag = Record<string, unknown>

/** Query parameters that are secrets or point at one person's payment. */
const SECRET_PARAMS = ['token', 'reference', 'trxref', 'email', 'password', 'code', 'signature']
const SECRET_HEADERS = ['cookie', 'set-cookie', 'authorization', 'x-paystack-signature', 'x-forwarded-for', 'x-real-ip', 'x-vercel-forwarded-for']
const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|signature|otp|momoNumber|accountNumber|phone|email/i

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
/** Ghana numbers as people type them: +233…, 233…, 0… */
const PHONE = /(?:\+?233|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g
const PARAM = new RegExp(`(\\b(?:${SECRET_PARAMS.join('|')})=)[^&#\\s"']*`, 'gi')

/** Free text: emails, phone numbers and secret query parameters replaced. */
export function scrubText(text: string): string {
  return text.replace(PARAM, '$1[removed]').replace(EMAIL, '[email]').replace(PHONE, '[phone]')
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1))
  const out: Bag = {}
  for (const [key, item] of Object.entries(value as Bag)) {
    out[key] = SECRET_KEYS.test(key) && item != null && typeof item !== 'object' ? '[removed]' : scrubValue(item, depth + 1)
  }
  return out
}

/**
 * An event, cleaned. The request keeps its method and its address (with secret
 * parameters removed) and loses its cookies, its body and the headers that
 * identify a person. The user keeps an id and nothing else. Every piece of
 * text has emails, phone numbers and secret parameters replaced.
 */
export function scrubEvent<T>(event: T): T {
  const e = event as unknown as Bag
  const request = e.request as Bag | undefined
  if (request) {
    delete request.cookies
    delete request.data
    if (typeof request.url === 'string') request.url = scrubText(request.url)
    if (typeof request.query_string === 'string') request.query_string = scrubText(`?${request.query_string}`).slice(1)
    else if (request.query_string) request.query_string = scrubValue(request.query_string)
    if (request.headers && typeof request.headers === 'object') {
      request.headers = Object.fromEntries(Object.entries(request.headers as Bag)
        .filter(([name]) => !SECRET_HEADERS.includes(name.toLowerCase()))
        .map(([name, value]) => [name, scrubValue(value)]))
    }
  }
  const user = e.user as Bag | undefined
  if (user) e.user = user.id ? { id: user.id } : {}
  for (const key of ['message', 'transaction', 'extra', 'contexts', 'tags', 'breadcrumbs', 'exception', 'logentry']) {
    if (e[key] !== undefined) e[key] = scrubValue(e[key])
  }
  return event
}

/** A breadcrumb (a page change, a request the page made, a console line), cleaned the same way. */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  const b = breadcrumb as unknown as Bag
  if (typeof b.message === 'string') b.message = scrubText(b.message)
  if (b.data !== undefined) b.data = scrubValue(b.data)
  return breadcrumb
}

/** The options every Sentry set-up shares. */
export const SCRUBBING = {
  sendDefaultPii: false,
  beforeSend: <T>(event: T) => scrubEvent(event),
  beforeBreadcrumb: <T>(breadcrumb: T) => scrubBreadcrumb(breadcrumb),
} as const

// Stage C: the realistic traffic mix, k6 2.3.0. LOCAL TEST STACK ONLY.
//   e2e/.state/k6/k6-v2.3.0-macos-arm64/k6 run -e SCENARIO=smoke -e APPS=3200,3201 e2e/load/k6/mix.js
// Each virtual user (VU) is one visitor with its own address in x-vercel-forwarded-for (the header the app reads
// first), so the app's rate limits stay ON and apply per visitor as they would in production.
// Mix per iteration: 60% browse and search, 25% listing views, 8% sign-in and dashboards, 5% bookings,
// 2% payments (book, start the payment, pay at the fake Paystack, come back). Think time 1-5 s between pages.
// IDS (e2e/.reports/stageC/ids.json, from prepare.mjs): instant-book load listings, load guest emails.
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'
import exec from 'k6/execution'

const SCENARIO = __ENV.SCENARIO || 'smoke'
const APPS = (__ENV.APPS || '3200,3201').split(',')
const AVG = Number(__ENV.AVG_VUS || 50)
const FAKE = 'http://127.0.0.1:4010'
const ids = JSON.parse(open(__ENV.IDS || '../../.reports/stageC/ids.json'))
const PASSWORD = 'Load-pass-2026'

const scenarios = {
  smoke: { executor: 'constant-vus', vus: 2, duration: '1m' },
  average: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '2m', target: AVG }, { duration: '8m', target: AVG }, { duration: '1m', target: 0 }] },
  rampup: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '4m', target: AVG }, { duration: '4m', target: AVG * 2 }, { duration: '4m', target: AVG * 4 }, { duration: '3m', target: AVG * 4 }, { duration: '1m', target: 0 }] },
  spike: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m', target: AVG }, { duration: '2m', target: AVG }, { duration: '10s', target: AVG * 10 }, { duration: '3m', target: AVG * 10 }, { duration: '10s', target: AVG }, { duration: '2m', target: AVG }, { duration: '30s', target: 0 }] },
  // Arrival rate keeps rising whether or not the server keeps up; stopped by the thresholds below
  breakpoint: { executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s', preAllocatedVUs: 200, maxVUs: Number(__ENV.MAX_VUS || 3000), stages: [{ duration: __ENV.BREAK_DURATION || '30m', target: Number(__ENV.BREAK_TARGET || 300) }] },
  soak: { executor: 'constant-vus', vus: AVG, duration: __ENV.SOAK_DURATION || '60m' },
}

// What counts as a failure: a 5xx or no answer at all. Refusals the app means (409 dates taken,
// 429 rate limit, 401/403) are counted apart, by name, so they are visible and not hidden in "errors".
const failed = new Rate('failed_requests')
const errors5xx = new Counter('errors_5xx')
const noAnswer = new Counter('errors_no_answer')
const limited = new Counter('refused_429')
const conflicts = new Counter('refused_409')
const otherRefusals = new Counter('refused_other_4xx')
const flowTime = { browse: new Trend('flow_browse_ms', true), listing: new Trend('flow_listing_ms', true), dashboards: new Trend('flow_dashboards_ms', true), booking: new Trend('flow_booking_ms', true), payment: new Trend('flow_payment_ms', true) }
const bookingsMade = new Counter('bookings_made')
const paymentsSettled = new Counter('payments_settled')

const abortable = SCENARIO === 'breakpoint'
// BREAK_ON=errors: the breakpoint run stops only when failures pass 2%; the latency rules are reported, not
// enforced. Used once, declared in the report, to find where requests start FAILING (latency breaks first).
const latencyAborts = abortable && __ENV.BREAK_ON !== 'errors'
export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: {
    // The breakpoint run stops at the first of these that fails (after a minute's grace); the others report only
    failed_requests: [{ threshold: 'rate<0.02', abortOnFail: abortable, delayAbortEval: '1m' }],
    'http_req_duration{kind:browse}': [{ threshold: 'p(95)<2000', abortOnFail: latencyAborts, delayAbortEval: '1m' }],
    'http_req_duration{kind:write}': [{ threshold: 'p(95)<5000', abortOnFail: latencyAborts, delayAbortEval: '1m' }],
  },
}

function base() { return `http://localhost:${APPS[(exec.vu.idInTest - 1) % APPS.length]}` }
function vuIp() { const n = exec.vu.idInTest; return `10.${100 + Math.floor(n / 62500) % 100}.${Math.floor(n / 250) % 250}.${n % 250 + 1}` }
const jar = () => http.cookieJar()

function req(method, path, body, name, kind, extra = {}) {
  const params = { headers: { 'x-vercel-forwarded-for': vuIp(), origin: base(), ...(body ? { 'content-type': 'application/json' } : {}), ...(extra.headers || {}) }, tags: { name, kind }, redirects: extra.redirects ?? 0, timeout: '30s' }
  const url = path.startsWith('http') ? path : base() + path
  const r = method === 'GET' ? http.get(url, params) : http.request(method, url, body ? JSON.stringify(body) : null, params)
  const bad = r.status === 0 || r.status >= 500
  failed.add(bad, { name })
  if (r.status === 0) noAnswer.add(1, { name })
  else if (r.status >= 500) errors5xx.add(1, { name, status: String(r.status) })
  else if (r.status === 429) limited.add(1, { name })
  else if (r.status === 409) conflicts.add(1, { name })
  else if (r.status >= 400 && !(extra.expect || []).includes(r.status)) otherRefusals.add(1, { name, status: String(r.status) })
  return r
}
const think = () => sleep(1 + Math.random() * 4)
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const listingId = () => `load_l_${String(1 + Math.floor(Math.random() * 5000)).padStart(5, '0')}`
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
const REGIONS = ['Greater%20Accra', 'Ashanti', 'Central', 'Western', 'Northern', 'Volta']

function signIn() {
  const email = pick(ids.guests)
  const r = req('POST', '/api/auth/signin', { identifier: email, password: PASSWORD }, 'POST /api/auth/signin', 'write')
  return check(r, { 'signed in': (x) => x.status === 200 })
}

function browse() {
  const t = Date.now()
  req('GET', '/', null, 'page /', 'browse')
  req('GET', '/api/listings?featured=true&limit=8', null, 'GET /api/listings featured', 'browse')
  req('GET', '/api/listings/region-counts', null, 'GET /api/listings/region-counts', 'browse')
  req('GET', '/api/exchange-rate', null, 'GET /api/exchange-rate', 'browse')
  think()
  req('GET', '/search', null, 'page /search', 'browse')
  req('GET', '/api/listings?limit=50', null, 'GET /api/listings', 'browse')
  think()
  const q = Math.random()
  if (q < 0.4) req('GET', `/api/listings?limit=50&region=${pick(REGIONS)}`, null, 'GET /api/listings region', 'browse')
  else if (q < 0.7) req('GET', `/api/listings?limit=50&mode=${pick(['SHORT_STAY', 'TEMP_STAY', 'PERMANENT'])}`, null, 'GET /api/listings mode', 'browse')
  else { const d = 10 + Math.floor(Math.random() * 120); req('GET', `/api/listings?limit=50&checkIn=${day(d)}&checkOut=${day(d + 3)}`, null, 'GET /api/listings dates', 'browse') }
  flowTime.browse.add(Date.now() - t)
}

function listingView() {
  const t = Date.now()
  const id = listingId()
  req('GET', `/listings/${id}`, null, 'page /listings/:id', 'browse')
  req('GET', `/api/listings/${id}`, null, 'GET /api/listings/:id', 'browse')
  req('GET', `/api/listings/${id}/availability`, null, 'GET /api/listings/:id/availability', 'browse')
  req('GET', `/api/reviews?listingId=${id}`, null, 'GET /api/reviews', 'browse')
  flowTime.listing.add(Date.now() - t)
}

function dashboards() {
  const t = Date.now()
  jar().clear(base())
  if (!signIn()) return
  const s = req('GET', '/api/auth/session', null, 'GET /api/auth/session', 'browse')
  const me = s.json('user.id')
  think()
  req('GET', '/dashboard/guest', null, 'page /dashboard/guest', 'browse')
  if (me) req('GET', `/api/bookings?guestId=${me}`, null, 'GET /api/bookings guest', 'browse')
  req('GET', '/api/notifications', null, 'GET /api/notifications', 'browse')
  req('GET', '/api/wishlists', null, 'GET /api/wishlists', 'browse')
  think()
  req('GET', '/api/messages', null, 'GET /api/messages', 'browse')
  flowTime.dashboards.add(Date.now() - t)
}

/** Books an instant-book home on dates far ahead; returns the booking id or null. */
function book() {
  jar().clear(base())
  if (!signIn()) return null
  const id = pick(ids.instant)
  const d = 200 + Math.floor(Math.random() * 1500)
  const nights = 1 + Math.floor(Math.random() * 3)
  req('GET', `/api/listings/${id}/availability`, null, 'GET /api/listings/:id/availability', 'browse')
  const r = req('POST', '/api/bookings', { listingId: id, rentalMode: 'SHORT_STAY', checkIn: day(d), checkOut: day(d + nights) }, 'POST /api/bookings', 'write')
  if (r.status === 201 || r.status === 200) { bookingsMade.add(1); return r.json('booking.id') }
  return null
}

function booking() {
  const t = Date.now()
  book()
  flowTime.booking.add(Date.now() - t)
}

function payment() {
  const t = Date.now()
  const bookingId = book()
  if (!bookingId) return
  think()
  const start = req('POST', '/api/payments', { bookingId, method: 'CARD' }, 'POST /api/payments', 'write')
  const reference = start.status < 300 ? start.json('reference') : null
  if (!reference) return
  // The guest pays on (fake) Paystack and is sent back to the app's verify address
  const paid = req('POST', `${FAKE}/paystack/checkout/${encodeURIComponent(reference)}/success`, null, 'fake paystack pay', 'write')
  const back = req('GET', `/api/payments/verify?reference=${encodeURIComponent(reference)}`, null, 'GET /api/payments/verify', 'write')
  if (paid.status === 303 && back.status === 307 && String(back.headers.Location || '').includes('payment=success')) paymentsSettled.add(1)
  flowTime.payment.add(Date.now() - t)
}

export default function () {
  const x = Math.random()
  if (x < 0.60) group('browse and search', browse)
  else if (x < 0.85) group('listing views', listingView)
  else if (x < 0.93) group('sign-in and dashboards', dashboards)
  else if (x < 0.98) group('bookings', booking)
  else group('payments', payment)
  think()
}

export function handleSummary(data) {
  const out = __ENV.SUMMARY || `../../.reports/stageC/${SCENARIO}-k6.json`
  return { [out]: JSON.stringify(data, null, 1), stdout: `\n${SCENARIO}: ${data.metrics.http_reqs?.values.count ?? 0} requests, ${(data.metrics.http_reqs?.values.rate ?? 0).toFixed(1)}/s, p95 ${(data.metrics.http_req_duration?.values['p(95)'] ?? 0).toFixed(0)} ms, failed ${((data.metrics.failed_requests?.values.rate ?? 0) * 100).toFixed(2)}%\n` }
}

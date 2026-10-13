// Local stand-ins for every outside service the app talks to: Paystack,
// Resend, the exchange-rate API, Sentry, Supabase Storage and Unsplash.
// Listens on loopback only. Holds everything in memory and calls nothing.
//
// Tests steer it through /__control (see lib/fakes.ts). Failure rules are
// matched by a piece of text in the request (a booking id, a reference, an
// email address), so tests running side by side never affect each other.
import http from 'http'
import https from 'https'
import fs from 'fs'
import crypto from 'crypto'
import zlib from 'zlib'

const FAKES_PORT = Number(process.env.E2E_FAKES_PORT ?? 4010)
const STORAGE_PORT = Number(process.env.E2E_STORAGE_PORT ?? 4011)
const SECRET = process.env.PAYSTACK_SECRET_KEY ?? ''

const state = {
  tx: new Map(),          // reference -> transaction
  transfers: new Map(),   // reference -> transfer
  refunds: [],
  recipients: [],
  emails: [],
  emailKeys: new Map(),   // idempotency key -> id
  sentry: [],
  files: new Map(),       // bucket/path -> { type, bytes }
  calls: [],              // every request the app made to a fake
  rules: [],
  seq: 0,
}
const next = (prefix) => `${prefix}_${(++state.seq).toString(36)}${crypto.randomBytes(4).toString('hex')}`

// ── helpers ────────────────────────────────────────────────────────────────
const read = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))) })
const send = (res, status, body, headers = {}) => {
  if (res.swallowed) return
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, { 'content-type': typeof body === 'string' || Buffer.isBuffer(body) ? 'text/html; charset=utf-8' : 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', ...headers })
  res.end(payload)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Applies the first failure rule that matches. Returns true when it has answered (or is hanging on purpose). */
async function misbehave(endpoint, text, res) {
  const rule = state.rules.find((r) => r.endpoint === endpoint && (!r.match || text.includes(r.match)) && (r.times === undefined || r.times > 0))
  if (!rule) return false
  if (rule.times !== undefined) rule.times--
  rule.hits = (rule.hits ?? 0) + 1
  if (rule.delayMs) await sleep(rule.delayMs)
  switch (rule.behaviour) {
    case 'delay': return false
    case 'http500': send(res, 500, { status: false, message: 'Internal server error (fake)' }); return true
    case 'http400': send(res, 400, { status: false, message: rule.message ?? 'Bad request (fake)' }); return true
    case 'http429': send(res, 429, { status: false, message: 'Too many requests (fake)' }); return true
    case 'malformed': send(res, 200, '<html>not json', { 'content-type': 'application/json' }); return true
    case 'empty': send(res, 200, '', { 'content-type': 'application/json' }); return true
    case 'reset': res.socket?.destroy(); return true
    case 'swallow': res.swallowed = true; return false // does what was asked, then never answers: the caller cannot know it went through
    case 'hang': rule.waiting = (rule.waiting ?? 0) + 1; return true // never answers: the caller times out, or the test kills it
    default: return false
  }
}

function sign(body) { return crypto.createHmac('sha512', SECRET).update(body).digest('hex') }
async function webhook(target, event, data, { forged = false, signature } = {}) {
  const body = JSON.stringify({ event, data })
  const res = await fetch(`${target}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': signature ?? (forged ? sign(body + 'x') : sign(body)) },
    body,
  })
  return res.status
}
// A payment page nobody has acted on yet is "abandoned" to Paystack's verify, until the customer pays or fails
const chargeData = (t) => ({ id: t.id, reference: t.reference, status: t.status === 'pending' ? 'abandoned' : t.status, amount: t.paidAmount ?? t.amount, currency: t.paidCurrency ?? t.currency, channel: t.channels?.[0] ?? 'card', customer: { email: t.email }, metadata: t.metadata })

// A real PNG, drawn here, so image optimisation has something to work on
function png(width, height, seed = 0) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3
      raw[i] = (x * 255 / width + seed * 40) & 255; raw[i + 1] = (y * 255 / height) & 255; raw[i + 2] = (120 + seed * 70) & 255
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([len, body, crc]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PHOTOS = [0, 1, 2, 3].map((seed) => png(1200, 800, seed))

// ── Paystack ───────────────────────────────────────────────────────────────
async function paystack(req, res, url, body) {
  const path = url.pathname.replace(/^\/paystack/, '')
  const text = `${url.pathname}${url.search} ${body.toString('utf8')}`
  const json = () => { try { return JSON.parse(body.toString('utf8') || '{}') } catch { return {} } }
  const authorised = req.headers.authorization === `Bearer ${SECRET}`

  // The page the guest lands on to pay. Opened by a browser, not by the app.
  let m = /^\/checkout\/([^/]+)$/.exec(path)
  if (m && req.method === 'GET') {
    const t = state.tx.get(decodeURIComponent(m[1]))
    if (!t) return send(res, 404, '<h1>Unknown payment</h1>')
    const button = (outcome, label) => `<form method="post" action="/paystack/checkout/${encodeURIComponent(t.reference)}/${outcome}"><button type="submit">${label}</button></form>`
    return send(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake Paystack checkout</title></head><body><main><h1>Fake Paystack checkout</h1><p>Paying <strong data-testid="amount">${t.currency} ${(t.amount / 100).toFixed(2)}</strong> for <span data-testid="reference">${t.reference}</span></p>${button('success', 'Pay now')}${button('failed', 'Card declined')}${button('abandoned', 'Close without paying')}</main></body></html>`)
  }
  m = /^\/checkout\/([^/]+)\/(success|failed|abandoned)$/.exec(path)
  if (m && req.method === 'POST') {
    const t = state.tx.get(decodeURIComponent(m[1]))
    if (!t) return send(res, 404, '<h1>Unknown payment</h1>')
    if (t.status === 'pending') t.status = m[2]
    const target = new URL(t.callback_url).origin
    if (t.status === 'success' && t.webhook === 'before') await webhook(target, 'charge.success', chargeData(t))
    if (t.status === 'success' && t.webhook === 'after') setTimeout(() => webhook(target, 'charge.success', chargeData(t)).catch(() => {}), t.webhookDelayMs ?? 1500)
    res.writeHead(303, { location: `${t.callback_url}?trxref=${encodeURIComponent(t.reference)}&reference=${encodeURIComponent(t.reference)}` })
    return res.end()
  }

  const endpoint = path === '/transaction/initialize' ? 'initialize'
    : path.startsWith('/transaction/verify/') ? 'verify'
    : path === '/transfer' ? 'transfer'
    : path.startsWith('/transfer/verify/') ? 'transfer-lookup'
    : path === '/refund' && req.method === 'POST' ? 'refund'
    : path === '/refund' ? 'refund-list'
    : path === '/bank/resolve' ? 'resolve'
    : path === '/transferrecipient' ? 'recipient'
    : path === '/bank' ? 'banks' : 'unknown'
  state.calls.push({ service: 'paystack', endpoint, method: req.method, text, at: Date.now() })
  if (await misbehave(endpoint, text, res)) return
  if (!authorised) return send(res, 401, { status: false, message: 'Invalid key' })

  if (endpoint === 'initialize') {
    const p = json()
    if (state.tx.has(p.reference)) return send(res, 400, { status: false, message: 'Duplicate Transaction Reference' })
    const t = { id: state.seq + 1000, reference: p.reference, amount: p.amount, currency: p.currency, email: p.email, metadata: p.metadata, callback_url: p.callback_url, channels: p.channels, status: 'pending', webhook: 'none', createdAt: Date.now() }
    state.tx.set(t.reference, t); state.seq++
    return send(res, 200, { status: true, message: 'Authorization URL created', data: { authorization_url: `http://localhost:${FAKES_PORT}/paystack/checkout/${encodeURIComponent(t.reference)}`, access_code: next('ac'), reference: t.reference } })
  }
  if (endpoint === 'verify') {
    const t = state.tx.get(decodeURIComponent(path.split('/').pop()))
    if (!t) return send(res, 404, { status: false, message: 'Transaction reference not found' })
    t.verified = (t.verified ?? 0) + 1
    return send(res, 200, { status: true, message: 'Verification successful', data: chargeData(t) })
  }
  if (endpoint === 'transfer-lookup') {
    const tr = state.transfers.get(decodeURIComponent(path.split('/').pop()))
    if (!tr) return send(res, 404, { status: false, message: 'Transfer not found' })
    tr.lookups = (tr.lookups ?? 0) + 1
    return send(res, 200, { status: true, message: 'Transfer retrieved', data: { transfer_code: tr.transfer_code, status: tr.status, reference: tr.reference, amount: tr.amount } })
  }
  if (endpoint === 'transfer') {
    const p = json()
    const existing = state.transfers.get(p.reference)
    if (existing) { existing.duplicateAttempts++; return send(res, 400, { status: false, message: 'Please provide a unique reference. Reference already exists' }) }
    const tr = { reference: p.reference, amount: p.amount, recipient: p.recipient, reason: p.reason, transfer_code: next('TRF'), status: 'pending', duplicateAttempts: 0, createdAt: Date.now() }
    state.transfers.set(tr.reference, tr)
    return send(res, 200, { status: true, message: 'Transfer has been queued', data: { transfer_code: tr.transfer_code, status: 'pending', reference: tr.reference, amount: tr.amount } })
  }
  if (endpoint === 'refund') {
    const p = json()
    const t = state.tx.get(p.transaction)
    if (!t || t.status !== 'success') return send(res, 400, { status: false, message: 'Transaction not found or not successful' })
    const paid = t.paidAmount ?? t.amount
    const already = state.refunds.filter((r) => r.transaction_reference === t.reference && r.status !== 'failed').reduce((sum, r) => sum + r.amount, 0)
    const amount = p.amount ?? paid - already
    if (amount <= 0 || already + amount > paid) return send(res, 400, { status: false, message: 'Refund amount cannot be more than the transaction amount' })
    const r = { id: state.seq + 5000, transaction_reference: t.reference, transaction: { reference: t.reference }, amount, currency: t.currency, merchant_note: p.merchant_note, status: 'pending', createdAt: Date.now() }
    state.refunds.push(r); state.seq++
    return send(res, 200, { status: true, message: 'Refund has been queued for processing', data: r })
  }
  if (endpoint === 'refund-list') {
    const reference = url.searchParams.get('reference')
    return send(res, 200, { status: true, data: state.refunds.filter((r) => !reference || r.transaction_reference === reference) })
  }
  if (endpoint === 'resolve') {
    const number = url.searchParams.get('account_number') ?? ''
    if (number.endsWith('0000')) return send(res, 422, { status: false, message: 'Could not resolve account name. Check parameters or try again.' })
    return send(res, 200, { status: true, data: { account_number: number, account_name: `E2E ACCOUNT ${number.slice(-4)}` } })
  }
  if (endpoint === 'recipient') {
    const p = json()
    const r = { recipient_code: next('RCP'), ...p }
    state.recipients.push(r)
    return send(res, 200, { status: true, data: { recipient_code: r.recipient_code, type: p.type, name: p.name } })
  }
  if (endpoint === 'banks') {
    return send(res, 200, { status: true, data: [{ name: 'Fake Bank of Ghana', code: '999001', type: 'ghipss' }, { name: 'Second Fake Bank', code: '999002', type: 'ghipss' }, { name: 'MTN', code: 'MTN', type: 'mobile_money' }, { name: 'Vodafone', code: 'VOD', type: 'mobile_money' }, { name: 'AirtelTigo', code: 'ATL', type: 'mobile_money' }] })
  }
  return send(res, 404, { status: false, message: `Fake Paystack has no ${req.method} ${path}` })
}

// ── Resend, exchange rate, Sentry ──────────────────────────────────────────
async function resend(req, res, url, body) {
  const text = body.toString('utf8')
  state.calls.push({ service: 'resend', endpoint: 'resend', method: req.method, text, at: Date.now() })
  if (await misbehave('resend', text, res)) return
  if (req.headers.authorization !== 'Bearer re_e2e_fake') return send(res, 401, { message: 'API key is invalid' })
  const key = req.headers['idempotency-key']
  if (key && state.emailKeys.has(key)) return send(res, 200, { id: state.emailKeys.get(key) })
  let mail
  try { mail = JSON.parse(text) } catch { return send(res, 422, { message: 'Invalid JSON' }) }
  const id = next('email')
  if (key) state.emailKeys.set(key, id)
  state.emails.push({ id, key, at: Date.now(), ...mail, to: [].concat(mail.to ?? []) })
  return send(res, 200, { id })
}

// ── Storage and photos (second port) ───────────────────────────────────────
async function storage(req, res, url, body) {
  if (url.pathname.startsWith('/unsplash/')) {
    const n = [...url.pathname].reduce((sum, c) => sum + c.charCodeAt(0), 0) % PHOTOS.length
    return send(res, 200, PHOTOS[n], { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000' })
  }
  const path = url.pathname.replace(/^\/storage\/v1/, '')
  const text = `${url.pathname} ${req.headers['content-type'] ?? ''}`
  let m
  if (req.method === 'OPTIONS') return send(res, 204, '')
  if ((m = /^\/object\/(public|sign)\/(.+)$/.exec(path)) && (req.method === 'GET' || req.method === 'HEAD')) {
    const file = state.files.get(decodeURIComponent(m[2]))
    if (!file) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' })
    if (m[1] === 'sign' && !url.searchParams.get('token')) return send(res, 400, { error: 'InvalidJWT', message: 'missing token' })
    return send(res, 200, file.bytes, { 'content-type': file.type })
  }
  state.calls.push({ service: 'storage', endpoint: 'storage', method: req.method, text, at: Date.now() })
  if (await misbehave('storage', text, res)) return
  if (req.headers.authorization !== 'Bearer e2e-service-key') return send(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'Invalid key' })
  if ((m = /^\/object\/sign\/(.+)$/.exec(path)) && req.method === 'POST') {
    const key = decodeURIComponent(m[1])
    if (!state.files.has(key)) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
    return send(res, 200, { signedURL: `/object/sign/${m[1]}?token=${crypto.randomBytes(8).toString('hex')}` })
  }
  if ((m = /^\/object\/list\/([^/]+)$/.exec(path)) && req.method === 'POST') {
    const { prefix = '', search = '' } = JSON.parse(body.toString('utf8') || '{}')
    const start = `${m[1]}/${prefix ? `${prefix.replace(/\/$/, '')}/` : ''}`
    const names = [...state.files.keys()].filter((k) => k.startsWith(start)).map((k) => k.slice(start.length)).filter((n) => !n.includes('/') && n.includes(search))
    return send(res, 200, names.map((name) => ({ name, id: name })))
  }
  if ((m = /^\/object\/([^/]+)$/.exec(path)) && req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse(body.toString('utf8') || '{}')
    const removed = []
    for (const p of prefixes) if (state.files.delete(`${m[1]}/${p}`)) removed.push({ name: p })
    return send(res, 200, removed)
  }
  if ((m = /^\/object\/(.+)$/.exec(path)) && (req.method === 'POST' || req.method === 'PUT')) {
    const key = decodeURIComponent(m[1])
    let bytes = body, type = req.headers['content-type'] ?? 'application/octet-stream'
    const boundary = /boundary=(.+)$/.exec(type)?.[1]
    if (boundary) { // a form: take the file part
      const raw = body.toString('latin1')
      const part = raw.split(`--${boundary}`).find((p) => /filename=/.test(p)) ?? raw.split(`--${boundary}`)[1] ?? ''
      type = /content-type:\s*([^\r\n]+)/i.exec(part)?.[1] ?? 'application/octet-stream'
      bytes = Buffer.from(part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''), 'latin1')
    }
    if (state.files.has(key) && req.headers['x-upsert'] !== 'true' && req.method === 'POST') return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
    state.files.set(key, { type, bytes })
    return send(res, 200, { Key: key, Id: next('obj') })
  }
  return send(res, 404, { message: `Fake storage has no ${req.method} ${path}` })
}

// ── What the tests use to steer and to look ────────────────────────────────
async function control(req, res, url, body) {
  const path = url.pathname.replace('/__control', '')
  const p = body.length ? JSON.parse(body.toString('utf8')) : {}
  const q = Object.fromEntries(url.searchParams)
  if (path === '/health') return send(res, 200, { ok: true, pid: process.pid })
  if (path === '/rule' && req.method === 'POST') { const rule = { id: next('rule'), ...p }; state.rules.push(rule); return send(res, 200, rule) }
  if (path === '/rule' && req.method === 'DELETE') { state.rules = state.rules.filter((r) => r.id !== q.id); return send(res, 200, { ok: true }) }
  if (path === '/rules') return send(res, 200, state.rules)
  if (path === '/tx' && req.method === 'GET') {
    const found = [...state.tx.values()].filter((t) => (!q.reference || t.reference === q.reference) && (!q.match || JSON.stringify(t).includes(q.match)))
    return send(res, 200, found)
  }
  if (path === '/tx' && req.method === 'POST') { // settle a payment without a browser, or change what Paystack says was paid
    const t = state.tx.get(p.reference)
    if (!t) return send(res, 404, { error: 'unknown reference' })
    for (const key of ['status', 'paidAmount', 'paidCurrency', 'webhook', 'webhookDelayMs']) if (p[key] !== undefined) t[key] = p[key]
    return send(res, 200, t)
  }
  if (path === '/webhook' && req.method === 'POST') {
    let data = p.data
    if (!data && p.reference && p.event === 'charge.success') data = chargeData(state.tx.get(p.reference) ?? { reference: p.reference, status: 'success' })
    if (!data && p.event?.startsWith('transfer.')) {
      const tr = state.transfers.get(p.reference)
      if (!tr) return send(res, 404, { error: 'unknown transfer' })
      tr.status = p.event === 'transfer.success' ? 'success' : p.event === 'transfer.failed' ? 'failed' : 'reversed'
      data = { transfer_code: tr.transfer_code, reference: tr.reference, amount: tr.amount, status: tr.status, reason: tr.reason, ...(p.extra ?? {}) }
    }
    const statuses = await Promise.all(Array.from({ length: p.times ?? 1 }, () => webhook(p.target, p.event, data, { forged: p.forged, signature: p.signature }).catch(() => 0)))
    return send(res, 200, { statuses })
  }
  if (path === '/transfers') return send(res, 200, [...state.transfers.values()].filter((t) => !q.match || JSON.stringify(t).includes(q.match)))
  if (path === '/refunds' && req.method === 'GET') return send(res, 200, state.refunds.filter((r) => !q.match || JSON.stringify(r).includes(q.match)))
  if (path === '/refunds' && req.method === 'POST') { const r = state.refunds.find((x) => String(x.id) === String(p.id)); if (r) r.status = p.status; return send(res, 200, r ?? {}) }
  if (path === '/recipients') return send(res, 200, state.recipients.filter((r) => !q.match || JSON.stringify(r).includes(q.match)))
  if (path === '/inbox') return send(res, 200, state.emails.filter((e) => (!q.to || e.to.includes(q.to)) && (!q.match || JSON.stringify(e).includes(q.match))))
  if (path === '/sentry') return send(res, 200, state.sentry.filter((e) => !q.match || e.includes(q.match)))
  if (path === '/calls') return send(res, 200, state.calls.filter((c) => (!q.endpoint || c.endpoint === q.endpoint) && (!q.service || c.service === q.service) && (!q.match || c.text.includes(q.match))))
  if (path === '/file' && req.method === 'GET') { const f = state.files.get(q.key); return f ? send(res, 200, f.bytes, { 'content-type': f.type }) : send(res, 404, { error: 'no file' }) }
  if (path === '/files') return send(res, 200, [...state.files.keys()].filter((k) => !q.match || k.includes(q.match)))
  if (path === '/stats') return send(res, 200, { tx: state.tx.size, transfers: state.transfers.size, refunds: state.refunds.length, emails: state.emails.length, sentry: state.sentry.length, files: state.files.size, calls: state.calls.length, rules: state.rules.length })
  return send(res, 404, { error: `no control ${path}` })
}

const handler = (which) => async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    const body = await read(req)
    if (req.method === 'OPTIONS') return send(res, 204, '')
    // Over TLS both photo hosts arrive here; the Host header says which was meant
    if (which === 'storage' && String(req.headers.host).startsWith('images.unsplash.com')) url.pathname = `/unsplash${url.pathname}`
    if (which === 'storage') return await storage(req, res, url, body)
    if (url.pathname.startsWith('/__control')) return await control(req, res, url, body)
    if (url.pathname.startsWith('/paystack')) return await paystack(req, res, url, body)
    if (url.pathname.startsWith('/resend')) return await resend(req, res, url, body)
    if (url.pathname.startsWith('/rate')) {
      state.calls.push({ service: 'rate', endpoint: 'rate', method: req.method, text: url.pathname, at: Date.now() })
      if (await misbehave('rate', url.pathname, res)) return
      return send(res, 200, { result: 'success', base_code: 'USD', target_code: 'GHS', conversion_rate: 15.5 })
    }
    if (/^\/api\/\d+\/(envelope|store|security)\/?$/.test(url.pathname)) { state.sentry.push(body.toString('utf8')); return send(res, 200, { id: next('evt') }) }
    return send(res, 404, { error: `fake has no ${url.pathname}` })
  } catch (error) {
    console.error('[fakes]', error)
    if (!res.headersSent) send(res, 500, { error: 'fake server error', message: String(error?.message ?? error) })
  }
}
http.createServer(handler('fakes')).listen(FAKES_PORT, '127.0.0.1', () => console.log(`[fakes] paystack, resend, rate, sentry on 127.0.0.1:${FAKES_PORT}`))
if (process.env.E2E_TLS_KEY) https.createServer({ key: fs.readFileSync(process.env.E2E_TLS_KEY), cert: fs.readFileSync(process.env.E2E_TLS_CERT) }, handler('storage')).listen(Number(process.env.E2E_TLS_PORT), '127.0.0.1', () => console.log('[fakes] photos over TLS on 127.0.0.1:' + process.env.E2E_TLS_PORT))
http.createServer(handler('storage')).listen(STORAGE_PORT, '127.0.0.1', () => console.log(`[fakes] storage, photos on 127.0.0.1:${STORAGE_PORT}`))

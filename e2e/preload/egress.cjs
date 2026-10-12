// Loaded into the app's server process by the end-to-end launcher only
// (NODE_OPTIONS=--require). It is not part of the app: nothing under src/
// knows it exists, and a normal `next build` / `next start` never loads it.
//
// 1. Nothing leaves this machine. Any connection to an address that is not
//    loopback is refused, whatever opened it (fetch, http, https, a library).
// 2. The few outside hosts the app has written into its code are answered by
//    the local fakes instead.
// Every refused connection is written to a log the tests read: it must stay empty.
'use strict'
const fs = require('fs')
const net = require('net')
const dns = require('dns')

if (process.env.E2E !== '1') throw new Error('egress.cjs was loaded outside the end-to-end launcher')
const MAP = JSON.parse(process.env.E2E_HOST_MAP || '{}')
const LOG = process.env.E2E_EGRESS_LOG
const TLS_PORT = Number(process.env.E2E_TLS_PORT || 0)
// The made-up hosts that are reached over TLS by code that does not use fetch (the image optimiser)
const TLS_HOSTS = new Set(['images.unsplash.com', 'e2e-storage.fiegh.test'])
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', ''])
// A public-looking address for the made-up hosts, for code that looks a name up before fetching it
const PRETEND_IP = '93.184.216.34' // never connected to: the socket guard above would refuse it

const note = (kind, host) => { try { if (LOG) fs.appendFileSync(LOG, `${new Date().toISOString()} ${kind} ${host}\n`) } catch {} }

// ── 1. The last line: no socket to anywhere but this machine ──────────────
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  let host
  if (first && typeof first === 'object') host = first.path ? '' : first.host ?? first.hostname ?? 'localhost'
  else if (typeof first === 'string') host = '' // a unix socket path
  else host = typeof args[1] === 'string' ? args[1] : 'localhost'
  // The pretend address of the made-up photo hosts: answered by the local fake's TLS port
  if (TLS_PORT && (host === PRETEND_IP || TLS_HOSTS.has(String(host).toLowerCase()))) {
    const options = typeof first === 'object' ? { ...first, host: '127.0.0.1', port: TLS_PORT } : { host: '127.0.0.1', port: TLS_PORT }
    delete options.lookup
    const done = Array.isArray(args[0]) ? args[0][1] : args.find((a) => typeof a === 'function')
    return typeof done === 'function' ? connect.call(this, options, done) : connect.call(this, options)
  }
  if (!LOOPBACK.has(String(host).toLowerCase())) {
    note('BLOCKED-SOCKET', host)
    process.nextTick(() => this.destroy(Object.assign(new Error(`e2e: outbound connection to ${host} refused`), { code: 'ECONNREFUSED' })))
    return this
  }
  return connect.apply(this, args)
}

// ── 2. fetch: the made-up hosts go to the fakes, everything else is refused ──
const realFetch = globalThis.fetch
globalThis.fetch = async function e2eFetch(input, init) {
  const request = typeof input === 'string' || input instanceof URL ? null : input
  const url = new URL(request ? request.url : String(input))
  if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
  const target = MAP[url.hostname]
  if (!target) {
    note('BLOCKED-FETCH', url.hostname)
    throw new TypeError(`e2e: fetch to ${url.hostname} refused`)
  }
  const to = target + url.pathname + url.search
  if (request) return realFetch(new Request(to, request), init)
  return realFetch(to, init)
}

// ── 3. Name look-ups for the made-up hosts answer, so nothing asks a real DNS server ──
const lookup = dns.lookup
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {} }
  if (MAP[hostname]) {
    const all = options && typeof options === 'object' && options.all
    return process.nextTick(() => (all ? callback(null, [{ address: PRETEND_IP, family: 4 }]) : callback(null, PRETEND_IP, 4)))
  }
  return lookup.call(dns, hostname, options, callback)
}
const lookupPromise = dns.promises.lookup
dns.promises.lookup = async function (hostname, options) {
  if (MAP[hostname]) return options && options.all ? [{ address: PRETEND_IP, family: 4 }] : { address: PRETEND_IP, family: 4 }
  return lookupPromise.call(dns.promises, hostname, options)
}

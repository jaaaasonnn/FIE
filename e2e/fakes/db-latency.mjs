// A TCP proxy that puts network latency between the app and Postgres, for the load runs: listens where the
// app expects the database (E2E_LATENCY_LISTEN) and passes bytes to the real one (E2E_LATENCY_TARGET), each
// chunk held for a random one-way delay so a round trip costs E2E_LATENCY_MS (e.g. "30-80"), in order.
// Loopback only. A stand-in for the network between Vercel and Supabase; it cannot reproduce their pooler.
import net from 'net'

const [lo, hi] = String(process.env.E2E_LATENCY_MS ?? '30-80').split('-').map(Number)
const listen = Number(process.env.E2E_LATENCY_LISTEN)
const target = Number(process.env.E2E_LATENCY_TARGET)
const oneWay = () => (lo + Math.random() * (hi - lo)) / 2

/** Sends chunks from `from` to `to` after a delay, strictly in order: one queue per direction, one timer at a
 *  time (separate timers due at the same moment can fire out of order, which corrupts the Postgres protocol). */
function pipeLate(from, to) {
  const queue = [] // [releaseAt, chunk | null for end]
  let timer = null
  let last = 0
  const pump = () => {
    timer = null
    while (queue.length && queue[0][0] <= Date.now()) {
      const [, chunk] = queue.shift()
      if (to.destroyed) return
      if (chunk === null) to.end(); else to.write(chunk)
    }
    if (queue.length) timer = setTimeout(pump, Math.max(0, queue[0][0] - Date.now()))
  }
  const push = (chunk) => {
    last = Math.max(Date.now() + oneWay(), last)
    queue.push([last, chunk])
    if (!timer) timer = setTimeout(pump, Math.max(0, queue[0][0] - Date.now()))
  }
  from.on('data', (chunk) => push(chunk))
  from.on('end', () => push(null))
}

let open = 0
net.createServer((client) => {
  open++
  const server = net.connect(target, '127.0.0.1')
  client.setNoDelay(true); server.setNoDelay(true)
  pipeLate(client, server)
  pipeLate(server, client)
  const close = () => { client.destroy(); server.destroy() }
  client.on('error', close); server.on('error', close)
  client.on('close', () => { open--; server.destroy() }); server.on('close', () => client.destroy())
}).listen(listen, '127.0.0.1', () => console.log(`[db-latency] 127.0.0.1:${listen} -> 127.0.0.1:${target}, round trip ${lo}-${hi} ms`))
setInterval(() => console.log(`[db-latency] ${new Date().toISOString()} open connections ${open}`), 60_000).unref()

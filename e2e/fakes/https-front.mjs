// An https front for the test stack: TLS on E2E_FRONT_PORT, passed on to the first app server.
// Only so WebKit keeps the app's `Secure` session cookie, as it would on the real https site.
// The certificate is a throwaway made by run.mjs; only the test browsers accept it
// (ignoreHTTPSErrors on the projects that use this front). Nothing else trusts it.
import fs from 'fs'
import http from 'http'
import https from 'https'

const port = Number(process.env.E2E_FRONT_PORT)
const target = { host: '127.0.0.1', port: Number(process.env.E2E_FRONT_TARGET) }

const handler = (req, res) => {
  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host ?? `localhost:${port}`, 'x-forwarded-port': String(port) }
  const upstream = http.request({ ...target, method: req.method, path: req.url, headers }, (answer) => {
    // rawHeaders keeps repeated headers (several Set-Cookie lines) exactly as the app sent them
    res.writeHead(answer.statusCode ?? 502, answer.rawHeaders)
    answer.pipe(res)
  })
  upstream.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`https front: ${e.message}`) })
  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
}
const tls = { key: fs.readFileSync(process.env.E2E_FRONT_KEY), cert: fs.readFileSync(process.env.E2E_FRONT_CERT) }
// Loopback only, on both address families, so `localhost` works whichever one the browser tries first
for (const host of ['127.0.0.1', '::1']) https.createServer(tls, handler).listen(port, host, () => console.log(`[https-front] https://localhost:${port} (${host}) -> http://127.0.0.1:${target.port}`))

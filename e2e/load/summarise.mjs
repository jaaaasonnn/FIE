// Summarises one load run folder (from stage-c.sh): per scenario the requests, their rate, browse and write
// p50/p95/p99, failed share, 5xx / no answer / 429, bookings and payments made; and for the breakpoint run the
// rate the requests were being served at when it was stopped (the last 30 s, from the k6 CSV).
//   node e2e/load/summarise.mjs e2e/.reports/fixperf/before [more folders...]
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

const v = (m, k) => m?.values?.[k] ?? null
const ms = (x) => (x === null ? '–' : Math.round(x).toLocaleString('en-GB'))

function breakingRate(dir, name) {
  const file = path.join(dir, `${name}-k6.csv.gz`)
  if (!fs.existsSync(file)) return null
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n')
  const at = []
  for (const line of lines) if (line.startsWith('http_reqs,')) at.push(Number(line.split(',')[1]))
  if (!at.length) return null
  const end = Math.max(...at)
  return at.filter((t) => t > end - 30).length / 30
}

const out = {}
for (const dir of process.argv.slice(2)) {
  out[dir] = {}
  for (const name of ['smoke', 'average', 'rampup', 'spike', 'breakpoint', 'soak']) {
    const f = path.join(dir, `${name}-k6.json`)
    if (!fs.existsSync(f)) continue
    const m = JSON.parse(fs.readFileSync(f, 'utf8')).metrics
    const browse = m['http_req_duration{kind:browse}']
    const write = m['http_req_duration{kind:write}']
    out[dir][name] = {
      requests: v(m.http_reqs, 'count'), perSecond: +(v(m.http_reqs, 'rate') ?? 0).toFixed(1),
      browse: [v(browse, 'med'), v(browse, 'p(95)'), v(browse, 'p(99)')].map((x) => (x === null ? null : Math.round(x))),
      write: [v(write, 'med'), v(write, 'p(95)'), v(write, 'p(99)')].map((x) => (x === null ? null : Math.round(x))),
      failedPercent: +((v(m.failed_requests, 'rate') ?? 0) * 100).toFixed(2),
      errors5xx: v(m.errors_5xx, 'count') ?? 0, noAnswer: v(m.errors_no_answer, 'count') ?? 0, refused429: v(m.refused_429, 'count') ?? 0,
      bookings: v(m.bookings_made, 'count') ?? 0, payments: v(m.payments_settled, 'count') ?? 0,
      ...(name === 'breakpoint' ? { servedPerSecondAtStop: +(breakingRate(dir, name) ?? 0).toFixed(1) } : {}),
    }
  }
}
console.log(JSON.stringify(out, null, 1))
for (const [dir, runs] of Object.entries(out)) {
  console.log(`\n${dir}`)
  for (const [name, r] of Object.entries(runs)) {
    console.log(`${name.padEnd(11)} ${String(r.requests).padStart(7)} req  ${String(r.perSecond).padStart(6)}/s  browse ${r.browse.map(ms).join(' / ')}  write ${r.write.map(ms).join(' / ')}  failed ${r.failedPercent}%  5xx ${r.errors5xx}  none ${r.noAnswer}  429 ${r.refused429}  booked ${r.bookings} paid ${r.payments}${r.servedPerSecondAtStop ? `  at stop ${r.servedPerSecondAtStop}/s` : ''}`)
  }
}

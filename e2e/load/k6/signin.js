// Sign-in only, rising until it breaks: how many sign-ins a second the servers take (bcryptjs, cost 12).
// Each request from its own address, so the per-address limits are not what stops it.
import http from 'k6/http'
import exec from 'k6/execution'
import { Rate } from 'k6/metrics'
const APPS = (__ENV.APPS || '3200,3201').split(',')
const ids = JSON.parse(open(__ENV.IDS || '../../.reports/stageC/ids.json'))
const failed = new Rate('failed_requests')
export const options = {
  scenarios: { signin: { executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s', preAllocatedVUs: 100, maxVUs: 2000, stages: [{ duration: __ENV.DURATION || '6m', target: Number(__ENV.TARGET || 80) }] } },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: { failed_requests: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '30s' }], http_req_duration: [{ threshold: 'p(95)<2000', abortOnFail: __ENV.BREAK_ON !== 'errors', delayAbortEval: '30s' }] },
}
export default function () {
  const n = exec.scenario.iterationInTest
  const r = http.post(`http://localhost:${APPS[n % APPS.length]}/api/auth/signin`, JSON.stringify({ identifier: ids.guests[n % ids.guests.length], password: 'Load-pass-2026' }),
    { headers: { 'content-type': 'application/json', origin: 'http://localhost:3200', 'x-vercel-forwarded-for': `10.${150 + Math.floor(n / 62500) % 100}.${Math.floor(n / 250) % 250}.${n % 250 + 1}` }, timeout: '30s' })
  failed.add(r.status === 0 || r.status >= 500)
}
export function handleSummary(data) { return { [__ENV.SUMMARY || '../../.reports/stageC/signin-k6.json']: JSON.stringify(data, null, 1), stdout: `signin: ${data.metrics.http_reqs.values.count} requests, ${data.metrics.http_reqs.values.rate.toFixed(1)}/s, p95 ${data.metrics.http_req_duration.values['p(95)'].toFixed(0)} ms, failed ${(data.metrics.failed_requests.values.rate * 100).toFixed(2)}%\n` } }

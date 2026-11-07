import { OFFLINE_WORKER } from '@/lib/offlineWorker'

// /sw.js: the installed app's service worker (src/lib/offlineWorker.ts). no-cache: the browser asks again each time it
// checks for a new version, so a change (or the kill switch, OFFLINE_WORKER_OFF) reaches every phone on its next page
// load. Same origin, scope / (no Service-Worker-Allowed header).
export function GET() {
  return new Response(OFFLINE_WORKER, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

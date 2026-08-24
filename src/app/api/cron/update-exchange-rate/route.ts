import { NextResponse } from 'next/server'
import { updateExchangeRateFromApi } from '@/lib/exchangeRate'

/**
 * GET/POST /api/cron/update-exchange-rate
 *
 * Not user-facing — meant to be hit periodically by an external scheduler,
 * same pattern as /api/cron/process-payouts and /api/cron/complete-bookings
 * (no scheduler infra exists yet for any of the three; wiring one up is a
 * deployment-time step, not something to fake against a local dev server).
 *
 * Intended cadence: every 6 hours. Exchange rates don't move fast enough to
 * need more than that, and even ExchangeRate-API's free tier only refreshes
 * its own source data once a day — 4 attempts/day just means a single
 * failed run doesn't leave the stored rate stale for a whole day. At that
 * cadence this uses ~120 of the free plan's 1,500 requests/month.
 *
 * Secured by a shared secret (CRON_SECRET), same as the other two cron
 * routes — checked via header (x-cron-secret) so it also works for
 * schedulers that only support GET with no custom body.
 *
 * Returns a non-2xx status on failure (in addition to logging and writing
 * the failure to SiteSetting) so an external scheduler with its own
 * failure alerting has something to alert on — the fallback behavior
 * itself doesn't depend on that; see updateExchangeRateFromApi().
 */
function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('x-cron-secret') === secret
}

async function handle(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await updateExchangeRateFromApi()
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 })
  }
  return NextResponse.json(result)
}

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}

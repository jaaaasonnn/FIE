import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runCompletion, wantsDryRun } from '@/lib/cronRuns'

/**
 * GET/POST /api/cron/complete-bookings
 *
 * Not user-facing — meant to be hit periodically by an external scheduler,
 * same pattern as /api/cron/process-payouts (no scheduler infra existed
 * before that one either; wiring an actual recurring trigger up is a
 * deployment-time step, not something to configure against a local dev
 * server).
 *
 * Deliberately a SEPARATE endpoint from process-payouts rather than a step
 * inside it: the SHORT_STAY payout trigger fires 24h after check-IN, not
 * after checkout/completion, so this and the payout cron check two
 * independent conditions on two different timestamps — they aren't
 * sequential steps of one process. Folding them together would couple a
 * checkout-based check to a check-in-based one for no reason, and risk a
 * slow/broken completion query delaying payout processing.
 *
 * Query is naturally idempotent: once a booking's status flips to
 * COMPLETED, it no longer matches status: 'CONFIRMED' and is never
 * re-selected on a later run.
 *
 * The rules live in lib/cronRuns.ts (runCompletion). Nothing is completed
 * until COMPLETION_ENABLED is set (lib/payoutSwitches.ts); until then, and
 * whenever ?dryRun=1 is passed, the job only reports what it would do.
 * Completing a stay never costs the host a payout: the payout job picks up
 * COMPLETED stays as well as CONFIRMED ones.
 */
function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Wrapped in Sentry.withMonitor() rather than relying on automatic Vercel
// cron detection — that feature only instruments the Pages Router, not
// App Router route handlers like this one. Schedule here must be kept in
// sync with vercel.json's entry for this route.
function runMonitored(req: Request) {
  const dryRun = wantsDryRun(req)
  return Sentry.withMonitor('complete-bookings-cron', () => runCompletion({ dryRun }), {
    schedule: { type: 'crontab', value: '0 * * * *' },
    timezone: 'UTC',
    checkinMargin: 5,
    maxRuntime: 5,
  })
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runMonitored(req))
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runMonitored(req))
}

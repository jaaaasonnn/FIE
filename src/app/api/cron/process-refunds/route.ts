import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runRefunds } from '@/lib/refunds'
import { wantsDryRun } from '@/lib/cronRuns'

/**
 * GET/POST /api/cron/process-refunds
 *
 * Not user-facing: called hourly by the scheduler, like the payout and
 * completion jobs. Sends refunds that are owed and not yet with Paystack:
 * ones recorded while refunds were switched off, ones an earlier run died
 * on, and failed ones due another try. Before any second attempt it asks
 * Paystack which refunds already exist for the payment, so a timeout cannot
 * turn into two refunds. The rules live in lib/refunds.ts (runRefunds).
 *
 * Nothing is sent until REFUNDS_ENABLED is set (lib/payoutSwitches.ts);
 * until then, and whenever ?dryRun=1 is passed, the job only reports what it
 * would do: no database writes and no Paystack calls.
 *
 * Secured by the same shared secret as the other cron routes:
 * `Authorization: Bearer <CRON_SECRET>`.
 */
function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Schedule here must be kept in sync with vercel.json's entry for this route.
function runMonitored(req: Request) {
  const dryRun = wantsDryRun(req)
  return Sentry.withMonitor('process-refunds-cron', () => runRefunds({ dryRun }), {
    schedule: { type: 'crontab', value: '30 * * * *' },
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

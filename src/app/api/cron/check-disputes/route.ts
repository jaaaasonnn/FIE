import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runDisputeCheck } from '@/lib/disputeDecisions'
import { wantsDryRun } from '@/lib/cronRuns'

/**
 * GET/POST /api/cron/check-disputes
 *
 * Not user-facing: called once a day by the scheduler. Raises one Sentry
 * alert for each dispute still undecided three days after it was raised, so
 * a dispute that is being left raises one alert a day until it is decided.
 * It moves no money and changes no rows (lib/disputeDecisions.ts,
 * runDisputeCheck). With ?dryRun=1 it only reports which disputes are
 * overdue and sends no alert.
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
  return Sentry.withMonitor('check-disputes-cron', () => runDisputeCheck({ dryRun }), {
    schedule: { type: 'crontab', value: '0 9 * * *' },
    timezone: 'UTC',
    checkinMargin: 10,
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

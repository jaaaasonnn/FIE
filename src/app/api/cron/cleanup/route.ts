import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runCleanup } from '@/lib/cleanup'
import { wantsDryRun } from '@/lib/cronRuns'
import { cronAuthorised } from '@/lib/cronAuth'

/**
 * GET/POST /api/cron/cleanup, daily at 03:30 UTC.
 *
 * Removes sessions that have run out and rate-limit counts over a week old
 * (lib/cleanup.ts). It has no switch: it deletes nothing anyone can still
 * use. ?dryRun=1 reports the numbers and deletes nothing.
 *
 * Schedule here must be kept in sync with vercel.json's entry for this route.
 */
function runMonitored(req: Request) {
  const dryRun = wantsDryRun(req)
  return Sentry.withMonitor('cleanup-cron', () => runCleanup({ dryRun }), {
    schedule: { type: 'crontab', value: '30 3 * * *' },
    timezone: 'UTC',
    checkinMargin: 30,
    maxRuntime: 5,
  })
}

export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runMonitored(req))
}

export async function POST(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runMonitored(req))
}

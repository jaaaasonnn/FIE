import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { wantsDryRun } from '@/lib/cronRuns'
import { runListingCheckReminders } from '@/lib/listingCheckReminders'

/**
 * GET/POST /api/cron/listing-check-reminders
 *
 * Emails a host once, 30 days before the "Address and photos checked" on
 * their listing runs out. The rules are in lib/listingCheckReminders.ts. It
 * only writes messages, which are themselves only logged until messaging is
 * switched on, and each check is reminded once however often this runs.
 * ?dryRun=1 reports what it would do and writes nothing.
 *
 * Runs once a day. Secured by CRON_SECRET like the other cron routes.
 */
function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Schedule here must be kept in sync with vercel.json's entry for this route.
function runMonitored(req: Request) {
  const dryRun = wantsDryRun(req)
  return Sentry.withMonitor('listing-check-reminders-cron', () => runListingCheckReminders({ dryRun }), {
    schedule: { type: 'crontab', value: '15 8 * * *' },
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

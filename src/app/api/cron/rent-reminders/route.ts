import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { wantsDryRun } from '@/lib/cronRuns'
import { runRentReminders } from '@/lib/rentReminders'

/**
 * GET/POST /api/cron/rent-reminders
 *
 * Reminds tenants about rent that is coming due or late, and tells the host
 * and the admins when a payment first becomes late. The rules are in
 * lib/rentReminders.ts (runRentReminders). It charges nothing and only writes
 * messages, which are themselves only logged until messaging is switched on.
 *
 * Nothing is written until RENT_REMINDERS_ENABLED is set
 * (lib/payoutSwitches.ts); until then, and whenever ?dryRun=1 is passed, the
 * job only reports what it would do and never calls Paystack.
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
  return Sentry.withMonitor('rent-reminders-cron', () => runRentReminders({ dryRun }), {
    schedule: { type: 'crontab', value: '0 8 * * *' },
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

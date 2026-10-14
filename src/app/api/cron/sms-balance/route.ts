import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runSmsBalance } from '@/lib/messaging/smsBalance'
import { wantsDryRun } from '@/lib/cronRuns'
import { cronAuthorised } from '@/lib/cronAuth'

/**
 * GET/POST /api/cron/sms-balance, hourly at 20 past.
 *
 * Reads the Arkesel SMS balance and alerts once a day when it is below
 * SMS_LOW_BALANCE_ALERT (lib/messaging/smsBalance.ts). It calls Arkesel only
 * when MESSAGING_ENABLED=true and SMS_PROVIDER=arkesel; otherwise, and with
 * ?dryRun=1, it calls nothing and says why.
 *
 * Secured by the same shared secret as the other cron routes:
 * `Authorization: Bearer <CRON_SECRET>`.
 */
// Schedule here must be kept in sync with vercel.json's entry for this route.
function runMonitored(req: Request) {
  const dryRun = wantsDryRun(req)
  return Sentry.withMonitor('sms-balance-cron', () => runSmsBalance({ dryRun }), {
    schedule: { type: 'crontab', value: '20 * * * *' },
    timezone: 'UTC',
    checkinMargin: 10,
    maxRuntime: 2,
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

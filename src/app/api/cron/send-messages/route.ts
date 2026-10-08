import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runMessages } from '@/lib/messaging/deliver'
import { wantsDryRun } from '@/lib/cronRuns'

/**
 * GET/POST /api/cron/send-messages
 *
 * Not user-facing: called every minute by the scheduler. Sends the emails
 * and SMS that notify() has queued in the message log, retries the ones a
 * provider refused, and closes anything whose outcome is unsure so it can
 * never be sent twice. The rules live in lib/messaging/deliver.ts.
 *
 * Nothing is sent until MESSAGING_ENABLED is set and a provider is named
 * (lib/messaging/config.ts). Until then nothing is ever queued, so this job
 * finds nothing to do. With ?dryRun=1 it only reports what is waiting.
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
  return Sentry.withMonitor('send-messages-cron', () => runMessages({ dryRun }), {
    schedule: { type: 'crontab', value: '* * * * *' },
    timezone: 'UTC',
    checkinMargin: 2,
    maxRuntime: 2,
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

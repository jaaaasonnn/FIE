import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runExpiry } from '@/lib/bookingExpiry'
import { wantsDryRun } from '@/lib/cronRuns'

/**
 * GET/POST /api/cron/expire-bookings
 *
 * Not user-facing: called every 15 minutes by the scheduler. Ends bookings
 * that are holding dates nobody has paid for: a confirmed booking still
 * unpaid 15 minutes after its time to pay, and a request the host has not
 * answered in time. Before ending one it asks Paystack (read-only) about any
 * payment still open on it, so a guest who paid and closed the tab is
 * confirmed instead. The rules live in lib/bookingExpiry.ts (runExpiry).
 *
 * Nothing is ended until BOOKING_EXPIRY_ENABLED and BOOKING_EXPIRY_NOT_BEFORE
 * are set (lib/payoutSwitches.ts); until then, and whenever ?dryRun=1 is
 * passed, the job only reports what it would do: no database writes and no
 * Paystack calls.
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
  return Sentry.withMonitor('expire-bookings-cron', () => runExpiry({ dryRun }), {
    schedule: { type: 'crontab', value: '*/15 * * * *' },
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

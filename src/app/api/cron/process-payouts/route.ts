import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { runPayouts, wantsDryRun } from '@/lib/cronRuns'

/**
 * GET/POST /api/cron/process-payouts
 *
 * Not user-facing — meant to be hit periodically by an external scheduler
 * (e.g. Vercel Cron, which calls cron endpoints via GET; a plain system
 * crontab curling this would typically use POST — both are wired to the
 * same logic here). No scheduler is actually configured yet; wiring one
 * up (a `crons` entry in vercel.json once deployed, or a system cron
 * entry in the meantime) is a deployment-time step, not something to set
 * up against a local dev server.
 *
 * Short stays are paid once, 48 hours after check-in. Monthly and long-term
 * stays are paid one rent instalment at a time (lib/rentRules.ts): the first
 * 48 hours after move-in, each later one on the later of the day it was paid
 * and the day it fell due. A long stay made before instalments existed has
 * none and is left untouched.
 *
 * The rules live in lib/cronRuns.ts (runPayouts). Nothing is paid until
 * PAYOUTS_ENABLED and PAYOUTS_NOT_BEFORE are set (lib/payoutSwitches.ts);
 * until then, and whenever ?dryRun=1 is passed, the job only reports what it
 * would do: no database writes and no Paystack calls.
 *
 * Secured by a shared secret (CRON_SECRET) rather than a user session,
 * since there's no logged-in user driving this — checked via the standard
 * `Authorization: Bearer <CRON_SECRET>` header, which is what Vercel's
 * native cron feature sends automatically when CRON_SECRET is set as an
 * env var (see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
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
  return Sentry.withMonitor('process-payouts-cron', () => runPayouts({ dryRun }), {
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

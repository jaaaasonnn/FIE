import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { db } from '@/lib/db'
import { initiateHostPayout } from '@/lib/payouts'
import { PLATFORM_COMMISSION } from '@/lib/utils'

const PAYOUT_DELAY_MS = 24 * 60 * 60 * 1000 // 24h after check-in, matches the app's own copy

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
 * SHORT_STAY only for now — long-stay (TEMP_STAY/PERMANENT) payout
 * periods need a data-model decision that hasn't been made yet, so those
 * bookings are deliberately left untouched by this query.
 *
 * Secured by a shared secret (CRON_SECRET) rather than a user session,
 * since there's no logged-in user driving this — checked via the standard
 * `Authorization: Bearer <CRON_SECRET>` header, which is what Vercel's
 * native cron feature sends automatically when CRON_SECRET is set as an
 * env var (see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 */
async function processDuePayouts() {
  const cutoff = new Date(Date.now() - PAYOUT_DELAY_MS)

  // payouts: { none: {} } is a belt-and-suspenders check on top of
  // initiateHostPayout()'s own idempotency guard — cheaper to exclude
  // already-handled bookings from the query than to call the function
  // (and hit the DB again) for every single one, every run.
  const dueBookings = await db.booking.findMany({
    where: {
      rentalMode: 'SHORT_STAY',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      checkIn: { lte: cutoff },
      payouts: { none: {} },
    },
    select: { id: true, hostId: true, subtotal: true },
  })

  const results = []
  for (const booking of dueBookings) {
    const hostPayoutAmount = booking.subtotal * (1 - PLATFORM_COMMISSION)
    try {
      const result = await initiateHostPayout({
        hostId: booking.hostId,
        bookingId: booking.id,
        amount: hostPayoutAmount,
      })
      results.push({
        bookingId: booking.id,
        ok: result.ok,
        payoutId: result.payout.id,
        status: result.payout.status,
        alreadyInitiated: result.alreadyInitiated ?? false,
      })
    } catch (error) {
      console.error('[Payout cron] initiateHostPayout threw for booking', booking.id, error)
      results.push({ bookingId: booking.id, ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }

  return { checked: dueBookings.length, results }
}

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Wrapped in Sentry.withMonitor() rather than relying on automatic Vercel
// cron detection — that feature only instruments the Pages Router, not
// App Router route handlers like this one. Schedule here must be kept in
// sync with vercel.json's entry for this route.
function runMonitored() {
  return Sentry.withMonitor('process-payouts-cron', processDuePayouts, {
    schedule: { type: 'crontab', value: '0 * * * *' },
    timezone: 'UTC',
    checkinMargin: 5,
    maxRuntime: 5,
  })
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runMonitored())
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runMonitored())
}

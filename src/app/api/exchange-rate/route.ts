import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/exchange-rate — public, unauthenticated read of the current
 * USD→GHS rate. Mirrors the same DB-first-then-env-fallback pattern already
 * used by /api/payments and lib/payouts.ts, so every part of the app (guest
 * pages included, which have no admin session) resolves to the same number
 * the admin panel last set.
 */
export async function GET() {
  const rateRow = await db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' } })
  const rate = rateRow?.usdToGhs ?? Number(process.env.INITIAL_USD_TO_GHS ?? 15.5)
  return NextResponse.json({ rate })
}

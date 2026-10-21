import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cached } from '@/lib/shortCache'

/**
 * GET /api/exchange-rate — public, unauthenticated read of the current
 * USD→GHS rate. Mirrors the same DB-first-then-env-fallback pattern already
 * used by /api/payments and lib/payouts.ts, so every part of the app (guest
 * pages included, which have no admin session) resolves to the same number
 * the admin panel last set.
 */
export async function GET() {
  // What guests are shown, kept for a few seconds (lib/shortCache.ts). A
  // charge never reads it from here: /api/payments reads the database.
  const rate = await cached('exchange-rate', async () => {
    const rateRow = await db.exchangeRate.findFirst({ orderBy: { updatedAt: 'desc' }, select: { usdToGhs: true } })
    return rateRow?.usdToGhs ?? Number(process.env.INITIAL_USD_TO_GHS ?? 15.5)
  })
  return NextResponse.json({ rate })
}

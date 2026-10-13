import { NextResponse } from 'next/server'
import { requireHost } from '@/lib/roles'
import { OutboundTimeoutError, PAYSTACK_NOT_ANSWERING, readWithRetry } from '@/lib/outbound'

/**
 * GET /api/payout-banks — Ghana bank list (excluding mobile money, which
 * the payout form handles via its own network selector), proxied from
 * Paystack so the client has real bank codes to submit — the payout
 * method route can't resolve a bank account without one.
 */
export async function GET() {
  // Hosts only: the list is only needed to save a payout method, and
  // fetching it calls Paystack
  const auth = await requireHost()
  if (auth.error) return auth.error

  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
    return NextResponse.json({ error: 'Paystack is not configured' }, { status: 503 })
  }

  try {
    const res = await readWithRetry('https://api.paystack.co/bank?country=ghana&currency=GHS', {
      headers: { Authorization: `Bearer ${secret}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.status) {
      return NextResponse.json({ error: 'Failed to load bank list' }, { status: 502 })
    }

    const banks = (json.data as Array<{ name: string; code: string; type: string }>)
      .filter((b) => b.type !== 'mobile_money')
      .map((b) => ({ name: b.name, code: b.code }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ banks })
  } catch (error) {
    if (error instanceof OutboundTimeoutError) return NextResponse.json({ error: PAYSTACK_NOT_ANSWERING }, { status: 504 })
    console.error('Payout banks GET error:', error)
    return NextResponse.json({ error: 'Failed to load bank list' }, { status: 500 })
  }
}

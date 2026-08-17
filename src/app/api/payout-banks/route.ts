import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'

/**
 * GET /api/payout-banks — Ghana bank list (excluding mobile money, which
 * the payout form handles via its own network selector), proxied from
 * Paystack so the client has real bank codes to submit — the payout
 * method route can't resolve a bank account without one.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
  }

  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
    return NextResponse.json({ error: 'Paystack is not configured' }, { status: 503 })
  }

  try {
    const res = await fetch('https://api.paystack.co/bank?country=ghana&currency=GHS', {
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
    console.error('Payout banks GET error:', error)
    return NextResponse.json({ error: 'Failed to load bank list' }, { status: 500 })
  }
}

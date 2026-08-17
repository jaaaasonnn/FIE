import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

const MOMO_BANK_CODES: Record<string, string> = { MTN: 'MTN', VODAFONE: 'VOD', AIRTELTIGO: 'ATL' }

const PAYOUT_SELECT = {
  payoutMethod: true,
  payoutMomoNetwork: true,
  payoutMomoNumber: true,
  payoutBankCode: true,
  payoutBankAccountNumber: true,
  payoutBankAccountName: true,
  payoutMethodVerifiedAt: true,
} as const

/**
 * GET /api/users/me/payout-method
 * Auth required. Returns the current host's saved payout destination, if any.
 */
export async function GET() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
  }

  const user = await db.user.findUnique({ where: { id: sessionUser.id }, select: PAYOUT_SELECT })
  return NextResponse.json({ payoutMethod: user })
}

/**
 * POST /api/users/me/payout-method
 * Auth required, and — since redirecting a host's payouts is the single
 * most damaging thing an attacker could do with a hijacked session — the
 * current password must be re-entered. Always operates on the session
 * user; there is no way to set another user's payout method through this
 * route.
 *
 * Flow: resolve the account with Paystack (confirms it's real and gets the
 * registered holder's name) -> register it as a transfer recipient -> only
 * then persist anything. A notification is created either way a change
 * succeeds, so the host has a record even if they didn't expect it.
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'You must be signed in' }, { status: 401 })
    }

    const body = await req.json()
    const { password, payoutMethod, payoutMomoNetwork, payoutMomoNumber, payoutBankCode, payoutBankAccountNumber } = body

    if (!password) {
      return NextResponse.json({ error: 'Please re-enter your password to confirm this change' }, { status: 400 })
    }

    // Re-auth against the real password hash — the session alone (which is
    // all a hijacked cookie would give an attacker) is not enough here.
    const dbUser = await db.user.findUnique({ where: { id: sessionUser.id }, select: { passwordHash: true } })
    if (!dbUser?.passwordHash) {
      return NextResponse.json({ error: 'Password re-authentication is not available for this account' }, { status: 400 })
    }
    const passwordValid = await bcrypt.compare(password, dbUser.passwordHash)
    if (!passwordValid) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
    }

    if (payoutMethod !== 'MOMO' && payoutMethod !== 'BANK_TRANSFER') {
      return NextResponse.json({ error: 'payoutMethod must be MOMO or BANK_TRANSFER' }, { status: 400 })
    }

    let accountNumber: string
    let bankCode: string
    if (payoutMethod === 'MOMO') {
      bankCode = MOMO_BANK_CODES[payoutMomoNetwork]
      if (!bankCode || !payoutMomoNumber) {
        return NextResponse.json({ error: 'Select a mobile money network and enter a valid number' }, { status: 400 })
      }
      accountNumber = payoutMomoNumber
    } else {
      if (!payoutBankCode || !payoutBankAccountNumber) {
        return NextResponse.json({ error: 'Select a bank and enter your account number' }, { status: 400 })
      }
      bankCode = payoutBankCode
      accountNumber = payoutBankAccountNumber
    }

    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret || secret.startsWith('your_') || !secret.startsWith('sk_')) {
      return NextResponse.json({ error: 'Paystack is not configured. Set PAYSTACK_SECRET_KEY in .env.' }, { status: 503 })
    }

    // 1. Resolve — the account must actually exist before we trust it.
    const resolveRes = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    )
    const resolveJson = await resolveRes.json().catch(() => null)
    if (!resolveRes.ok || !resolveJson?.status || !resolveJson.data?.account_name) {
      console.error('[Payout method] Paystack resolve failed:', resolveJson)
      return NextResponse.json(
        { error: resolveJson?.message || 'Could not verify this account. Double-check the details and try again.' },
        { status: 422 },
      )
    }
    const accountName: string = resolveJson.data.account_name

    // 2. Register as a transfer recipient — this is what a future payout
    // actually sends money to; resolving alone doesn't create anything.
    const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: payoutMethod === 'MOMO' ? 'mobile_money' : 'ghipss',
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'GHS',
      }),
    })
    const recipientJson = await recipientRes.json().catch(() => null)
    if (!recipientRes.ok || !recipientJson?.status || !recipientJson.data?.recipient_code) {
      console.error('[Payout method] Paystack recipient creation failed:', recipientJson)
      return NextResponse.json(
        { error: recipientJson?.message || 'Failed to register payout destination with Paystack.' },
        { status: 502 },
      )
    }

    const updated = await db.user.update({
      where: { id: sessionUser.id },
      data: {
        payoutMethod,
        payoutMomoNetwork: payoutMethod === 'MOMO' ? payoutMomoNetwork : null,
        payoutMomoNumber: payoutMethod === 'MOMO' ? payoutMomoNumber : null,
        payoutBankCode: payoutMethod === 'BANK_TRANSFER' ? bankCode : null,
        payoutBankAccountNumber: payoutMethod === 'BANK_TRANSFER' ? accountNumber : null,
        payoutBankAccountName: accountName,
        paystackRecipientCode: recipientJson.data.recipient_code,
        payoutMethodVerifiedAt: new Date(),
      },
      select: PAYOUT_SELECT,
    })

    // Notification is the real (not stubbed) alert mechanism here — email
    // isn't wired up yet. Fires regardless of whether this was the host
    // themselves or someone else, which is the point.
    await db.notification.create({
      data: {
        userId: sessionUser.id,
        type: 'PAYOUT_METHOD_CHANGED',
        title: 'Payout method changed',
        body:
          payoutMethod === 'MOMO'
            ? `Your payout method was changed to ${payoutMomoNetwork} Mobile Money (${accountName}, ending ${accountNumber.slice(-4)}). If this wasn't you, contact support immediately.`
            : `Your payout method was changed to a bank account (${accountName}, ending ${accountNumber.slice(-4)}). If this wasn't you, contact support immediately.`,
      },
    })

    return NextResponse.json({ payoutMethod: updated })
  } catch (error) {
    console.error('Payout method POST error:', error)
    return NextResponse.json({ error: 'Failed to save payout method' }, { status: 500 })
  }
}

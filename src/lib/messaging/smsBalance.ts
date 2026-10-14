// The hourly SMS balance check (cron sms-balance). It reads the Arkesel
// account's SMS credit and raises one Sentry alert, at most once a day, when
// it is below SMS_LOW_BALANCE_ALERT. It sends nothing and writes nothing but
// the record of that alert.
//
// It calls Arkesel only when SMS is really live through Arkesel: exactly
// MESSAGING_ENABLED=true and SMS_PROVIDER=arkesel (the same channelGate the
// sending job uses), and SMS_LOW_BALANCE_ALERT is a whole number above zero.
// Otherwise, and on ?dryRun=1, it reports why and calls nothing.
//
// "Once a day" is kept in the AuthRequest table (kind SMS_BALANCE_ALERTED),
// the same place the rate limits are counted, so it holds across servers.
// The daily cleanup removes those rows after a week.

import * as Sentry from '@sentry/nextjs'
import { channelGate } from '@/lib/messaging/config'
import { arkeselBalance } from '@/lib/messaging/providers/arkesel'
import { claim } from '@/lib/rateLimit'

export const SMS_BALANCE_ALERTED = 'SMS_BALANCE_ALERTED'
const DAY_MS = 24 * 60 * 60 * 1000

export type SmsBalanceRun =
  | { mode: 'off' | 'dry-run'; reason: string; called: false }
  | { mode: 'live'; called: true; ok: false; error: string }
  | { mode: 'live'; called: true; ok: true; smsBalance: number; threshold: number; low: boolean; alerted: boolean }

/** SMS_LOW_BALANCE_ALERT as a whole number of SMS credits above zero, or null. */
export function lowBalanceThreshold(): number | null {
  const raw = process.env.SMS_LOW_BALANCE_ALERT?.trim() ?? ''
  if (!/^\d{1,9}$/.test(raw)) return null
  const value = Number(raw)
  return value > 0 ? value : null
}

export async function runSmsBalance({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<SmsBalanceRun> {
  const gate = channelGate('SMS')
  if (!gate.live) return { mode: 'off', reason: gate.reason, called: false }
  if (gate.provider !== 'arkesel') return { mode: 'off', reason: `SMS_PROVIDER is ${gate.provider}, not arkesel`, called: false }
  const threshold = lowBalanceThreshold()
  if (threshold === null) return { mode: 'off', reason: 'SMS_LOW_BALANCE_ALERT is not set to a whole number above zero', called: false }
  if (dryRun) return { mode: 'dry-run', reason: 'dryRun was requested: Arkesel was not called', called: false }

  const balance = await arkeselBalance()
  if (!balance.ok) {
    // Not an alert of its own: the sending job alerts when SMS actually fail
    console.warn('[SMS balance] could not be read', { error: balance.error })
    return { mode: 'live', called: true, ok: false, error: balance.error }
  }
  const smsBalance = balance.smsBalance ?? 0
  const low = smsBalance < threshold
  let alerted = false
  if (low) {
    // One alert a day: the first run to claim the day's slot alerts, every other run is quiet
    const slot = await claim(SMS_BALANCE_ALERTED, { key: 'arkesel' }, { perKey: { max: 1, windowMs: DAY_MS } }, now)
    if (slot.ok) {
      alerted = true
      console.error('[SMS balance] below the alert level', { smsBalance, threshold })
      try {
        Sentry.captureMessage(`The SMS account is running low: ${smsBalance} SMS credits left (alert level ${threshold}). Top up Arkesel.`, {
          level: 'warning',
          tags: { area: 'messaging', messaging_issue: 'SMS_BALANCE_LOW', channel: 'SMS' },
          fingerprint: ['messaging', 'SMS_BALANCE_LOW'],
          contexts: { balance: { smsBalance, threshold, mainBalance: balance.mainBalance } },
        })
      } catch { /* reporting must not stop the run */ }
    }
  }
  return { mode: 'live', called: true, ok: true, smsBalance, threshold, low, alerted }
}

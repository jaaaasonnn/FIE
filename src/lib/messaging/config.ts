// The messaging switch and the values a message is sent with.
//
// Nothing is sent anywhere until it is switched on, per channel:
//   MESSAGING_ENABLED=true   and
//   EMAIL_PROVIDER=<adapter> for email, SMS_PROVIDER=<adapter> for SMS.
// Both providers default to "log", which sends nothing. While a channel is
// not live, every message is still worked out and recorded in the message
// log with status LOGGED, so you can read exactly what would have gone out.
// A message logged while off is never sent later.
//
// Sender names and addresses are settings too, so they can change without a
// code change. None of this is set in .env yet.
//
// The one real email adapter is "resend" (providers/resend.ts). Its key,
// RESEND_API_KEY, is read by the adapter alone and is not part of this file.

import { PROVIDERS } from '@/lib/messaging/providers'

export type Channel = 'EMAIL' | 'SMS'

/** Exactly "true", like the payout switches: a typo must never switch sending on. */
export function messagingEnabled(): boolean {
  return process.env.MESSAGING_ENABLED === 'true'
}

export type ChannelGate =
  | { live: true; provider: string }
  | { live: false; provider: 'log'; reason: string }

/** Whether a channel may really send right now, through which adapter, and if not, why. */
export function channelGate(channel: Channel): ChannelGate {
  if (!messagingEnabled()) return { live: false, provider: 'log', reason: 'MESSAGING_ENABLED is not set to true' }
  const setting = channel === 'EMAIL' ? 'EMAIL_PROVIDER' : 'SMS_PROVIDER'
  const name = process.env[setting]?.trim() || 'log'
  if (name === 'log') return { live: false, provider: 'log', reason: `${setting} is not set, so messages are only logged` }
  const adapter = PROVIDERS[name]
  // A name with no adapter behind it (a typo, or one not written yet) sends nothing
  if (!adapter || adapter.channel !== channel) return { live: false, provider: 'log', reason: `${setting} names no ${channel === 'EMAIL' ? 'email' : 'SMS'} adapter` }
  return { live: true, provider: name }
}

const setting = (name: string, fallback: string) => process.env[name]?.trim() || fallback

/** The site's address, for links in messages. NEXTAUTH_URL, with a scheme if it has none. */
export function appUrl(): string {
  const raw = setting('NEXTAUTH_URL', 'http://localhost:3000').replace(/\/+$/, '')
  if (/^https?:\/\//i.test(raw)) return raw
  return `${/^(localhost|127\.)/.test(raw) ? 'http' : 'https'}://${raw}`
}

export function messagingConfig() {
  return {
    appUrl: appUrl(),
    /** The whole From line, name and address together */
    emailFrom: setting('EMAIL_FROM', 'FieGH <support@fiegh.com>'),
    supportEmail: setting('SUPPORT_EMAIL', 'support@fiegh.com'),
    smsSenderId: setting('SMS_SENDER_ID', 'FieGH'),
    /** One shared inbox for everything admins are emailed about. Unset: those emails are skipped. */
    adminAlertEmail: process.env.ADMIN_ALERT_EMAIL?.trim().toLowerCase() || null,
  }
}

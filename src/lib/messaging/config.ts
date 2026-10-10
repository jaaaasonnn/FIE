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

import * as Sentry from '@sentry/nextjs'
import { PROVIDERS } from '@/lib/messaging/providers'
import { SUPPORT_EMAIL } from '@/lib/contact'

export type Channel = 'EMAIL' | 'SMS'

/** Exactly "true", like the payout switches: a typo must never switch sending on. */
export function messagingEnabled(): boolean {
  return process.env.MESSAGING_ENABLED === 'true'
}

/**
 * True on the live site: a production build (NODE_ENV) or a Vercel production
 * deployment (VERCEL_ENV). Either is enough. A Vercel preview is a production
 * build too, so test-only adapters cannot be used there either.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

// One alert per channel for as long as the server process lives: the gate is
// read for every message and every minute by the job
const alerted = new Set<string>()

function alertTestAdapter(channel: Channel, setting: string, name: string) {
  if (alerted.has(channel)) return
  alerted.add(channel)
  const message = `${setting} names a test-only adapter in production: nothing is being sent on this channel`
  console.error(`[Messaging] ${message}`, { channel, adapter: name })
  try {
    Sentry.captureMessage(message, {
      level: 'error',
      tags: { area: 'messaging', messaging_issue: 'TEST_ADAPTER_IN_PRODUCTION', channel },
      fingerprint: ['messaging', 'TEST_ADAPTER_IN_PRODUCTION', channel],
      contexts: { message: { channel, setting, adapter: name } },
    })
  } catch { /* reporting must not stop the gate answering */ }
}

/** For tests: forget which channels have already raised the alert. */
export function resetTestAdapterAlerts(): void {
  alerted.clear()
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
  // A test-only adapter is never live in production, whatever the setting says
  if (adapter.testOnly && isProduction()) {
    alertTestAdapter(channel, setting, name)
    return { live: false, provider: 'log', reason: `${setting} names a test-only adapter, which cannot be used in production` }
  }
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
    emailFrom: setting('EMAIL_FROM', `FieGH <${SUPPORT_EMAIL}>`),
    supportEmail: setting('SUPPORT_EMAIL', SUPPORT_EMAIL),
    smsSenderId: setting('SMS_SENDER_ID', 'FieGH'),
    /** One shared inbox for everything admins are emailed about. Unset: each admin user with an email is sent it instead. */
    adminAlertEmail: process.env.ADMIN_ALERT_EMAIL?.trim().toLowerCase() || null,
  }
}

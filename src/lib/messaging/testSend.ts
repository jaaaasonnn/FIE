// One test email through the Resend adapter, for scripts/send-test-email.ts.
// It is run by hand, never by the app, and it writes nothing to the database.
//
// It does not look at MESSAGING_ENABLED or EMAIL_PROVIDER: its job is to prove
// the key, the domain and the sender work before those are switched on. What
// stops it sending by accident is --confirm.

import { normalizeEmail } from '@/lib/utils'
import { messagingConfig } from '@/lib/messaging/config'
import { emailHtml } from '@/lib/messaging/emailHtml'
import { resendEmail } from '@/lib/messaging/providers/resend'

export const TEST_SEND_USAGE = 'Usage: npm run email:test -- you@example.com --confirm'

export type TestSendPlan = { ok: true; to: string } | { ok: false; why: string }

/** What the arguments ask for. Anything short of one valid address, --confirm and a key is refused. */
export function planTestSend(args: string[]): TestSendPlan {
  const flags = args.filter((a) => a.startsWith('-'))
  const rest = args.filter((a) => !a.startsWith('-'))
  const unknown = flags.find((f) => f !== '--confirm')
  if (unknown) return { ok: false, why: `Unknown option ${unknown}.` }
  if (rest.length !== 1) return { ok: false, why: 'Give exactly one email address.' }
  const to = normalizeEmail(rest[0])
  if (!to) return { ok: false, why: 'That is not a valid email address.' }
  if (!flags.includes('--confirm')) return { ok: false, why: `This sends a real email to ${to}. Add --confirm to send it.` }
  if (!process.env.RESEND_API_KEY?.trim()) return { ok: false, why: 'RESEND_API_KEY is not set.' }
  return { ok: true, to }
}

/** Sends the one test email, or says why not. Returns the exit code. Never prints the key. */
export async function runTestSend(args: string[], print: (line: string) => void = console.log, now = new Date()): Promise<number> {
  const plan = planTestSend(args)
  if (!plan.ok) {
    print(`Nothing sent. ${plan.why}`)
    print(TEST_SEND_USAGE)
    return 1
  }
  const config = messagingConfig()
  const subject = 'FieGH test email'
  const text = [
    'This is a test email from FieGH, sent by hand to check that email delivery works.',
    'If you were not expecting it, you can ignore it.',
    `Sent ${now.toISOString()}. Reply to reach ${config.supportEmail}.`,
  ].join('\n\n')
  print(`Sending one test email to ${plan.to} from ${config.emailFrom} (reply-to ${config.supportEmail})`)
  try {
    const result = await resendEmail.send({
      to: plan.to, from: config.emailFrom, replyTo: config.supportEmail, subject, text, html: emailHtml(subject, text),
      // A new key each time, so a second run sends a second email
      idempotencyKey: `test-email:${now.getTime()}`,
      signal: AbortSignal.timeout(8_000),
    })
    if (result.ok) {
      print(`Sent. Resend id: ${result.providerMessageId ?? '(none returned)'}`)
      return 0
    }
    print(`Not sent. ${result.error}`)
    return 1
  } catch (error) {
    print(`Outcome unknown: ${error instanceof Error ? error.message : 'the adapter threw'}. Check the Resend dashboard before trying again.`)
    return 1
  }
}

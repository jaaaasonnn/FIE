// One test SMS through the Arkesel adapter, for scripts/send-test-sms.ts. It
// is run by hand, never by the app, and it writes nothing to the database.
//
// It does not look at MESSAGING_ENABLED or SMS_PROVIDER: its job is to prove
// the key, the sender ID and the account work before those are switched on.
// What stops it sending by accident is --confirm. With --sandbox Arkesel takes
// the request without charging it or passing it to a network, so nothing
// reaches the phone.

import { messagingConfig } from '@/lib/messaging/config'
import { ghanaMsisdn, maskMsisdn } from '@/lib/messaging/ghanaPhone'
import { arkeselKey, senderIdValid, sendArkesel } from '@/lib/messaging/providers/arkesel'

export const TEST_SMS_USAGE = 'Usage: npm run sms:test -- 0XXXXXXXXX --confirm [--sandbox]'

/** The one message the script sends: one plain SMS, no link, nothing personal. */
export const TEST_SMS_TEXT = 'FieGH: This is a test SMS, sent by hand to check that SMS delivery works. If you were not expecting it, you can ignore it.'

export type TestSmsPlan = { ok: true; to: string; sandbox: boolean } | { ok: false; why: string }

/** What the arguments ask for. Anything short of one Ghana mobile number, --confirm, the key and a valid sender ID is refused. */
export function planTestSms(args: string[]): TestSmsPlan {
  const flags = args.filter((a) => a.startsWith('-') && !/^\+?\d/.test(a))
  const rest = args.filter((a) => !flags.includes(a))
  const unknown = flags.find((f) => f !== '--confirm' && f !== '--sandbox')
  if (unknown) return { ok: false, why: `Unknown option ${unknown}.` }
  if (rest.length !== 1) return { ok: false, why: 'Give exactly one Ghana mobile number.' }
  const to = ghanaMsisdn(rest[0])
  if (!to) return { ok: false, why: 'That is not a valid Ghana mobile number (0XXXXXXXXX, +233XXXXXXXXX or 233XXXXXXXXX).' }
  const sandbox = flags.includes('--sandbox')
  if (!flags.includes('--confirm')) {
    return { ok: false, why: `This sends a ${sandbox ? 'sandbox' : 'real'} SMS to ${maskMsisdn(to)}${sandbox ? '' : ', which is charged'}. Add --confirm to send it.` }
  }
  if (!arkeselKey()) return { ok: false, why: 'ARKESEL_API_KEY is not set.' }
  if (!senderIdValid(messagingConfig().smsSenderId)) return { ok: false, why: 'SMS_SENDER_ID must be 1 to 11 letters, digits or spaces.' }
  return { ok: true, to, sandbox }
}

/** Sends the one test SMS, or says why not. Returns the exit code. Never prints the key or the whole number. */
export async function runTestSms(args: string[], print: (line: string) => void = console.log): Promise<number> {
  const plan = planTestSms(args)
  if (!plan.ok) {
    print(`Nothing sent. ${plan.why}`)
    print(TEST_SMS_USAGE)
    return 1
  }
  const from = messagingConfig().smsSenderId
  print(`Sending one ${plan.sandbox ? 'sandbox (not delivered, not charged)' : 'real'} test SMS to ${maskMsisdn(plan.to)} from ${from}`)
  try {
    const result = await sendArkesel({
      to: plan.to, from, text: TEST_SMS_TEXT,
      // Nothing in the log to match against: a test send asks for no delivery report
      idempotencyKey: `test-sms:${Date.now()}`,
      signal: AbortSignal.timeout(8_000),
    }, { sandbox: plan.sandbox })
    if (result.ok) {
      print(`Sent. Arkesel id: ${result.providerMessageId ?? '(none returned)'}`)
      return 0
    }
    print(`Not sent. ${result.error}${result.issue === 'LOW_BALANCE' ? ' Top up the Arkesel account.' : ''}`)
    return 1
  } catch (error) {
    print(`Outcome unknown: ${error instanceof Error ? error.message : 'the adapter threw'}. Check the SMS history in the Arkesel dashboard before trying again.`)
    return 1
  }
}

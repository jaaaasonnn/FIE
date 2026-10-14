// The Arkesel adapter: real SMS, through Arkesel's v2 API
// (https://developers.arkesel.com). It is used only when MESSAGING_ENABLED=true
// and SMS_PROVIDER=arkesel (lib/messaging/config.ts).
//
// The API key is read from ARKESEL_API_KEY at the moment of sending and goes
// into one request header, nowhere else: it is never logged, never returned
// and never part of an error. The phone number is never put in an error
// either. Nothing here writes to the console.
//
// Arkesel takes no idempotency key or client reference. What stops a message
// going twice is the sending job: it claims a row before calling, and anything
// unsure is recorded as UNKNOWN and never tried again. So only answers that
// show the message was NOT taken are retried here.
//
// What each answer becomes (the sending job decides the rest):
//  - 200 with an id for the number: sent, with that id;
//  - 200 that lists the number as invalid: refused for good (BAD_NUMBER);
//  - 200 that cannot be read, or has no id: thrown (it may have gone);
//  - 429, 502, 503, 504: refused for now, tried again later;
//  - 402 (balance): refused for now, tried again later, with its own alert (LOW_BALANCE);
//  - 401 (key) and 403 (inactive gateway): refused for good, with an alert;
//  - 422 (a field refused, such as the sender ID): refused for good;
//  - 500 or any other 5xx, no answer, or the network failing: thrown, which is
//    recorded as UNKNOWN and never retried.

import type { OutgoingMessage, SendIssue, SendResult, MessageProvider } from './types'
import { ghanaMsisdn } from '@/lib/messaging/ghanaPhone'
import { gsmLength, scrub, SMS_MAX } from '@/lib/messaging/format'
import { MESSAGE_TIMEOUT_MS, OutboundTimeoutError, readWithRetry, sendOnce } from '@/lib/outbound'

export const ARKESEL_SEND_URL = 'https://sms.arkesel.com/api/v2/sms/send'
export const ARKESEL_BALANCE_URL = 'https://sms.arkesel.com/api/v2/clients/balance-details'

/** Arkesel's limit: at most 11 characters, spaces included. Letters, digits and spaces here. */
export function senderIdValid(sender: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ]{0,10}$/.test(sender) && /[A-Za-z]/.test(sender)
}

/** The key, read now. Never stored anywhere else. */
export function arkeselKey(): string {
  return process.env.ARKESEL_API_KEY?.trim() || ''
}

/** Arkesel's own words about a refusal: short, with the key and anything like a number or an address taken out. */
export function arkeselDetail(body: unknown, key: string): string {
  const message = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).message : null
  const text = typeof message === 'string' ? message : ''
  return scrub((key ? text.split(key).join('[key]') : text).replace(/\s+/g, ' ')).slice(0, 160)
}

const refused = (retryable: boolean, error: string, issue?: SendIssue): SendResult => ({ ok: false, retryable, error, ...(issue ? { issue } : {}) })

/** Retried later: the message was certainly not taken. */
const RETRY_STATUSES = new Set([429, 502, 503, 504])

/**
 * Sends one SMS. `sandbox` is for the test script alone: Arkesel takes the
 * request, does not charge it and does not pass it to a network.
 */
export async function sendArkesel(message: OutgoingMessage, { sandbox = false }: { sandbox?: boolean } = {}): Promise<SendResult> {
  const key = arkeselKey()
  // No key: nothing is called, and the message waits for one
  if (!key) return refused(true, 'ARKESEL_API_KEY is not set')

  // Checked here as well as when the message was written, so nothing that would be refused or charged twice is sent
  const to = ghanaMsisdn(message.to)
  if (!to) return refused(false, 'Not a valid Ghana mobile number', 'BAD_NUMBER')
  if (!senderIdValid(message.from)) return refused(false, 'The SMS sender ID must be 1 to 11 letters, digits or spaces (SMS_SENDER_ID)', 'SENDER_ID')
  const length = gsmLength(message.text)
  if (length === null || length > SMS_MAX || length === 0) return refused(false, 'The message is not one plain 160-character SMS', 'CONTENT')

  let response: Response
  try {
    response = await sendOnce(ARKESEL_SEND_URL, {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: message.from,
        message: message.text,
        recipients: [to],
        ...(message.reportUrl ? { callback_url: message.reportUrl } : {}),
        ...(sandbox ? { sandbox: true } : {}),
      }),
    }, MESSAGE_TIMEOUT_MS, message.signal)
  } catch (error) {
    // It may have gone. The error itself is dropped: only these fixed words are kept
    throw new Error(error instanceof OutboundTimeoutError || message.signal.aborted ? 'Arkesel did not answer in time' : 'Arkesel could not be reached')
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (response.status === 200) {
    const data = body !== null && typeof body === 'object' ? (body as { data?: unknown }).data : null
    const entries = Array.isArray(data) ? data.filter((d): d is Record<string, unknown> => d !== null && typeof d === 'object') : []
    const sent = entries.find((d) => typeof d.id === 'string' && d.id.length > 0 && d.id.length <= 100)
    if (sent) return { ok: true, providerMessageId: sent.id as string }
    const invalid = entries.flatMap((d) => (Array.isArray(d['invalid numbers']) ? d['invalid numbers'] : []))
    if (invalid.length > 0) return refused(false, 'Arkesel refused the number as invalid', 'BAD_NUMBER')
    throw new Error('Arkesel answered 200 without an id for the message')
  }

  const why = arkeselDetail(body, key)
  const error = `Arkesel refused the message (HTTP ${response.status}${why ? `, ${why}` : ''})`
  if (RETRY_STATUSES.has(response.status)) return refused(true, error)
  if (response.status === 402) return refused(true, error, 'LOW_BALANCE')
  if (response.status === 401) return refused(false, error, 'AUTH')
  if (response.status === 403) return refused(false, error, 'ACCOUNT')
  if (response.status === 422) return refused(false, error, /sender/i.test(why) ? 'SENDER_ID' : /phone|number|recipient/i.test(why) ? 'BAD_NUMBER' : 'CONTENT')
  // A 500 (or any other 5xx) may have come after the message was taken: unsure, never retried
  if (response.status >= 500) throw new Error(error)
  return refused(false, error)
}

export const arkeselSms: MessageProvider = {
  name: 'arkesel',
  channel: 'SMS',
  send: (message) => sendArkesel(message),
}

export type ArkeselBalance = { ok: true; smsBalance: number | null; mainBalance: string | null } | { ok: false; error: string }

/** Reads the balance: a read, so tried again inside the usual read limit. Used by the hourly check only. */
export async function arkeselBalance(): Promise<ArkeselBalance> {
  const key = arkeselKey()
  if (!key) return { ok: false, error: 'ARKESEL_API_KEY is not set' }
  let response: Response
  try {
    response = await readWithRetry(ARKESEL_BALANCE_URL, { method: 'GET', headers: { 'api-key': key, Accept: 'application/json' } })
  } catch (error) {
    return { ok: false, error: error instanceof OutboundTimeoutError ? 'Arkesel did not answer in time' : 'Arkesel could not be reached' }
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const why = arkeselDetail(body, key)
    return { ok: false, error: `Arkesel refused the balance check (HTTP ${response.status}${why ? `, ${why}` : ''})` }
  }
  const data = body !== null && typeof body === 'object' ? (body as { data?: Record<string, unknown> }).data : null
  const raw = data?.sms_balance
  const sms = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : null
  const main = typeof data?.main_balance === 'string' ? data.main_balance.slice(0, 40) : null
  if (sms === null) return { ok: false, error: 'Arkesel answered without an SMS balance' }
  return { ok: true, smsBalance: sms, mainBalance: main }
}

// The Resend adapter: real email, through Resend's HTTP API. It is used only
// when MESSAGING_ENABLED=true and EMAIL_PROVIDER=resend (lib/messaging/config.ts).
//
// The API key is read from RESEND_API_KEY at the moment of sending and goes
// into one request header, nowhere else: it is never logged, never returned
// and never part of an error. Nothing here writes to the console.
//
// What each answer becomes (the sending job decides the rest):
//  - 2xx: sent, with Resend's id for the message;
//  - 429 or 5xx: refused for now, tried again later. The row's dedupe key is
//    passed as Resend's Idempotency-Key, so a retry cannot send twice;
//  - any other refusal (a bad key, an unverified domain, a bad address):
//    refused for good, not retried;
//  - no answer, the network failing, or a 409 (Resend is already handling
//    this key): thrown, which is recorded as UNKNOWN and never retried.

import type { MessageProvider } from './types'

export const RESEND_URL = 'https://api.resend.com/emails'

/** Resend's own words about a refusal, short, and with the key taken out wherever it came from. */
function detail(body: unknown, key: string): string {
  const field = (name: string) => {
    const value = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)[name] : null
    return typeof value === 'string' ? value : ''
  }
  const text = [field('name'), field('message')].filter(Boolean).join(': ')
  return text.split(key).join('[key]').replace(/\s+/g, ' ').slice(0, 160)
}

export const resendEmail: MessageProvider = {
  name: 'resend',
  channel: 'EMAIL',
  async send(message) {
    const key = process.env.RESEND_API_KEY?.trim() || ''
    // No key: nothing is called, and the message waits for one
    if (!key) return { ok: false, retryable: true, error: 'RESEND_API_KEY is not set' }

    let response: Response
    try {
      response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject ?? 'FieGH',
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
        signal: message.signal,
      })
    } catch {
      // It may have gone. The error itself is dropped: only these fixed words are kept
      throw new Error(message.signal.aborted ? 'Resend did not answer in time' : 'Resend could not be reached')
    }

    const body: unknown = await response.json().catch(() => null)
    if (response.ok) {
      const id = body !== null && typeof body === 'object' ? (body as { id?: unknown }).id : null
      return { ok: true, ...(typeof id === 'string' ? { providerMessageId: id } : {}) }
    }

    const why = detail(body, key)
    const error = `Resend refused the message (HTTP ${response.status}${why ? `, ${why}` : ''})`
    // Another request with this key is in progress or has gone before
    if (response.status === 409) throw new Error(error)
    return { ok: false, retryable: response.status === 429 || response.status >= 500, error }
  },
}

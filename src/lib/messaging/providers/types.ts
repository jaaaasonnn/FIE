// What every provider adapter looks like. Adding Arkesel, Resend or Postmark
// later is one file that implements this, plus one line in ./index.ts.

export type OutgoingMessage = {
  /** The real address: an email address, or a phone number as +233XXXXXXXXX */
  to: string
  /** The sender: "FieGH <bookings@fiegh.com>" for email, the sender name for SMS */
  from: string
  replyTo?: string
  subject?: string
  text: string
  html?: string
  /** The message log row's dedupe key. Pass it on where the provider supports idempotency. */
  idempotencyKey: string
  /** Aborts after the sender's time limit. Pass it to fetch. */
  signal: AbortSignal
}

export type SendResult =
  | { ok: true; providerMessageId?: string }
  /**
   * `retryable` must be true only when the provider definitely did not take
   * the message (refused, rate-limited, down before accepting it). If it may
   * have gone, throw instead: a throw is recorded as UNKNOWN and never retried,
   * so nothing can be sent twice.
   */
  | { ok: false; retryable: boolean; error: string }

export interface MessageProvider {
  name: string
  channel: 'EMAIL' | 'SMS'
  send(message: OutgoingMessage): Promise<SendResult>
}

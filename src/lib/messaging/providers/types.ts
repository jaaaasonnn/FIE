// What every provider adapter looks like. Resend (./resend.ts) is the real
// email adapter and Arkesel (./arkesel.ts) the real SMS one. Adding another
// (Africa's Talking, Postmark) is one file that implements this, plus one line
// in ./index.ts.

export type OutgoingMessage = {
  /** The real address: an email address, or a phone number as +233XXXXXXXXX */
  to: string
  /** The sender: "FieGH <support@fiegh.com>" for email, the sender name for SMS */
  from: string
  replyTo?: string
  subject?: string
  text: string
  html?: string
  /** The message log row's dedupe key. Pass it on where the provider supports idempotency. */
  idempotencyKey: string
  /**
   * Where the provider may report delivery of this one message (SMS only).
   * Built by the sending job, signed for this message log row alone; absent
   * when no webhook secret is set, and for a test send.
   */
  reportUrl?: string
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
  | { ok: false; retryable: boolean; error: string; issue?: SendIssue }

/**
 * What kind of refusal it was, where the adapter can tell. The sending job
 * raises its own alert for a low balance (once a run), on top of the usual ones.
 */
export type SendIssue = 'LOW_BALANCE' | 'AUTH' | 'ACCOUNT' | 'SENDER_ID' | 'BAD_NUMBER' | 'CONTENT'

export interface MessageProvider {
  name: string
  channel: 'EMAIL' | 'SMS'
  /**
   * True for an adapter that exists only for testing or rehearsal. It can
   * never be selected in production: naming one there is treated as the
   * channel being off, with an alert (lib/messaging/config.ts).
   */
  testOnly?: boolean
  send(message: OutgoingMessage): Promise<SendResult>
}

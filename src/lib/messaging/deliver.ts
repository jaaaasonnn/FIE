// Sending what notify() queued. This is the only place a provider adapter is
// ever called, and it is run by the send-messages job, never by a booking,
// a payment, a refund or a payout.
//
// Nothing is sent unless the channel is switched on (lib/messaging/config.ts).
// The check is made here, at the moment of sending, as well as when the row
// was written: a message queued while on and reached after being switched
// off is closed as LOGGED, not sent.
//
// At most once, never twice:
//  - a row is claimed (QUEUED or FAILED to SENDING) before the adapter is
//    called, and only the run whose claim matches goes on;
//  - a refusal the adapter is sure about is retried, on a schedule;
//  - anything unsure (the adapter threw, the call timed out, or a run died
//    after claiming) is closed as UNKNOWN and never retried, because the
//    message may have gone.

import * as Sentry from '@sentry/nextjs'
import type { MessageLog } from '@prisma/client'
import { db } from '@/lib/db'
import { normalizeEmail, validateGhanaPhone } from '@/lib/utils'
import { channelGate, messagingConfig, type Channel } from '@/lib/messaging/config'
import { emailHtml } from '@/lib/messaging/emailHtml'
import { scrub } from '@/lib/messaging/format'
import { PROVIDERS, type SendResult } from '@/lib/messaging/providers'

const MIN = 60 * 1000
/** Waits before the second, third and fourth attempts. After the fourth it gives up. */
export const RETRY_DELAYS_MS = [5 * MIN, 30 * MIN, 120 * MIN]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
/** How long one call to a provider may take. */
export const SEND_TIMEOUT_MS = 8_000
/** A row claimed this long ago with no result recorded is a run that died. */
export const STALE_SENDING_MS = 10 * MIN
/** Too old to be worth sending: "you have a new request" a day late does harm. */
export const MAX_MESSAGE_AGE_MS = 24 * 60 * MIN
/** Messages handled in one run, so a backlog cannot outlast the job's time limit. */
export const BATCH_SIZE = 50

export type MessageAction = 'sent' | 'will-retry' | 'gave-up' | 'unknown' | 'skipped' | 'closed' | 'would-send'
export type MessageRunItem = { id: string; event: string; channel: string; action: MessageAction; attempts: number }
export type MessageRun = {
  mode: 'live' | 'dry-run'
  reason?: string
  email: { live: boolean; provider: string }
  sms: { live: boolean; provider: string }
  checked: number
  results: MessageRunItem[]
  /** Rows a dead run left in SENDING, closed as UNKNOWN this run */
  stale: number
}

function alert(issue: 'GAVE_UP' | 'UNKNOWN', message: string, row: Pick<MessageLog, 'id' | 'event' | 'channel' | 'bookingId' | 'userId' | 'attempts' | 'provider'>, error?: string) {
  console.error(`[Messaging] ${message}`, { messageId: row.id, event: row.event, channel: row.channel })
  Sentry.captureMessage(message, {
    level: issue === 'GAVE_UP' ? 'error' : 'warning',
    tags: { area: 'messaging', messaging_issue: issue, channel: row.channel },
    fingerprint: ['messaging', issue, row.id],
    // IDs only: never an address, a number or the message itself
    contexts: { message: { messageId: row.id, event: row.event, channel: row.channel, bookingId: row.bookingId, userId: row.userId, attempts: row.attempts, provider: row.provider, error } },
  })
}

/** Where a message goes, read at the moment of sending. Null when there is nowhere valid. */
async function addressFor(row: MessageLog): Promise<string | null> {
  if (!row.userId) return row.recipientRole === 'ADMIN' && row.channel === 'EMAIL' ? messagingConfig().adminAlertEmail : null
  const user = await db.user.findUnique({ where: { id: row.userId }, select: { email: true, phone: true } })
  if (row.channel === 'EMAIL') return normalizeEmail(user?.email)
  return user?.phone && validateGhanaPhone(user.phone) ? user.phone : null
}

export async function runMessages({ dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}): Promise<MessageRun> {
  const gates = { EMAIL: channelGate('EMAIL'), SMS: channelGate('SMS') }
  const summary = {
    email: { live: gates.EMAIL.live, provider: gates.EMAIL.provider },
    sms: { live: gates.SMS.live, provider: gates.SMS.provider },
  }

  const due = await db.messageLog.findMany({
    where: {
      status: { in: ['QUEUED', 'FAILED'] },
      channel: { in: ['EMAIL', 'SMS'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  })
  const item = (row: MessageLog, action: MessageAction, attempts = row.attempts): MessageRunItem =>
    ({ id: row.id, event: row.event, channel: row.channel, action, attempts })

  if (dryRun) {
    return { mode: 'dry-run', reason: 'dryRun was requested', ...summary, checked: due.length, results: due.map((row) => item(row, 'would-send')), stale: 0 }
  }

  // A run that died after claiming: the message may or may not have gone
  const dead = await db.messageLog.findMany({ where: { status: 'SENDING', claimedAt: { lte: new Date(now.getTime() - STALE_SENDING_MS) } } })
  let stale = 0
  for (const row of dead) {
    const closed = await db.messageLog.updateMany({
      where: { id: row.id, status: 'SENDING', claimedAt: row.claimedAt },
      data: { status: 'UNKNOWN', error: 'The run that was sending this stopped before recording a result. It is not sent again in case it went.', alertedAt: now },
    })
    if (closed.count === 0) continue
    stale++
    alert('UNKNOWN', 'A message may or may not have been sent: the run stopped before recording a result', row)
  }

  const config = messagingConfig()
  const results: MessageRunItem[] = []
  for (const row of due) {
    const channel = row.channel as Channel
    const gate = gates[channel]
    const close = (status: string, error: string) => db.messageLog.updateMany({ where: { id: row.id, status: row.status, attempts: row.attempts }, data: { status, error, nextAttemptAt: null } })

    // Switched off since it was queued: it is never sent later
    if (!gate.live) {
      await close('LOGGED', `Not sent: ${gate.reason}`)
      results.push(item(row, 'closed'))
      continue
    }
    if (now.getTime() - row.createdAt.getTime() > MAX_MESSAGE_AGE_MS) {
      const closed = await close('GAVE_UP', 'Too old to send: more than 24 hours since it was written')
      if (closed.count) alert('GAVE_UP', 'A message was not sent within 24 hours and has been dropped', row)
      results.push(item(row, 'gave-up'))
      continue
    }

    // Claim before any call to the provider
    const claim = await db.messageLog.updateMany({
      where: { id: row.id, status: row.status, attempts: row.attempts },
      data: { status: 'SENDING', claimedAt: now, attempts: { increment: 1 }, provider: gate.provider },
    })
    if (claim.count === 0) continue
    const attempts = row.attempts + 1
    const settle = (data: Record<string, unknown>) => db.messageLog.update({ where: { id: row.id }, data })

    let outcome: SendResult | 'unsure'
    let unsureWhy = ''
    try {
      const to = await addressFor(row)
      if (!to) {
        await settle({ status: 'SKIPPED', error: channel === 'EMAIL' ? 'no valid email address when it came to be sent' : 'no valid phone number when it came to be sent' })
        results.push(item(row, 'skipped', attempts))
        continue
      }
      const signal = AbortSignal.timeout(SEND_TIMEOUT_MS)
      outcome = await Promise.race([
        PROVIDERS[gate.provider].send({
          to,
          from: channel === 'EMAIL' ? `${config.emailFromName} <${config.emailFromAddress}>` : config.smsSenderId,
          ...(channel === 'EMAIL' ? { replyTo: config.supportEmail, subject: row.subject ?? 'FieGH', html: emailHtml(row.subject ?? 'FieGH', row.body) } : {}),
          text: row.body,
          idempotencyKey: row.dedupeKey,
          signal,
        }),
        new Promise<'unsure'>((resolve) => signal.addEventListener('abort', () => { unsureWhy = `no answer within ${SEND_TIMEOUT_MS / 1000} seconds`; resolve('unsure') })),
      ])
    } catch (error) {
      outcome = 'unsure'
      unsureWhy = error instanceof Error ? error.message : 'the adapter threw'
    }

    if (outcome === 'unsure') {
      const error = scrub(`Outcome unknown (${unsureWhy}). It is not sent again in case it went.`)
      await settle({ status: 'UNKNOWN', error, alertedAt: now })
      alert('UNKNOWN', 'A message may or may not have been sent: the provider gave no clear answer', { ...row, attempts }, error)
      results.push(item(row, 'unknown', attempts))
    } else if (outcome.ok) {
      await settle({ status: 'SENT', sentAt: now, error: null, providerMessageId: outcome.providerMessageId ?? null })
      results.push(item(row, 'sent', attempts))
    } else if (outcome.retryable && attempts < MAX_ATTEMPTS) {
      await settle({ status: 'FAILED', error: scrub(outcome.error), nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]) })
      results.push(item(row, 'will-retry', attempts))
    } else {
      const error = scrub(outcome.error)
      await settle({ status: 'GAVE_UP', error, nextAttemptAt: null, alertedAt: now })
      alert('GAVE_UP', outcome.retryable ? `A message could not be sent after ${attempts} attempts` : 'A message was refused by the provider and will not be retried', { ...row, attempts }, error)
      results.push(item(row, 'gave-up', attempts))
    }
  }

  return { mode: 'live', ...summary, checked: due.length, results, stale }
}

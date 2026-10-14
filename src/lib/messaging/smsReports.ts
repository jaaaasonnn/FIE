// SMS delivery reports from Arkesel: the link each message carries, how a
// report is checked, and what it changes in the message log.
//
// Arkesel does not sign its reports: it calls the callback_url given with the
// message, adding sms_id and status as query parameters. So the link itself is
// the proof. Each message gets its own link,
//
//   /api/webhooks/sms/arkesel/<message log id>/<signature>
//
// where the signature is an HMAC of that one row's id with SMS_WEBHOOK_SECRET.
// A link that leaks can touch only its own row, and only with the provider's
// id for that message (sms_id must match providerMessageId). Without the
// secret (unset, or shorter than 32 characters) no link is sent and every
// report is refused.
//
// A report changes a row only from SENT: to DELIVERED or UNDELIVERED, once.
// Never to FAILED, which would make the sending job send it again. A report
// that says the message is still on its way is noted (deliveryStatus) and
// changes nothing else. The same report twice, or one arriving after the
// final one, changes nothing.

import crypto from 'crypto'
import { db } from '@/lib/db'

export const SMS_REPORT_PATH = '/api/webhooks/sms/arkesel'
export const MIN_SECRET_LENGTH = 32

/** Arkesel's final words, and what they become. Anything else is "still on its way". */
export const FINAL_REPORTS: Record<string, 'DELIVERED' | 'UNDELIVERED'> = {
  DELIVERED: 'DELIVERED',
  NOT_DELIVERED: 'UNDELIVERED',
  UNDELIVERED: 'UNDELIVERED',
  EXPIRED: 'UNDELIVERED',
  PROHIBITED: 'UNDELIVERED',
  REJECTED: 'UNDELIVERED',
  FAILED: 'UNDELIVERED',
}

function webhookSecret(): string | null {
  const secret = process.env.SMS_WEBHOOK_SECRET?.trim()
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null
}

export function reportSignature(logId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`sms-report:${logId}`).digest('hex')
}

/** The link for one message's delivery report, or null when no secret is set. */
export function deliveryReportUrl(appUrl: string, logId: string): string | null {
  const secret = webhookSecret()
  if (!secret) return null
  return `${appUrl}${SMS_REPORT_PATH}/${encodeURIComponent(logId)}/${reportSignature(logId, secret)}`
}

/** Constant time, and false for anything but a well-formed signature when a secret is set. */
export function reportSignatureValid(logId: string, signature: string): boolean {
  const secret = webhookSecret()
  if (!secret || !/^[0-9a-f]{64}$/.test(signature)) return false
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(reportSignature(logId, secret), 'hex'))
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export type ReportResult =
  | 'recorded'       // DELIVERED or UNDELIVERED, written now
  | 'in-progress'    // a word that is not final, noted
  | 'already-final'  // the row had its final report already: nothing changed
  | 'not-sent'       // the row is not SENT (it never went, or its outcome is unknown)
  | 'mismatch'       // the provider's id does not match the row's
  | 'not-found'      // no such SMS row from Arkesel
  | 'unreadable'     // no status, or one that is not a plain word

/** Applies one report. Never throws on bad input; the caller has already checked the signature. */
export async function recordDeliveryReport(
  { logId, smsId, status }: { logId: string; smsId: string | null; status: string | null },
  now: Date = new Date(),
): Promise<ReportResult> {
  const word = (status ?? '').trim().toUpperCase()
  if (!/^[A-Z_]{1,40}$/.test(word)) return 'unreadable'
  const row = await db.messageLog.findUnique({ where: { id: logId }, select: { id: true, channel: true, provider: true, status: true, providerMessageId: true } })
  if (!row || row.channel !== 'SMS' || row.provider !== 'arkesel') return 'not-found'
  if (!row.providerMessageId || !smsId || !sameText(row.providerMessageId, smsId.trim())) return 'mismatch'
  if (row.status === 'DELIVERED' || row.status === 'UNDELIVERED') return 'already-final'
  if (row.status !== 'SENT') return 'not-sent'

  const final = FINAL_REPORTS[word]
  // Only from SENT, so two reports at once, or a late "still on its way", cannot undo a final one
  const changed = await db.messageLog.updateMany({
    where: { id: row.id, status: 'SENT' },
    data: { ...(final ? { status: final } : {}), deliveryStatus: word, deliveryUpdatedAt: now },
  })
  if (changed.count === 0) return 'already-final'
  return final ? 'recorded' : 'in-progress'
}

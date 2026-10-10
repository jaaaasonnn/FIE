// The one function the rest of the app calls to tell someone something:
//
//     notify('booking.confirmed', { bookingId })
//
// It only ever writes rows to the message log (and an in-app notice where the
// event has one). It never calls a provider: sending is the send-messages
// job's work (lib/messaging/deliver.ts), a minute or less later.
//
// What makes it safe to call from a booking, a payment, a refund or a payout:
//  - it runs after the response has gone out, so it cannot slow the action;
//  - it never throws, whatever happens inside it;
//  - it is called after the action has been committed, never inside its
//    transaction, so it cannot undo one;
//  - every row has a unique dedupe key, so raising the same event twice (a job
//    that runs twice, a webhook delivered twice) writes nothing the second time.

import * as Sentry from '@sentry/nextjs'
import { after } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { normalizeEmail, validateGhanaPhone } from '@/lib/utils'
import { channelGate, messagingConfig, type Channel } from '@/lib/messaging/config'
import { maskEmail, maskPhone } from '@/lib/messaging/format'
import { LOADERS, type EventIds } from '@/lib/messaging/events'
import { TEMPLATES, emailFooter, emailText, type EventName, type Template } from '@/lib/messaging/templates'
import { seal } from '@/lib/sealed'

export type WriteResult = {
  /** Rows written this time; a repeat of the same event writes none */
  written: number
  /** True when something went wrong. It has been reported; the caller need do nothing */
  failed: boolean
}

type Row = {
  event: string
  channel: Channel | 'IN_APP'
  userId: string | null
  recipientRole: string
  recipientMasked: string | null
  bookingId: string | null
  dedupeKey: string
  subject: string | null
  body: string
  status: string
  provider: string | null
  error: string | null
  sentAt?: Date
  sealed?: string | null
}

/**
 * Tells the people an event concerns. Returns at once; the work happens after
 * the response has been sent. Never throws.
 */
export function notify<E extends EventName>(event: E, ids: EventIds[E]): void {
  const run = () => writeMessages(event, ids).then(() => {})
  try {
    after(run)
  } catch {
    // Not inside a request (a script, a test): there is no response to wait for
    void run()
  }
}

/**
 * Works out the messages for an event and records them. Never throws: a
 * failure is logged, reported to Sentry with IDs only, and swallowed.
 */
export async function writeMessages<E extends EventName>(event: E, ids: EventIds[E]): Promise<WriteResult> {
  try {
    const loaded = await LOADERS[event](ids)
    if (!loaded) return { written: 0, failed: false }

    const config = messagingConfig()
    const template: Template = TEMPLATES[event]
    const facts = { ...loaded.facts, appUrl: config.appUrl, supportEmail: config.supportEmail }
    const pieces = template.render(facts)
    const optional = template.optional === true

    const userIds = [...new Set(Object.values(loaded.recipients).filter((id): id is string => !!id))]
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, phone: true, role: true, optionalEmails: true } })
      : []
    // Admins are needed for an in-app notice, and for an email when there is
    // no shared inbox to send it to
    const admins = pieces.some((p) => p.to === 'admin' && (p.inApp || (p.email && !config.adminAlertEmail)))
      ? await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true, email: true } })
      : []

    const base = { event, bookingId: loaded.bookingId ?? null }
    const key = (who: string, channel: string) => `${event}:${loaded.key}:${who}:${channel}`
    /** A row that will be sent, or only logged while the channel is off */
    const outgoing = (channel: Channel) => {
      const gate = channelGate(channel)
      return { status: gate.live ? 'QUEUED' : 'LOGGED', provider: gate.provider, error: null }
    }
    const skipped = (why: string) => ({ status: 'SKIPPED', provider: null, error: why })
    /**
     * An email that carries a secret link, or goes to an address other than
     * the account's: the token and address are stored encrypted, and only
     * when the message will really be sent. Logged-only rows hold nothing.
     */
    const secret = loaded.secret
    const sealedEmail = () => {
      const gate = outgoing('EMAIL')
      if (!secret || gate.status !== 'QUEUED') return gate
      const sealed = seal(secret)
      return sealed ? { ...gate, sealed } : skipped('NEXTAUTH_SECRET is not set, so the link cannot be stored safely')
    }
    const footer = emailFooter(facts, optional)

    const rows: Row[] = []
    for (const piece of pieces) {
      if (piece.to === 'admin') {
        if (piece.email) {
          const inbox = config.adminAlertEmail
          const email = { subject: piece.email.subject, body: emailText(piece.email, config.appUrl, footer) }
          const reachable = admins.filter((admin) => normalizeEmail(admin.email))
          if (inbox || reachable.length === 0) {
            // The shared inbox; or, with no inbox and no admin who has an
            // email, one row that says why nothing went
            rows.push({
              ...base, ...email, channel: 'EMAIL', userId: null, recipientRole: 'ADMIN',
              recipientMasked: inbox ? maskEmail(inbox) : null, dedupeKey: key('admin', 'EMAIL'),
              ...(inbox ? outgoing('EMAIL') : skipped('ADMIN_ALERT_EMAIL is not set and no admin has an email address')),
            })
          } else {
            // No shared inbox: each admin is sent it at their own address
            for (const admin of reachable) {
              rows.push({
                ...base, ...email, channel: 'EMAIL', userId: admin.id, recipientRole: 'ADMIN',
                recipientMasked: maskEmail(admin.email!), dedupeKey: key(admin.id, 'EMAIL'),
                ...outgoing('EMAIL'),
              })
            }
          }
        }
        if (piece.inApp) {
          for (const admin of admins) rows.push(inAppRow(base, admin.id, 'ADMIN', key(admin.id, 'IN_APP'), piece.inApp))
        }
        continue
      }

      const user = users.find((u) => u.id === loaded.recipients[piece.to as 'guest' | 'host' | 'user'])
      if (!user) continue
      const role = piece.to === 'user' ? user.role : piece.to.toUpperCase()
      const to = { ...base, userId: user.id, recipientRole: role }

      if (piece.email) {
        // Where it goes: the address the event names, or the one on the account
        const address = secret?.to ?? user.email
        rows.push({
          ...to, channel: 'EMAIL', recipientMasked: address ? maskEmail(address) : null, dedupeKey: key(user.id, 'EMAIL'),
          subject: piece.email.subject, body: emailText(piece.email, config.appUrl, footer),
          ...(!address ? skipped('no email address')
            // Only the optional events can be turned off; the rest are always sent
            : optional && !user.optionalEmails ? skipped('optional emails are turned off')
            : sealedEmail()),
        })
      }
      if (piece.sms) {
        rows.push({
          ...to, channel: 'SMS', recipientMasked: user.phone ? maskPhone(user.phone) : null, dedupeKey: key(user.id, 'SMS'),
          subject: null, body: piece.sms,
          ...(!user.phone ? skipped('no phone number')
            : !validateGhanaPhone(user.phone) ? skipped('the stored phone number is not a valid Ghana number')
            : outgoing('SMS')),
        })
      }
      if (piece.inApp) rows.push(inAppRow(base, user.id, role, key(user.id, 'IN_APP'), piece.inApp))
    }

    let written = 0
    for (const row of rows) {
      try {
        await db.messageLog.create({ data: row })
      } catch (error) {
        // The dedupe key is already there: this message has been recorded before
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
        throw error
      }
      written++
      // The in-app notice is written only by whoever wrote its log row
      if (row.channel === 'IN_APP' && row.userId) {
        const [title, ...rest] = row.body.split('\n')
        await db.notification.create({ data: { userId: row.userId, type: event.toUpperCase().replace(/\W/g, '_'), title, body: rest.join('\n') } })
      }
    }
    return { written, failed: false }
  } catch (error) {
    // IDs only: nothing here can carry an address or a message body
    console.error(`[Messaging] could not record ${event}`, ids, error instanceof Error ? error.message : error)
    try {
      Sentry.captureException(error, { level: 'error', tags: { area: 'messaging', messaging_issue: 'NOTIFY_FAILED' }, contexts: { message: { event, ...ids } } })
    } catch { /* reporting must not throw either */ }
    return { written: 0, failed: true }
  }
}

function inAppRow(base: { event: string; bookingId: string | null }, userId: string, role: string, dedupeKey: string, inApp: { title: string; body: string }): Row {
  return {
    ...base, channel: 'IN_APP', userId, recipientRole: role, recipientMasked: null, dedupeKey,
    subject: inApp.title, body: `${inApp.title}\n${inApp.body}`,
    status: 'SENT', provider: 'in-app', error: null, sentAt: new Date(),
  }
}

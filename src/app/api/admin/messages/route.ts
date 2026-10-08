import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/roles'
import { channelGate, messagingConfig, messagingEnabled } from '@/lib/messaging/config'
import { emailHtml } from '@/lib/messaging/emailHtml'
import { EVENT_NAMES, SAMPLE_FACTS, TEMPLATES, emailFooter, emailText, type Template } from '@/lib/messaging/templates'

const PAGE = 100
const STATUSES = ['QUEUED', 'SENDING', 'LOGGED', 'SENT', 'FAILED', 'GAVE_UP', 'SKIPPED', 'UNKNOWN']
const CHANNELS = ['EMAIL', 'SMS', 'IN_APP']

/**
 * GET /api/admin/messages (ADMIN only)
 *
 * The message log: what was sent, or would have been, to whom, and what
 * became of it. Recipients are shown masked; the real address is never stored
 * in the log. Filters: ?status=, ?channel=, ?event=.
 *
 * GET /api/admin/messages?view=templates
 * Every template rendered with fixed sample data, for reading the wording.
 * Nothing is read from real bookings and nothing is sent.
 */
export async function GET(req: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const params = new URL(req.url).searchParams
    const config = messagingConfig()
    const email = channelGate('EMAIL')
    const sms = channelGate('SMS')
    const switches = {
      enabled: messagingEnabled(),
      email: { live: email.live, provider: email.provider, reason: email.live ? null : email.reason },
      sms: { live: sms.live, provider: sms.provider, reason: sms.live ? null : sms.reason },
      adminInbox: !!config.adminAlertEmail,
    }

    if (params.get('view') === 'templates') {
      const facts = { ...SAMPLE_FACTS, appUrl: config.appUrl, supportEmail: config.supportEmail }
      const templates = EVENT_NAMES.map((event) => {
        const template: Template = TEMPLATES[event]
        const optional = template.optional === true
        return {
          event,
          label: template.label,
          optional,
          pieces: template.render(facts).map((piece) => {
            const text = piece.email ? emailText(piece.email, config.appUrl, emailFooter(facts, optional)) : null
            return {
              to: piece.to,
              email: piece.email && text ? { subject: piece.email.subject, text, html: emailHtml(piece.email.subject, text) } : null,
              sms: piece.sms ? { text: piece.sms, length: piece.sms.length } : null,
              inApp: piece.inApp ?? null,
            }
          }),
        }
      })
      return NextResponse.json({
        templates, switches,
        sender: { email: `${config.emailFromName} <${config.emailFromAddress}>`, replyTo: config.supportEmail, sms: config.smsSenderId },
      })
    }

    const status = params.get('status')
    const channel = params.get('channel')
    const event = params.get('event')
    const where = {
      ...(status && STATUSES.includes(status) ? { status } : {}),
      ...(channel && CHANNELS.includes(channel) ? { channel } : {}),
      ...(event && (EVENT_NAMES as string[]).includes(event) ? { event } : {}),
    }

    const [rows, total, byStatus] = await Promise.all([
      db.messageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        include: { user: { select: { name: true } } },
      }),
      db.messageLog.count({ where }),
      db.messageLog.groupBy({ by: ['status'], _count: true }),
    ])

    return NextResponse.json({
      messages: rows.map((m) => ({
        id: m.id, createdAt: m.createdAt, event: m.event, channel: m.channel,
        recipientRole: m.recipientRole, recipientMasked: m.recipientMasked, recipientName: m.user?.name ?? null,
        bookingId: m.bookingId, subject: m.subject, body: m.body, status: m.status,
        provider: m.provider, providerMessageId: m.providerMessageId, error: m.error,
        attempts: m.attempts, nextAttemptAt: m.nextAttemptAt, sentAt: m.sentAt,
      })),
      total,
      shown: rows.length,
      counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      switches,
      filters: { statuses: STATUSES, channels: CHANNELS, events: EVENT_NAMES.map((name) => ({ name, label: TEMPLATES[name].label })) },
    })
  } catch (err) {
    console.error('Admin messages GET error:', err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}

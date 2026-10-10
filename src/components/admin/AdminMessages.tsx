'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

type Switches = {
  enabled: boolean
  email: { live: boolean; provider: string; reason: string | null }
  sms: { live: boolean; provider: string; reason: string | null }
  adminInbox: boolean
}
type Message = {
  id: string; createdAt: string; event: string; channel: string
  recipientRole: string; recipientMasked: string | null; recipientName: string | null
  bookingId: string | null; subject: string | null; body: string; status: string
  provider: string | null; providerMessageId: string | null; error: string | null
  attempts: number; nextAttemptAt: string | null; sentAt: string | null
}
type LogData = {
  messages: Message[]; total: number; shown: number; counts: Record<string, number>; switches: Switches
  filters: { statuses: string[]; channels: string[]; events: { name: string; label: string }[] }
}
type Piece = {
  to: string
  email: { subject: string; text: string; html: string } | null
  sms: { text: string; length: number } | null
  inApp: { title: string; body: string } | null
}
type TemplateData = {
  templates: { event: string; label: string; optional: boolean; pieces: Piece[] }[]
  switches: Switches
  sender: { email: string; replyTo: string; sms: string }
}

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }
const panel = { backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }
const field = { border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  LOGGED:  { bg: '#F3F4F6', color: '#374151', label: 'Logged only' },
  QUEUED:  { bg: '#FEF3C7', color: '#92400E', label: 'Queued' },
  SENDING: { bg: '#FEF3C7', color: '#92400E', label: 'Sending' },
  SENT:    { bg: '#D1FAE5', color: '#065F46', label: 'Sent' },
  FAILED:  { bg: '#FEE2E2', color: '#991B1B', label: 'Failed, will retry' },
  GAVE_UP: { bg: '#FEE2E2', color: '#991B1B', label: 'Gave up' },
  SKIPPED: { bg: '#E5E7EB', color: '#374151', label: 'Skipped' },
  UNKNOWN: { bg: '#FEE2E2', color: '#991B1B', label: 'Outcome unknown' },
}
const CHANNEL_LABEL: Record<string, string> = { EMAIL: 'Email', SMS: 'SMS', IN_APP: 'In-app' }
const AUDIENCE_LABEL: Record<string, string> = { guest: 'Guest', host: 'Host', user: 'The person', admin: 'Admin' }
const when = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Chip({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.LOGGED
  return <span className="px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: s.bg, color: s.color }}>{s.label}</span>
}

/** Whether anything can leave, said plainly at the top of both views. */
function SwitchNote({ switches }: { switches: Switches }) {
  const line = (name: string, gate: Switches['email']) =>
    gate.live ? `${name} is live through ${gate.provider}.` : `${name} is not sent: ${gate.reason}.`
  return (
    <div className="p-4 rounded-2xl text-sm" style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
      <p className="font-semibold" style={ink}>
        {switches.email.live || switches.sms.live ? 'Messaging is switched on' : 'Messaging is off: nothing is being sent'}
      </p>
      <p className="mt-1" style={muted}>
        {line('Email', switches.email)} {line('SMS', switches.sms)}{' '}
        {switches.adminInbox ? 'Admin emails go to the shared inbox.' : 'ADMIN_ALERT_EMAIL is not set, so admin emails go to each admin account that has an email address.'}
      </p>
    </div>
  )
}

function Log() {
  const [data, setData] = useState<LogData | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [event, setEvent] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const query = new URLSearchParams({ ...(status && { status }), ...(channel && { channel }), ...(event && { event }) })
    fetch(`/api/admin/messages?${query}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed to load messages')
        if (active) { setData(json); setError('') }
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Failed to load messages') })
    return () => { active = false }
  }, [status, channel, event])

  if (error) return <p className="text-sm" style={{ color: '#991B1B' }}>{error}</p>
  if (!data) return <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin" style={{ color: 'var(--color-accent)' }} /></div>

  const select = 'focus-ring text-sm rounded-xl px-3 py-2.5 min-w-0 w-full sm:w-auto'
  return (
    <div className="space-y-4">
      <SwitchNote switches={data.switches} />

      <div className="flex flex-col sm:flex-row gap-2">
        <select aria-label="Status" className={select} style={field} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Every status</option>
          {data.filters.statuses.map((s) => <option key={s} value={s}>{STATUS_STYLE[s]?.label ?? s} ({data.counts[s] ?? 0})</option>)}
        </select>
        <select aria-label="Channel" className={select} style={field} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Every channel</option>
          {data.filters.channels.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </select>
        <select aria-label="Event" className={select} style={field} value={event} onChange={(e) => setEvent(e.target.value)}>
          <option value="">Every event</option>
          {data.filters.events.map((ev) => <option key={ev.name} value={ev.name}>{ev.label}</option>)}
        </select>
      </div>

      <p className="text-sm" style={muted}>
        {data.total === 0 ? 'No messages yet.' : data.shown < data.total ? `Showing the latest ${data.shown} of ${data.total}.` : `${data.total} message${data.total === 1 ? '' : 's'}.`}
      </p>

      <ul className="space-y-2">
        {data.messages.map((m) => {
          const open = openId === m.id
          return (
            <li key={m.id} className="rounded-2xl" style={panel}>
              <button type="button" onClick={() => setOpenId(open ? null : m.id)} aria-expanded={open}
                className="focus-ring w-full text-left p-4 rounded-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold break-words" style={ink}>{m.subject ?? m.body.slice(0, 80)}</p>
                    <p className="text-xs mt-1 break-words" style={muted}>
                      {CHANNEL_LABEL[m.channel] ?? m.channel} to {m.recipientRole.toLowerCase()}
                      {m.recipientName ? ` ${m.recipientName}` : ''}{m.recipientMasked ? ` (${m.recipientMasked})` : ''}
                      {' · '}{when(m.createdAt)}
                    </p>
                    <p className="text-xs mt-0.5 break-all" style={muted}>{m.event}</p>
                  </div>
                  <Chip status={m.status} />
                </div>
              </button>
              {open && (
                <div className="px-4 pb-4 space-y-3">
                  <pre className="text-sm whitespace-pre-wrap break-words p-3 rounded-xl font-sans" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>{m.body}</pre>
                  <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" style={muted}>
                    {m.error && <><dt>Why</dt><dd className="break-words" style={ink}>{m.error}</dd></>}
                    <dt>Provider</dt><dd>{m.provider ?? 'none'}{m.providerMessageId ? ` (${m.providerMessageId})` : ''}</dd>
                    <dt>Attempts</dt><dd>{m.attempts}</dd>
                    {m.nextAttemptAt && <><dt>Next try</dt><dd>{when(m.nextAttemptAt)}</dd></>}
                    {m.sentAt && <><dt>Sent</dt><dd>{when(m.sentAt)}</dd></>}
                    {m.channel === 'SMS' && <><dt>Length</dt><dd>{m.body.length} of 160 characters</dd></>}
                    {m.bookingId && <><dt>Booking</dt><dd className="break-all">{m.bookingId}</dd></>}
                  </dl>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Templates() {
  const [data, setData] = useState<TemplateData | null>(null)
  const [error, setError] = useState('')
  const [event, setEvent] = useState('')

  useEffect(() => {
    fetch('/api/admin/messages?view=templates')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed to load templates')
        setData(json)
        setEvent(json.templates[0]?.event ?? '')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load templates'))
  }, [])

  if (error) return <p className="text-sm" style={{ color: '#991B1B' }}>{error}</p>
  if (!data) return <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin" style={{ color: 'var(--color-accent)' }} /></div>

  const template = data.templates.find((t) => t.event === event)
  return (
    <div className="space-y-4">
      <p className="text-sm" style={muted}>
        Each message as it would be written, using made-up sample data. Nothing here is read from a real booking and nothing is sent.
        Emails go from {data.sender.email} with replies to {data.sender.replyTo}. SMS go from {data.sender.sms}.
      </p>

      <select aria-label="Template" className="focus-ring text-sm rounded-xl px-3 py-2.5 w-full" style={field} value={event} onChange={(e) => setEvent(e.target.value)}>
        {data.templates.map((t) => <option key={t.event} value={t.event}>{t.label}{t.optional ? ' (optional)' : ''}</option>)}
      </select>

      {template && (
        <div className="space-y-4">
          <p className="text-xs break-all" style={muted}>
            {template.event} · {template.optional ? 'Optional: a person can turn this off in their profile.' : 'Always sent.'}
          </p>
          {template.pieces.map((piece, i) => (
            <section key={i} className="p-4 rounded-2xl space-y-4" style={panel}>
              <h3 className="text-sm font-bold" style={ink}>To the {(AUDIENCE_LABEL[piece.to] ?? piece.to).toLowerCase().replace('the ', '')}</h3>
              {piece.email && (
                <div>
                  <p className="text-xs font-semibold mb-1" style={muted}>Email</p>
                  <p className="text-sm font-semibold mb-2 break-words" style={ink}>{piece.email.subject}</p>
                  <iframe title={`Email to the ${piece.to}`} sandbox="" srcDoc={piece.email.html}
                    className="w-full rounded-xl" style={{ height: 460, border: '1px solid var(--color-border)', backgroundColor: '#FAF7F2' }} />
                  <details className="mt-2">
                    <summary className="text-xs cursor-pointer" style={muted}>Plain text version</summary>
                    <pre className="text-sm whitespace-pre-wrap break-words p-3 mt-2 rounded-xl font-sans" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>{piece.email.text}</pre>
                  </details>
                </div>
              )}
              {piece.sms && (
                <div>
                  <p className="text-xs font-semibold mb-1" style={muted}>SMS · {piece.sms.length} of 160 characters</p>
                  <p className="text-sm p-3 rounded-xl break-words" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>{piece.sms.text}</p>
                </div>
              )}
              {piece.inApp && (
                <div>
                  <p className="text-xs font-semibold mb-1" style={muted}>In the app</p>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
                    <p className="text-sm font-semibold" style={ink}>{piece.inApp.title}</p>
                    <p className="text-sm mt-0.5 break-words" style={muted}>{piece.inApp.body}</p>
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** The admin Messages tab: the message log, and a preview of every template. */
export function AdminMessages() {
  const [view, setView] = useState<'log' | 'templates'>('log')
  const tab = (id: 'log' | 'templates', label: string) => (
    <button type="button" onClick={() => setView(id)} aria-pressed={view === id}
      className="focus-ring px-4 py-2.5 rounded-full text-sm font-semibold"
      style={view === id
        ? { backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }
        : { backgroundColor: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-strong)' }}>
      {label}
    </button>
  )
  return (
    <div className="space-y-5">
      <div className="flex gap-2">{tab('log', 'Message log')}{tab('templates', 'Templates')}</div>
      {view === 'log' ? <Log /> : <Templates />}
    </div>
  )
}

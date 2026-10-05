'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

type Block = { date: string; note: string | null }
type Booking = { id: string; checkIn: string; checkOut: string; status: string; guestName: string }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_NOTE = 200

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
/** A day as the server stores it: midday UTC. */
const noon = (key: string) => new Date(`${key}T12:00:00Z`)
const todayKey = () => new Date().toISOString().slice(0, 10)
const longDate = (key: string) =>
  noon(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function ListingCalendarPage() {
  const params = useParams<{ id: string }>()
  const listingId = params.id
  const { user, loading: authLoading } = useAuth()

  const [title, setTitle] = useState('')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const now = new Date()
  const [view, setView] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() })
  // Two taps pick a range: the first sets both ends, the second extends it
  const [selection, setSelection] = useState<{ start: string; end: string } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // Fetches the calendar without touching state, so it can be used from an
  // effect (which applies the result in a callback) and after a change.
  const fetchCalendar = useCallback(async () => {
    const res = await fetch(`/api/listings/${listingId}/blocked-dates`)
    const data = await res.json().catch(() => ({}))
    return res.ok
      ? { blocks: (data.blocks ?? []) as Block[], bookings: (data.bookings ?? []) as Booking[], error: '' }
      : { blocks: [] as Block[], bookings: [] as Booking[], error: (data.error as string) ?? 'The calendar could not be loaded.' }
  }, [listingId])

  const apply = useCallback((c: { blocks: Block[]; bookings: Booking[]; error: string }) => {
    setLoadError(c.error)
    if (!c.error) { setBlocks(c.blocks); setBookings(c.bookings) }
  }, [])

  useEffect(() => {
    if (authLoading || !user) return
    let active = true
    Promise.all([
      fetchCalendar().then((c) => { if (active) apply(c) }),
      fetch(`/api/listings/${listingId}`).then((r) => r.json()).then((d) => { if (active) setTitle(d.listing?.title ?? '') }).catch(() => {}),
    ]).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [authLoading, user, listingId, fetchCalendar, apply])

  const blockByDay = useMemo(() => new Map(blocks.map((b) => [b.date, b])), [blocks])
  /** The guest booking that takes a day, if any: the day's midday falls inside the stay. */
  const bookingFor = useCallback((key: string) => {
    const t = noon(key).getTime()
    return bookings.find((b) => new Date(b.checkIn).getTime() <= t && t < new Date(b.checkOut).getTime())
  }, [bookings])

  const today = todayKey()
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate()
  const leading = (new Date(Date.UTC(view.year, view.month, 1)).getUTCDay() + 6) % 7
  const monthLabel = new Date(Date.UTC(view.year, view.month, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  function moveMonth(delta: number) {
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month + delta, 1))
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
    })
  }

  function pick(key: string) {
    setMessage(null)
    setSelection((sel) => {
      if (!sel || sel.start !== sel.end) return { start: key, end: key }
      return key < sel.start ? { start: key, end: sel.start } : { start: sel.start, end: key }
    })
  }

  const selectedKeys = useMemo(() => {
    if (!selection) return [] as string[]
    const out: string[] = []
    for (let t = noon(selection.start).getTime(); t <= noon(selection.end).getTime(); t += 86_400_000) {
      out.push(new Date(t).toISOString().slice(0, 10))
    }
    return out
  }, [selection])

  const selectedBlocked = selectedKeys.filter((k) => blockByDay.has(k)).length
  const selectedFree = selectedKeys.filter((k) => !blockByDay.has(k) && !bookingFor(k) && k >= today).length

  async function send(method: 'POST' | 'DELETE') {
    if (!selection) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/listings/${listingId}/blocked-dates`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'POST' ? { ...selection, note } : selection),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error ?? 'That did not work. Please try again.' })
        return
      }
      apply(await fetchCalendar())
      setSelection(null)
      setNote('')
      setMessage({
        kind: 'ok',
        text: method === 'POST'
          ? `${data.blocked} ${data.blocked === 1 ? 'day' : 'days'} blocked.`
          : `${data.unblocked} ${data.unblocked === 1 ? 'day' : 'days'} unblocked.`,
      })
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach FieGH. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  // Blocks shown as runs of consecutive days that share a note
  const blockRuns = useMemo(() => {
    const runs: { start: string; end: string; note: string | null }[] = []
    for (const b of blocks.filter((x) => x.date >= today)) {
      const last = runs[runs.length - 1]
      if (last && last.note === b.note && noon(b.date).getTime() - noon(last.end).getTime() === 86_400_000) last.end = b.date
      else runs.push({ start: b.date, end: b.date, note: b.note })
    }
    return runs
  }, [blocks, today])
  const upcomingBookings = bookings.filter((b) => b.checkOut.slice(0, 10) >= today)

  const ink = { color: 'var(--color-text-primary)' }
  const muted = { color: 'var(--color-text-secondary)' }

  if (authLoading || (user && loading)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} aria-label="Loading" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-center">
          <p className="font-semibold" style={ink}>{loadError}</p>
          <Link href="/dashboard/host" className="focus-ring rounded-sm inline-block mt-3 text-sm font-semibold underline underline-offset-4 decoration-1"
            style={{ color: 'var(--color-accent-deep)' }}>
            Back to your dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 md:pt-14 pb-16 md:pb-24">
        <header className="mb-8">
          <h1 className="text-[2.25rem] md:text-[3rem]" style={ink}>Calendar</h1>
          <p className="mt-2 text-base" style={muted}>
            {title ? `${title}. ` : ''}Block the dates you do not want guests to book. Guests see blocked dates as unavailable.
          </p>
          <p className="mt-3 text-sm">
            <Link href={`/dashboard/host/listings/${listingId}/edit`} className="focus-ring rounded-sm font-semibold underline underline-offset-4 decoration-1"
              style={{ color: 'var(--color-accent-deep)' }}>
              Edit this listing
            </Link>
          </p>
        </header>

        {/* Month */}
        <section aria-label="Month" className="soft-panel p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month"
              className="focus-ring w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--color-accent-subtle)]" style={ink}>
              <ChevronLeft size={18} aria-hidden />
            </button>
            <h2 className="text-lg font-bold" style={ink} aria-live="polite">{monthLabel}</h2>
            <button type="button" onClick={() => moveMonth(1)} aria-label="Next month"
              className="focus-ring w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--color-accent-subtle)]" style={ink}>
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold mb-1" style={muted} aria-hidden>
            {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const key = keyOf(view.year, view.month, i + 1)
              const booking = bookingFor(key)
              const block = blockByDay.get(key)
              const past = key < today
              const selected = selectedKeys.includes(key)
              const state = booking ? 'booked' : block ? 'blocked' : past ? 'past' : 'free'
              const label = `${longDate(key)}, ${
                booking ? `booked by a guest (${booking.status.toLowerCase()})`
                : block ? `blocked by you${block.note ? `: ${block.note}` : ''}`
                : past ? 'in the past' : 'available'}`
              // Guest bookings and past free days cannot be changed here
              const disabled = !!booking || (past && !block)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  aria-label={label}
                  aria-pressed={selected}
                  title={block?.note ?? undefined}
                  onClick={() => pick(key)}
                  className="focus-ring relative aspect-square rounded-xl text-sm font-semibold flex items-center justify-center disabled:cursor-not-allowed"
                  style={{
                    backgroundColor:
                      state === 'booked' ? 'var(--color-text-primary)'
                      : state === 'blocked' ? 'var(--color-accent-subtle)'
                      : 'transparent',
                    color:
                      state === 'booked' ? 'var(--color-bg)'
                      : state === 'past' ? 'var(--color-text-muted)'
                      : 'var(--color-text-primary)',
                    border: state === 'blocked' ? '1px dashed var(--color-accent-deep)' : '1px solid var(--color-border)',
                    outline: selected ? '2px solid var(--color-accent)' : undefined,
                    outlineOffset: selected ? '1px' : undefined,
                  }}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>

          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs" style={muted}>
            <li className="flex items-center gap-2">
              <span className="w-4 h-4 rounded" style={{ backgroundColor: 'var(--color-text-primary)' }} aria-hidden /> Booked by a guest
            </li>
            <li className="flex items-center gap-2">
              <span className="w-4 h-4 rounded" style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px dashed var(--color-accent-deep)' }} aria-hidden /> Blocked by you
            </li>
            <li className="flex items-center gap-2">
              <span className="w-4 h-4 rounded" style={{ border: '1px solid var(--color-border)' }} aria-hidden /> Available
            </li>
          </ul>
        </section>

        {/* Selection */}
        <section aria-label="Selected dates" className="mt-6 soft-panel p-4 sm:p-6">
          {!selection ? (
            <p className="text-sm" style={muted}>
              Choose a day to start. Choose a second day to select everything in between.
            </p>
          ) : (
            <>
              <p className="text-base font-bold" style={ink}>
                {selection.start === selection.end ? longDate(selection.start) : `${longDate(selection.start)} to ${longDate(selection.end)}`}
              </p>
              <p className="text-sm mt-1" style={muted}>
                {selectedFree} available, {selectedBlocked} blocked by you.
              </p>

              {selectedFree > 0 && (
                <div className="mt-4">
                  <label htmlFor="block-note" className="block text-xs font-semibold mb-1.5" style={muted}>
                    Private note (optional)
                  </label>
                  <input
                    id="block-note"
                    type="text"
                    value={note}
                    maxLength={MAX_NOTE}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Only you can see this"
                    className="focus-ring w-full px-4 py-3 rounded-xl border text-sm"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                  />
                </div>
              )}

              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                {selectedFree > 0 && (
                  <button type="button" onClick={() => send('POST')} disabled={busy}
                    className="pressable focus-ring inline-flex items-center justify-center gap-2 px-6 h-11 rounded-full font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-70"
                    style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                    {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
                    Block {selectedFree === 1 ? 'this date' : 'these dates'}
                  </button>
                )}
                {selectedBlocked > 0 && (
                  <button type="button" onClick={() => send('DELETE')} disabled={busy}
                    className="pressable focus-ring inline-flex items-center justify-center px-6 h-11 rounded-full font-semibold text-sm hover:bg-[var(--color-accent-subtle)] disabled:opacity-70"
                    style={{ border: '1px solid var(--color-border-strong)', color: 'var(--color-text-primary)' }}>
                    Unblock {selectedBlocked === 1 ? 'this date' : 'these dates'}
                  </button>
                )}
                <button type="button" onClick={() => { setSelection(null); setMessage(null) }} disabled={busy}
                  className="focus-ring rounded-sm text-sm font-semibold underline underline-offset-4 decoration-1 sm:ml-2"
                  style={{ color: 'var(--color-accent-deep)' }}>
                  Clear selection
                </button>
              </div>
            </>
          )}

          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className="mt-4 text-sm px-3 py-2 rounded-lg"
              style={message.kind === 'error'
                ? { backgroundColor: '#FEE2E2', color: '#991B1B' }
                : { backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-text-primary)' }}>
              {message.text}
            </p>
          )}
        </section>

        {/* Lists */}
        <section className="mt-10">
          <h2 className="text-[1.5rem] md:text-[1.75rem] mb-3" style={ink}>Your blocked dates</h2>
          {blockRuns.length === 0 ? (
            <p className="text-sm" style={muted}>You have not blocked any upcoming dates.</p>
          ) : (
            <ul className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              {blockRuns.map((r) => (
                <li key={r.start} className="py-3 border-b text-sm" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="font-semibold" style={ink}>
                    {r.start === r.end ? longDate(r.start) : `${longDate(r.start)} to ${longDate(r.end)}`}
                  </span>
                  {r.note && <span className="block mt-0.5" style={muted}>{r.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-[1.5rem] md:text-[1.75rem] mb-3" style={ink}>Guest bookings</h2>
          {upcomingBookings.length === 0 ? (
            <p className="text-sm" style={muted}>No upcoming guest bookings on this listing.</p>
          ) : (
            <ul className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              {upcomingBookings.map((b) => (
                <li key={b.id} className="py-3 border-b text-sm flex flex-wrap justify-between gap-x-4" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="font-semibold" style={ink}>{shortDate(b.checkIn)} to {shortDate(b.checkOut)}</span>
                  <span style={muted}>{b.guestName}, {b.status === 'PENDING' ? 'awaiting your reply' : 'confirmed'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm" style={muted}>
            Dates taken by a guest cannot be changed here. Reply to requests from your bookings page.
          </p>
        </section>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { formatUsd } from '@/lib/utils'
import { formatStayDate } from '@/lib/stayDates'
import { OVERDUE_REMINDER_DAYS, RENT_GRACE_DAYS } from '@/lib/rentRules'

type Cover =
  | { ok: false; error: string }
  | { ok: true; cover: number; shortfall: number; depositLeftAfter: number; status: string }
type Item = {
  id: string
  bookingId: string
  sequence: number
  status: string
  title: string
  guestName: string | null
  hostName: string | null
  dueDate: string
  periodStart: string
  periodEnd: string
  amount: number
  coveredFromDeposit: number
  outstanding: number
  daysPastDue: number
  overdue: boolean
  depositLeft: number
  cover: Cover
  endsOn: string | null
}
type Held = {
  id: string
  amount: number
  bookingId: string | null
  instalmentSeq: number
  failureReason: string | null
  host: { name: string | null }
  booking: { listing: { title: string } } | null
}

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }
const day = (value: string) => formatStayDate(value, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Rent that is late or coming due, and payouts held for being over the
 * transfer limit. A late payment can be covered from the booking's damage
 * deposit: the server works out what that would do, the admin sees it, and
 * one click confirms it. While covering is switched off, confirming reports
 * the same figures and changes nothing.
 */
export function AdminRent() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [held, setHeld] = useState<Held[]>([])
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  // The late payment whose tenancy an admin has asked to end, waiting for a second click
  const [endingId, setEndingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/rent')
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not load rent.'); return }
      setItems(data.instalments)
      setHeld(data.heldPayouts ?? [])
      setEnabled(!!data.coverEnabled)
    } catch {
      setError('Network error. Please try again.')
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/admin/rent')
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!active) return
        if (!ok) { setError(data.error ?? 'Could not load rent.'); return }
        setItems(data.instalments)
        setHeld(data.heldPayouts ?? [])
        setEnabled(!!data.coverEnabled)
      })
      .catch(() => { if (active) setError('Network error. Please try again.') })
    return () => { active = false }
  }, [])

  async function cover(item: Item) {
    setBusy(item.id)
    try {
      const res = await fetch('/api/admin/rent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cover', instalmentId: item.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNotes((n) => ({ ...n, [item.id]: data.error ?? 'The rent could not be covered.' }))
      } else if (data.mode === 'dry-run') {
        setNotes((n) => ({ ...n, [item.id]: `Nothing was changed (${data.reason}). It would take ${formatUsd(data.quote.cover)} from the deposit.` }))
      } else {
        setNotes((n) => ({ ...n, [item.id]: `Covered: ${formatUsd(data.quote.cover)} taken from the deposit.${data.quote.shortfall > 0 ? ` ${formatUsd(data.quote.shortfall)} is still owed.` : ''}` }))
        await load()
      }
    } catch {
      setNotes((n) => ({ ...n, [item.id]: 'Network error. Please try again.' }))
    } finally {
      setBusy(null)
    }
  }

  async function endTenancy(item: Item) {
    if (!item.endsOn) return
    setBusy(item.id)
    try {
      const res = await fetch(`/api/bookings/${item.bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // The date shown is sent back, so the server refuses if it has moved
        body: JSON.stringify({ action: 'end-tenancy', expectedEnd: item.endsOn.slice(0, 10) }),
      })
      const data = await res.json()
      if (!res.ok) setNotes((n) => ({ ...n, [item.id]: data.error ?? 'The tenancy could not be ended.' }))
      setEndingId(null)
      await load()
    } catch {
      setNotes((n) => ({ ...n, [item.id]: 'Network error. Please try again.' }))
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="text-sm" style={{ color: '#991B1B' }}>{error}</p>
  if (!items) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin" style={muted} /></div>

  const late = items.filter((i) => i.overdue)
  const coming = items.filter((i) => !i.overdue)

  return (
    <div className="space-y-6">
      {!enabled && (
        <div className="p-4 rounded-xl text-sm" style={{ backgroundColor: '#FEF3C7', color: '#78350F' }}>
          Covering rent from a deposit is switched off (RENT_DEPOSIT_COVER_ENABLED). You can still press the button: it reports what it would do and changes nothing.
        </div>
      )}

      <section>
        <h3 className="font-bold mb-1" style={ink}>Late rent</h3>
        <p className="text-xs mb-3" style={muted}>
          Late once {RENT_GRACE_DAYS} day after the due date has passed. The tenant is reminded daily until {OVERDUE_REMINDER_DAYS} days after the due date.
        </p>
        {late.length === 0 ? <p className="text-sm" style={muted}>No rent is late.</p> : (
          <div className="space-y-3">
            {late.map((i) => (
              <div key={i.id} className="soft-panel p-4 text-sm">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-semibold" style={ink}>{i.title}</p>
                    <p className="text-xs mt-0.5" style={muted}>
                      Tenant {i.guestName ?? 'unknown'} · Host {i.hostName ?? 'unknown'} · Booking {i.bookingId}
                    </p>
                    <p className="text-xs mt-0.5" style={muted}>
                      Rent from {day(i.periodStart)} to {day(i.periodEnd)}, due {day(i.dueDate)}: {i.daysPastDue} days ago
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold" style={{ color: '#991B1B' }}>{formatUsd(i.outstanding)} owed</p>
                    <p className="text-xs" style={muted}>Deposit left: {formatUsd(i.depositLeft)}</p>
                    {i.coveredFromDeposit > 0 && <p className="text-xs" style={muted}>{formatUsd(i.coveredFromDeposit)} already taken from the deposit</p>}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
                  {i.cover.ok ? (
                    <>
                      <p className="text-xs" style={ink}>
                        Covering takes {formatUsd(i.cover.cover)} from the deposit.
                        {i.cover.shortfall > 0 ? ` ${formatUsd(i.cover.shortfall)} stays owed by the tenant.` : ' The payment is then settled in full.'}
                        {' '}{formatUsd(i.cover.depositLeftAfter)} of the deposit is left. This cannot be undone here.
                      </p>
                      <button onClick={() => cover(i)} disabled={busy === i.id}
                        className="px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                        {busy === i.id ? 'Working…' : 'Cover from deposit'}
                      </button>
                    </>
                  ) : (
                    <p className="text-xs" style={muted}>Cannot be covered from the deposit: {i.cover.error}.</p>
                  )}
                </div>
                {i.endsOn && (
                  <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs" style={muted}>
                      The host can end this tenancy, and so can you. It would end on {day(i.endsOn)}, the end of the last month paid for. Nothing is refunded and this cannot be undone.
                    </p>
                    {endingId === i.id ? (
                      <span className="flex gap-2">
                        <button onClick={() => endTenancy(i)} disabled={busy === i.id}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: '#991B1B', color: '#FFFFFF' }}>
                          Yes, end it on {day(i.endsOn)}
                        </button>
                        <button onClick={() => setEndingId(null)} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-stone-300">Keep</button>
                      </span>
                    ) : (
                      <button onClick={() => setEndingId(i.id)} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-stone-300" style={ink}>
                        End tenancy
                      </button>
                    )}
                  </div>
                )}
                {notes[i.id] && <p className="text-xs mt-2 font-semibold" style={ink}>{notes[i.id]}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="font-bold mb-3" style={ink}>Due in the next week, or in the grace day</h3>
        {coming.length === 0 ? <p className="text-sm" style={muted}>Nothing is coming due.</p> : (
          <div className="soft-panel divide-y divide-stone-100">
            {coming.map((i) => (
              <div key={i.id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium" style={ink}>{i.title}</p>
                  <p className="text-xs" style={muted}>Tenant {i.guestName ?? 'unknown'} · due {day(i.dueDate)}</p>
                </div>
                <p className="font-semibold" style={ink}>{formatUsd(i.outstanding)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="font-bold mb-1" style={ink}>Payouts held: over the transfer limit</h3>
        <p className="text-xs mb-3" style={muted}>These were not sent and are never split or retried. Pay each one to the host by hand.</p>
        {held.length === 0 ? <p className="text-sm" style={muted}>No payouts are held.</p> : (
          <div className="soft-panel divide-y divide-stone-100">
            {held.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium" style={ink}>{p.booking?.listing.title ?? 'Booking'}{p.instalmentSeq > 0 ? ` · rent payment ${p.instalmentSeq}` : ''}</p>
                  <p className="text-xs" style={muted}>Host {p.host.name ?? 'unknown'} · Payout {p.id}</p>
                  {p.failureReason && <p className="text-xs" style={muted}>{p.failureReason}</p>}
                </div>
                <p className="font-semibold" style={ink}>{formatUsd(p.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

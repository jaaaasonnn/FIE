'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

export type Notification = { id: string; type: string; title: string; body: string; createdAt: string }

/**
 * The signed-in person's unread notifications, each with a dismiss button.
 * Shows nothing when there are none. Emails and SMS for the same events are
 * handled separately (lib/messaging), and only once messaging is switched on.
 *
 * `initial` is GET /api/notifications's list as the server read it with the page (lib/serverRead.ts), so
 * the list is there from the start and nothing below it moves when it arrives; without it, it is fetched.
 */
export function NotificationsList({ className = '', initial = null }: { className?: string; initial?: Notification[] | null }) {
  const [items, setItems] = useState<Notification[]>(initial ?? [])

  useEffect(() => {
    if (initial) return
    let active = true
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : { notifications: [] }))
      .then((data) => { if (active) setItems(Array.isArray(data.notifications) ? data.notifications : []) })
      .catch(() => {})
    return () => { active = false }
  }, [initial])

  async function dismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id))
    try {
      await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    } catch { /* it comes back on the next visit */ }
  }

  if (items.length === 0) return null
  return (
    <section aria-label="Notifications" className={className}>
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id} className="p-4 rounded-2xl flex items-start gap-3"
            style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid var(--color-border-strong)' }}>
            <Bell size={17} aria-hidden className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent-deep)' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{n.title}</p>
              <p className="text-sm mt-0.5 break-words" style={{ color: 'var(--color-text-secondary)' }}>{n.body}</p>
            </div>
            <button type="button" onClick={() => dismiss(n.id)} aria-label="Dismiss"
              className="focus-ring w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-full flex-shrink-0">
              <X size={16} aria-hidden style={{ color: 'var(--color-text-primary)' }} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

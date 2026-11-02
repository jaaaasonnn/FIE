import Link from 'next/link'
import { Heart, MessageSquare, Search, UserCircle } from 'lucide-react'
import { FieMark } from './FieMark'

// The phone's bottom bar (stage 1 of the app shell). A server component: links and inline SVG only, so it
// adds no script to any page; it is drawn by the pages that have it, each naming its own tab, and hidden
// from 768 px up (globals.css .bottom-bar), where the header is the navigation. Signed out, every tab but
// Explore leads to a protected page, so the proxy sends the person to log in and back (src/proxy.ts).
// The one piece of browser code is the unread badge: public/bar.js, which only a phone downloads.

export type Tab = 'explore' | 'wishlists' | 'trips' | 'messages' | 'profile'

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: 'explore', href: '/', label: 'Explore' },
  { tab: 'wishlists', href: '/dashboard/guest/wishlist', label: 'Wishlists' },
  { tab: 'trips', href: '/dashboard/guest', label: 'Trips' },
  // One address, sent on to the guest's or the host's inbox (app/messages/page.tsx)
  { tab: 'messages', href: '/messages', label: 'Messages' },
  { tab: 'profile', href: '/account', label: 'Profile' },
]

function Icon({ tab, active }: { tab: Tab; active: boolean }) {
  const props = { size: 24, strokeWidth: active ? 2.25 : 1.75, 'aria-hidden': true as const }
  if (tab === 'trips') return <FieMark active={active} />
  if (tab === 'explore') return <Search {...props} />
  if (tab === 'wishlists') return <Heart {...props} />
  if (tab === 'messages') return <MessageSquare {...props} />
  return <UserCircle {...props} />
}

export function BottomBar({ active }: { active?: Tab }) {
  return (
    <nav aria-label="Main" className="bottom-bar" data-bottom-bar>
      <ul>
        {TABS.map(({ tab, href, label }) => {
          const on = tab === active
          return (
            <li key={tab}>
              <Link href={href} className="bottom-bar-tab" aria-current={on ? 'page' : undefined} data-tab={tab}>
                <span className="bottom-bar-icon">
                  <Icon tab={tab} active={on} />
                </span>
                <span className="bottom-bar-label">{label}</span>
                {/* After the label, so a screen reader says "Messages, 3 unread messages"; drawn over the icon.
                    Filled in by public/bar.js on a phone once the page is running; empty and hidden until then. */}
                {tab === 'messages' && <span className="bottom-bar-badge" data-unread-slot hidden />}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

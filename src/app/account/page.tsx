import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronDown, ChevronRight, CreditCard, FileText, HelpCircle, Home, IdCard, Mail, Shield, ShieldCheck, Smartphone, UserCircle, UserPen } from 'lucide-react'
import { getSessionUser } from '@/lib/session'
import { SUPPORT_EMAIL } from '@/lib/contact'
import { BottomBar } from '@/components/layout/BottomBar'
import { SignOutButton } from './SignOutButton'

export const metadata = { title: 'Your account | FieGH' }

type Row = { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>; external?: boolean }

/** The bottom bar's Profile tab: everything about the account in one place (stage 1 of the phone app shell). */
export default async function AccountPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?redirect=/account')

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: 'Your account',
      rows: [
        { href: '/profile/edit', label: 'Edit your profile', icon: UserPen },
        { href: `/profile/${user.id}`, label: 'Your public profile', icon: UserCircle },
        { href: '/dashboard/guest/payments', label: 'Payments', icon: CreditCard },
        { href: '/auth/verify-id', label: 'Your ID', icon: IdCard },
      ],
    },
    {
      title: 'Hosting',
      rows: [
        user.role === 'HOST'
          ? { href: '/dashboard/host', label: 'Hosting dashboard', icon: Home }
          : { href: '/become-a-host', label: 'Become a host', icon: Home },
        ...(user.role === 'ADMIN' ? [{ href: '/admin', label: 'Admin', icon: ShieldCheck }] : []),
      ],
    },
    {
      title: 'Help',
      rows: [
        { href: '/how-it-works', label: 'How FieGH works', icon: HelpCircle },
        { href: '/faq', label: 'Questions and answers', icon: HelpCircle },
        { href: `mailto:${SUPPORT_EMAIL}`, label: `Write to us: ${SUPPORT_EMAIL}`, icon: Mail, external: true },
        { href: '/terms', label: 'Terms of Service', icon: FileText },
        { href: '/privacy', label: 'Privacy Policy', icon: Shield },
      ],
    },
  ]

  return (
    <>
      <div className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Profile</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {user.name ?? 'Your account'}{user.email ? ` · ${user.email}` : ''}
        </p>
        {sections.map((section) => (
          <section key={section.title} className="mt-8" aria-labelledby={`account-${section.title}`}>
            <h2 id={`account-${section.title}`} className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>{section.title}</h2>
            <ul className="account-list">
              {section.rows.map(({ href, label, icon: Icon, external }) => (
                <li key={href}>
                  {external
                    ? <a href={href} className="account-row"><Icon size={20} strokeWidth={1.75} aria-hidden /><span>{label}</span></a>
                    : <Link href={href} className="account-row"><Icon size={20} strokeWidth={1.75} aria-hidden /><span>{label}</span><ChevronRight size={18} aria-hidden className="ml-auto" /></Link>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <InstallHint />
        <ul className="account-list mt-8">
          <li><SignOutButton /></li>
        </ul>
      </div>
      <BottomBar active="profile" />
    </>
  )
}

/**
 * How to add FieGH to a phone's home screen (app shell stage 4): one folded row, opened by a tap, no script, nothing
 * that pops up. CSS hides it at desktop widths and inside the installed app (globals.css, .account-install), so it
 * is drawn by the server once and never moves anything. An iPhone has no install prompt, so the steps are written out.
 */
function InstallHint() {
  return (
    <section className="account-install mt-8" aria-labelledby="account-install">
      <h2 id="account-install" className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>FieGH on your phone</h2>
      <div className="account-list">
        <details>
          <summary className="account-row">
            <Smartphone size={20} strokeWidth={1.75} aria-hidden /><span>Add FieGH to your home screen</span>
            <ChevronDown size={18} aria-hidden className="account-install-chevron ml-auto" />
          </summary>
          <div className="account-install-steps">
            <p>FieGH then opens from its own icon, without the browser&apos;s bars. It is the same FieGH: nothing to download from a store.</p>
            <h3>iPhone (Safari)</h3>
            <ol>
              <li>Tap the Share button (the square with an arrow).</li>
              <li>Tap <strong>Add to Home Screen</strong>. You may need to scroll down or tap <strong>More</strong> to find it.</li>
              <li>Tap <strong>Add</strong>.</li>
            </ol>
            <h3>Android (Chrome)</h3>
            <ol>
              <li>Tap the menu (the three dots).</li>
              <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
              <li>Tap <strong>Install</strong>.</li>
            </ol>
          </div>
        </details>
      </div>
    </section>
  )
}

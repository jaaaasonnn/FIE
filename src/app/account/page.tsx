import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, CreditCard, FileText, HelpCircle, Home, IdCard, Mail, Shield, ShieldCheck, UserCircle, UserPen } from 'lucide-react'
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
        <ul className="account-list mt-8">
          <li><SignOutButton /></li>
        </ul>
      </div>
      <BottomBar active="profile" />
    </>
  )
}

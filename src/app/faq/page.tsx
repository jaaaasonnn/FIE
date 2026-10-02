import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, Shield, CreditCard, MessageSquare, ShieldAlert } from 'lucide-react'
import { RENTAL_MODES } from '@/lib/rentalModes'
import { FaqAccordion } from '@/components/faq/FaqAccordion'

export const metadata: Metadata = {
  title: 'FAQ | FieGH',
  description:
    'How short stays, monthly lets and long-term leases work on FieGH, how payments are protected, and answers to common questions from guests and hosts.',
}

// ── Three ways to rent (moved here from the homepage) ───────────────────────
const RENTAL_DETAILS: Record<string, { length: string; desc: string }> = {
  SHORT_STAY: {
    length: 'Nightly and weekly',
    desc: 'Perfect for Detty December, business trips, or holiday escapes. Book for 1 night or a few weeks, with instant confirmation on Instant Book listings.',
  },
  TEMP_STAY: {
    length: '1 to 11 months',
    desc: 'Relocating for work? Visiting family from the diaspora? Monthly furnished rentals with flexible lease terms.',
  },
  PERMANENT: {
    length: '12 months and up',
    desc: 'Long-term tenancy agreements with clear advance payment terms upfront. No surprises: everything is agreed before you move in.',
  },
}

// ── Rent with confidence (moved here from the homepage) ─────────────────────
const TRUST = [
  {
    icon: BadgeCheck,
    title: 'ID verified hosts',
    desc: 'Every host goes through Ghana Card, Passport, or Voter ID verification before listing a property.',
  },
  {
    icon: Shield,
    title: 'Escrow protection',
    desc: 'Your payment is held securely until check-in is confirmed. Raise a dispute within 24 hours if anything is wrong.',
  },
  {
    icon: CreditCard,
    title: 'MoMo and card payments',
    desc: 'Pay with MTN MoMo, Vodafone Cash, AirtelTigo Money, or Visa/Mastercard via Paystack.',
  },
  {
    icon: MessageSquare,
    title: 'In-app messaging',
    desc: "Chat directly with your host before booking. No need to share phone numbers until you're ready.",
  },
]

const FAQS = [
  {
    id: 'general',
    category: 'General',
    questions: [
      { q: 'What does "Fie" mean?', a: '"Fie" (pronounced fee-yeh) means "home" in Twi, one of Ghana\'s most widely spoken languages. FieGH helps you find yours, with Ghanaian hospitality at the heart of the experience.' },
      { q: 'What regions does FieGH cover?', a: 'FieGH is live in Accra and Kumasi today. More cities and regions open as hosts list homes there, and the region tiles on the homepage show where homes are available right now.' },
      { q: 'Is FieGH only for Ghanaians?', a: 'No! FieGH is for anyone looking for a stay or a longer rental: locals, diaspora, expats, tourists, and business travellers. We accept international payments via card.' },
    ],
  },
  {
    id: 'payments',
    category: 'Payments',
    questions: [
      { q: 'What payment methods are accepted?', a: 'We accept MTN Mobile Money, Vodafone Cash, AirtelTigo Money, and Visa/Mastercard debit or credit cards. All payments are processed via Paystack, Ghana\'s leading payment gateway.' },
      { q: 'Are my payments safe?', a: 'Yes. All payments are held in escrow until check-in is confirmed. The host only receives the money after you\'ve moved in. If there\'s a problem, you can raise a dispute within 24 hours of check-in.' },
      { q: 'What currencies are accepted?', a: 'Prices are listed in USD and shown in GHS (Ghana Cedis) for reference. The exchange rate updates automatically every 6 hours, and MoMo payments are converted at the current rate.' },
      { q: 'Can I pay in Ghana Cedis?', a: 'Yes. When paying via MoMo, the amount is charged in GHS at the current exchange rate shown at checkout.' },
      { q: 'Why can\'t I pay outside the app?', a: 'For your protection. Cash and direct bank transfers have no protection. If you pay outside FieGH, we cannot help you recover funds in case of a scam. Always book and pay through the app.' },
    ],
  },
  {
    id: 'bookings',
    category: 'Bookings',
    questions: [
      { q: 'What\'s the difference between Short Stay, Monthly, and Long-Term?', a: 'Short Stay is nightly or weekly (like Airbnb). Monthly is 1 to 11 months, ideal for workers or diaspora visitors. Long-Term is 12 months and up, with a formal tenancy agreement. Hosts can enable one or more of these on each listing.' },
      { q: 'What is Instant Book?', a: 'Instant Book means your booking is confirmed automatically without waiting for host approval. Not all listings have this. Some hosts prefer to approve guests manually.' },
      { q: 'What happens if the property doesn\'t match the listing?', a: 'You have 24 hours after check-in to raise a dispute. Our team will review the case and may issue a partial or full refund depending on the findings.' },
      { q: 'Can I cancel my booking?', a: 'Yes, depending on the cancellation policy set by the host (Flexible, Moderate, or Strict). You\'ll see the policy clearly on the listing page before booking. Flexible allows full refunds if cancelled 24+ hours before check-in.' },
    ],
  },
  {
    id: 'verification',
    category: 'Verification',
    questions: [
      { q: 'Why do I need to verify my identity?', a: 'Ghana\'s rental market has historically suffered from fraud. ID verification helps us ensure every guest and host on FieGH is a real, accountable person. It protects everyone.' },
      { q: 'What ID is accepted?', a: 'We accept Ghana Card (NIA), Passport, and Voter ID. Hosts outside Ghana can use their national passport.' },
      { q: 'How long does verification take?', a: 'Usually within a few hours. Sometimes up to 24 hours. You\'ll be notified by SMS and in-app once approved.' },
    ],
  },
  {
    id: 'hosting',
    category: 'Hosting',
    questions: [
      { q: 'How much does it cost to list on FieGH?', a: 'Listing is completely free. We only charge 8% commission on successful payouts. No listing fees, no subscription.' },
      { q: 'What is Superhost status?', a: 'Superhost is automatically awarded to hosts with a 4.8+ average rating and at least 10 completed reviews. It shows as a gold badge on your profile and listings, and increases your bookings.' },
      { q: 'How do I get paid?', a: 'You get paid 24 hours after the guest checks in, via MTN MoMo (primary) or bank transfer (secondary). You\'ll see your net payout (after 8% commission) clearly in your dashboard.' },
      { q: 'For long-term rentals, how do I collect advance payment?', a: 'Set your advance payment requirement (e.g. 6 months) when creating the listing. FieGH clearly shows this to tenants before they apply. The advance amount is collected through the platform on acceptance.' },
    ],
  },
]

const ON_THIS_PAGE = [
  { id: 'ways-to-rent', label: 'Three ways to rent' },
  { id: 'trust', label: 'Rent with confidence' },
  ...FAQS.map(({ id, category }) => ({ id, label: category })),
]

const h2 = 'text-[1.5rem] md:text-[1.75rem] mb-5 scroll-mt-24'
const linkStyle = { color: 'var(--color-accent-deep)' }

export default function FAQPage() {
  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 md:pt-14 pb-16 md:pb-24">
        <header className="mb-10 md:mb-14">
          <h1 className="text-[2.25rem] md:text-[3rem]" style={{ color: 'var(--color-text-primary)' }}>
            Frequently asked questions
          </h1>
          <p className="mt-3 text-base md:text-lg max-w-[60ch]" style={{ color: 'var(--color-text-secondary)' }}>
            Everything you need to know about FieGH. For a step-by-step walkthrough, see{' '}
            <Link href="/how-it-works" className="focus-ring rounded-sm font-semibold underline underline-offset-4 decoration-1" style={linkStyle}>
              How it Works
            </Link>.
          </p>
        </header>

        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          {/* On this page */}
          <nav aria-label="On this page" className="hidden lg:block">
            <ul className="sticky top-24 space-y-2.5 text-sm">
              {ON_THIS_PAGE.map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="focus-ring rounded-sm font-medium hover:underline underline-offset-4"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-14 md:space-y-16">
            {/* ── Three ways to rent ── */}
            <section aria-labelledby="ways-to-rent">
              <h2 id="ways-to-rent" className={h2}>Three ways to rent</h2>
              <p className="mb-7 text-[15px] max-w-[60ch]" style={{ color: 'var(--color-text-secondary)' }}>
                Whether you need a place for a night or a year, there&apos;s a calm path to the right home.
              </p>
              <div
                className="grid grid-cols-1 md:grid-cols-3 border-t md:border-t-0 divide-y md:divide-y-0 md:divide-x divide-[var(--color-border)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {RENTAL_MODES.map(({ value, label, plural, icon: Icon }) => (
                  <div key={value} className="py-6 md:py-0 md:px-6 md:first:pl-0 md:last:pr-0 flex flex-col">
                    <Icon size={22} strokeWidth={1.75} aria-hidden style={{ color: 'var(--color-accent-deep)' }} />
                    <h3 className="mt-3 text-lg" style={{ color: 'var(--color-text-primary)' }}>{label}</h3>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-accent-deep)' }}>
                      {RENTAL_DETAILS[value].length}
                    </p>
                    <p className="mt-3 mb-4 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      {RENTAL_DETAILS[value].desc}
                    </p>
                    <Link
                      href={`/search?mode=${value}`}
                      className="focus-ring rounded-sm mt-auto self-start text-sm font-semibold underline underline-offset-4 decoration-1"
                      style={linkStyle}
                    >
                      Browse {plural}
                    </Link>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Rent with confidence ── */}
            <section aria-labelledby="trust">
              <h2 id="trust" className={h2}>Rent with confidence</h2>
              <p className="mb-7 text-[15px] max-w-[60ch]" style={{ color: 'var(--color-text-secondary)' }}>
                FieGH grew from Ghanaian culture, trust systems, and payment infrastructure, and that warmth shapes how we host.
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8">
                {TRUST.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex gap-4">
                    <Icon size={22} strokeWidth={1.75} aria-hidden className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent-deep)' }} />
                    <div>
                      <dt className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</dt>
                      <dd className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{desc}</dd>
                    </div>
                  </div>
                ))}
              </dl>

              <div
                className="mt-9 p-5 rounded-2xl flex items-start gap-3"
                style={{ backgroundColor: 'var(--color-accent-subtle)' }}
              >
                <ShieldAlert size={20} aria-hidden className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent-deep)' }} />
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
                  <strong>Stay safe:</strong> Never pay outside the FieGH app.
                  FieGH does not support direct bank transfers or cash payments. Report any host asking you
                  to pay outside the platform immediately.
                </p>
              </div>
            </section>

            {/* ── Questions ── */}
            {FAQS.map(({ id, category, questions }) => (
              <section key={id} aria-labelledby={id}>
                <h2 id={id} className={h2}>{category}</h2>
                <FaqAccordion questions={questions} />
              </section>
            ))}

            {/* ── Contact ── */}
            <section
              className="pt-9 border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div>
                <h2 className="text-xl mb-1">Still have questions?</h2>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  Our team is available via WhatsApp and email.
                </p>
              </div>
              <a
                href="mailto:hello@fiegh.com"
                className="pressable focus-ring self-start sm:self-auto flex-shrink-0 inline-flex items-center justify-center h-12 px-7 rounded-full text-sm font-bold whitespace-nowrap hover:bg-[var(--color-accent-hover)]"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
              >
                Contact support
              </a>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

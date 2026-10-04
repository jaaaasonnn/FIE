import Link from 'next/link'
import {
  Search, ClipboardList, MessageSquare, CalendarDays, Key, Star,
  UserPlus, Home, SlidersHorizontal, Bell, Wallet, BarChart3,
  type LucideIcon,
} from 'lucide-react'

type Step = { icon: LucideIcon; title: string; desc: string }

const guestSteps: Step[] = [
  { icon: Search, title: 'Browse & filter', desc: 'Search by rental mode (short stay, monthly, long-term), region, price, and amenities. Every listing clearly shows pricing and terms upfront.' },
  { icon: ClipboardList, title: 'Review the listing', desc: 'Read the full description, house rules, cancellation policy, and for permanent rentals, the advance payment requirement. No surprises.' },
  { icon: MessageSquare, title: 'Message the host', desc: 'Chat with the host directly in-app before booking. Ask questions, confirm details, get the welcome message.' },
  { icon: CalendarDays, title: 'Book & pay', desc: 'Submit your booking and pay via MTN MoMo, Vodafone Cash, AirtelTigo, or card. Funds are held in escrow and not released to the host until check-in.' },
  { icon: Key, title: 'Move in', desc: 'After confirmation, you get the full property address and host contact. Raise any dispute within 24 hours of check-in if the property doesn\'t match.' },
  { icon: Star, title: 'Review your stay', desc: 'After check-out, rate your experience. Reviews build trust across the FieGH community.' },
]

const hostSteps: Step[] = [
  { icon: UserPlus, title: 'Create your account', desc: 'Sign up with your phone number or email. Add your Ghana Card, Passport, or Voter ID to get the Verified Host badge.' },
  { icon: Home, title: 'List your property', desc: 'Add photos (up to 12), description, location, amenities, and set your pricing. Choose which rental modes to enable.' },
  { icon: SlidersHorizontal, title: 'Set your preferences', desc: 'Enable Instant Book for auto-confirmations, or choose Request to Book to approve guests manually. Set your cancellation policy and damage deposit.' },
  { icon: Bell, title: 'Receive bookings', desc: 'Get notified via SMS and in-app when a booking request arrives. For permanent rentals, review tenant applications before approving.' },
  { icon: Wallet, title: 'Get paid', desc: 'Payments are released to you 24 hours after guest check-in via MTN MoMo or bank transfer, minus the 8% platform commission.' },
  { icon: BarChart3, title: 'Manage & grow', desc: 'Track bookings, earnings, and reviews from your host dashboard. Hit 4.8+ rating with 10+ reviews to earn Superhost status.' },
]

const fees = [
  { label: 'Guest service fee', value: '12%', desc: 'Added on top of the listing price. This covers payment processing, escrow protection, and platform costs.' },
  { label: 'Host commission', value: '8%', desc: 'Deducted from your payout. You always see your net earnings before listing. No hidden surprises.' },
  { label: 'Damage deposit', value: 'Optional', desc: 'Set by host. Paid with your booking and held by FieGH. Returned after check-out if there is no damage claim.' },
]

const ink = { color: 'var(--color-text-primary)' }
const muted = { color: 'var(--color-text-secondary)' }
const rule = { borderColor: 'var(--color-border)' }

/** One audience's six steps: heading on the left, the numbered sequence on the right. */
function Steps({ id, heading, steps }: { id: string; heading: string; steps: Step[] }) {
  return (
    <section id={id} className="scroll-mt-24 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14 py-12 md:py-16 border-t" style={rule}>
      <div className="mb-8 lg:mb-0">
        <h2 className="text-[1.75rem] md:text-[2rem]" style={ink}>{heading}</h2>
      </div>
      <ol>
        {steps.map(({ icon: Icon, title, desc }, i) => (
          <li
            key={title}
            className={`grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 py-5 ${i > 0 ? 'border-t' : 'pt-0'}`}
            style={rule}
          >
            <span className="text-base font-bold tabular-nums pt-px" style={{ color: 'var(--color-accent-deep)' }}>{i + 1}</span>
            <div>
              <h3 className="flex items-center gap-2.5 text-base font-bold" style={ink}>
                <Icon size={17} strokeWidth={1.75} aria-hidden className="flex-shrink-0" />
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed max-w-[62ch]" style={muted}>{desc}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function HowItWorksPage() {
  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 md:pt-14 pb-16 md:pb-24">
        <header className="mb-10 md:mb-14">
          <h1 className="text-[2.25rem] md:text-[3rem]" style={ink}>
            How FieGH works
          </h1>
          <p className="mt-3 text-base md:text-lg max-w-[60ch]" style={muted}>
            Whether you&apos;re renting or hosting, we&apos;ve made it simple, safe, and rooted in trust.
          </p>
        </header>

        <Steps id="guests" heading="How to rent on FieGH" steps={guestSteps} />
        <Steps id="hosts" heading="How to host on FieGH" steps={hostSteps} />

        {/* Fees */}
        <section className="py-12 md:py-16 border-t" style={rule}>
          <h2 className="text-[1.75rem] md:text-[2rem] mb-8" style={ink}>Fee structure</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-y-8 sm:gap-x-10">
            {fees.map(({ label, value, desc }, i) => (
              <div key={label} className={i > 0 ? 'sm:border-l sm:pl-10' : ''} style={rule}>
                <dt className="text-sm font-semibold" style={ink}>{label}</dt>
                <dd className="mt-1 text-3xl font-bold" style={ink}>{value}</dd>
                <dd className="mt-2 text-sm leading-relaxed" style={muted}>{desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Next step */}
        <section className="pt-12 md:pt-16 border-t" style={rule}>
          <h2 className="text-[1.75rem] md:text-[2rem] mb-6" style={ink}>Ready to start?</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/search"
              className="pressable focus-ring inline-flex items-center justify-center px-7 h-12 rounded-full font-semibold text-sm hover:bg-[var(--color-accent-hover)]"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
              Find a property
            </Link>
            <Link href="/login?tab=signup&role=host"
              className="pressable focus-ring inline-flex items-center justify-center px-7 h-12 rounded-full font-semibold text-sm hover:bg-[var(--color-accent-subtle)]"
              style={{ border: '1px solid var(--color-border-strong)', color: 'var(--color-text-primary)' }}>
              Start hosting
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}

import { POLICIES, POLICY_LABELS, policyRuleLines } from '@/lib/cancellationPolicy'
import { DECISION_AIM, GUEST_REASONS, HOST_REASONS, MAX_EVIDENCE_PER_SIDE } from '@/lib/disputes'
import { GUEST_FEE_CHARGED, GUEST_FEE_LINE, HOST_COMMISSION_LINE, serviceFeeRefundRule } from '@/lib/fees'
import { SUPPORT_EMAIL } from '@/lib/contact'

// Built from the dispute rules in lib/disputes.ts
const list = (reasons: Record<string, string>) => Object.values(reasons).map((r) => r.toLowerCase()).join('; ')
const DISPUTE_TERMS =
  `A guest can report a problem from the booking on the check-in day or the day after, for one of these reasons: ${list(GUEST_REASONS)}. `
  + 'While a guest report is open, the host is not paid for that stay. '
  + `A host can report a problem on the check-out day or within the two days after, for one of these reasons: ${list(HOST_REASONS)}. A host report concerns the damage deposit. `
  + `Each side can report once per booking and attach up to ${MAX_EVIDENCE_PER_SIDE} photos, which only the guest, the host and FieGH can see. The other party can reply once. `
  + 'FieGH reads both sides and decides. For a guest report the outcome is a full refund of everything paid, a partial refund taken from the stay price (' + (GUEST_FEE_CHARGED ? 'the service fee is kept and ' : '') + 'the host is paid their share of the rest), or no refund. '
  + 'For a host report the deposit is returned to the guest or kept, in full or in part, for the host. '
  + `${DECISION_AIM} Decisions are final. Outside these times, or once a booking has a refund, contact support at ${SUPPORT_EMAIL}. `
  + 'Once the stay has started, a booking cannot be cancelled online.'

// Built from the same table the refund is worked out from, so the terms
// cannot drift from what the site does.
const policyText = (mode: string) => POLICIES.map((p) => `${POLICY_LABELS[p]}: ${policyRuleLines(mode, p).filter((l) => !l.startsWith('We never')).join(' ')}`).join(' ')
const CANCELLATION_TERMS =
  'Each listing has a cancellation policy chosen by the host: Flexible, Moderate or Strict. It is shown on the listing page, at checkout and on your booking, and the policy in force when you book is the one that applies to that booking. A guest can cancel online up to the day before check-in and sees the exact refund before confirming. '
  + `Short stays. ${policyText('SHORT_STAY')} `
  + `Monthly stays. ${policyText('TEMP_STAY')} `
  + `Long-term rentals. ${policyText('PERMANENT')} `
  + "For monthly and long-term stays we never keep more than one month's rent. "
  + (serviceFeeRefundRule('stay price or rent') ? `${serviceFeeRefundRule('stay price or rent')} ` : '')
  + 'The damage deposit is always refunded in full when a booking is cancelled before check-in. '
  + 'If a host cancels a confirmed booking, the guest is refunded everything they paid. '
  + 'Refunds go back to the card or mobile money number used to pay and can take up to 10 working days to arrive. '
  + `From the check-in day onwards a booking cannot be cancelled online; contact support at ${SUPPORT_EMAIL}.`

export default function TermsPage() {
  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <header className="max-w-3xl mx-auto px-4 pt-10 md:pt-14">
        <h1 className="text-[2.25rem] md:text-[3rem] mb-2" style={{ color: 'var(--color-text-primary)' }}>
          Terms of Service
        </h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>Last updated: January 2025, FieGH Platform</p>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-10 pb-16 md:pb-24 prose prose-stone">
        <div className="space-y-8 text-sm text-[#4A4540] leading-relaxed">
          {[
            {
              title: '1. Acceptance of Terms',
              body: 'By using FieGH ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Platform. FieGH is operated in Ghana and is subject to Ghanaian law.'
            },
            {
              title: '2. User Accounts',
              body: 'You must provide accurate information when creating an account. You are responsible for maintaining the security of your account. FieGH requires identity verification (Ghana Card, Passport, or Voter ID) before you can make bookings or list properties. False information may result in immediate account suspension.'
            },
            {
              title: '3. Listing and Booking',
              body: 'Hosts are responsible for ensuring that their listing descriptions, photos, and pricing are accurate. Guests book in good faith based on listed information. FieGH holds guest payments until after check-in. Double-bookings are prevented by the platform\'s calendar system.'
            },
            {
              title: '4. Payments and Fees',
              body: 'All payments are processed via Paystack or Mobile Money. ' + GUEST_FEE_LINE + ' ' + HOST_COMMISSION_LINE + ' All monetary amounts are stored in USD and displayed in both USD and GHS. The USD/GHS exchange rate is updated weekly by FieGH administrators. FieGH does not support cash payments or direct bank transfers outside the platform.'
            },
            {
              title: '5. Held payments and payouts',
              body: 'Guest payments are held by FieGH. For short stays, the host is paid 48 hours after check-in, unless the guest has reported a problem that is still open. Payouts for monthly and long-term rentals are made by our team. A damage deposit is paid with the booking, held by FieGH, and returned by our team after check-out.'
            },
            {
              title: '6. Reporting a problem',
              body: DISPUTE_TERMS
            },
            {
              title: '7. Prohibited Activities',
              body: 'You must not: attempt to circumvent the platform\'s payment system; include contact details in listing descriptions to solicit off-platform payment; create fake listings or fraudulent accounts; harass or discriminate against other users; use the platform for any illegal purpose.'
            },
            {
              title: '8. Cancellation policies and refunds',
              body: CANCELLATION_TERMS
            },
            {
              title: '9. Limitation of Liability',
              body: 'FieGH is a marketplace platform and is not responsible for the condition of properties, the conduct of hosts or guests, or any losses arising from transactions between users. FieGH holds payments and handles support requests in good faith but cannot guarantee outcomes.'
            },
            {
              title: '10. Changes to Terms',
              body: 'FieGH may update these terms at any time. Users will be notified via email and in-app notifications. Continued use of the platform after changes constitutes acceptance of the new terms.'
            },
            {
              title: '11. Contact',
              body: `For legal questions, or any other help, contact ${SUPPORT_EMAIL}.`
            },
          ].map(({ title, body }) => (
            <div key={title}>
              <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

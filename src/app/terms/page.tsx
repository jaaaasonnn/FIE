import { POLICIES, POLICY_LABELS, policyRuleLines } from '@/lib/cancellationPolicy'

// Built from the same table the refund is worked out from, so the terms
// cannot drift from what the site does.
const policyText = (mode: string) => POLICIES.map((p) => `${POLICY_LABELS[p]}: ${policyRuleLines(mode, p).filter((l) => !l.startsWith('We never')).join(' ')}`).join(' ')
const CANCELLATION_TERMS =
  'Each listing has a cancellation policy chosen by the host: Flexible, Moderate or Strict. It is shown on the listing page, at checkout and on your booking, and the policy in force when you book is the one that applies to that booking. A guest can cancel online up to the day before check-in and sees the exact refund before confirming. '
  + `Short stays. ${policyText('SHORT_STAY')} `
  + `Monthly stays. ${policyText('TEMP_STAY')} `
  + `Long-term rentals. ${policyText('PERMANENT')} `
  + "For monthly and long-term stays we never keep more than one month's rent. "
  + 'The service fee is refunded only when the whole stay price or rent is refunded. The damage deposit is always refunded in full when a booking is cancelled before check-in. '
  + 'If a host cancels a confirmed booking, the guest is refunded everything they paid. '
  + 'Refunds go back to the card or mobile money number used to pay and can take up to 10 working days to arrive. '
  + 'From the check-in day onwards a booking cannot be cancelled online; contact support at support@fiegh.com.'

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
              body: 'All payments are processed via Paystack or Mobile Money. FieGH charges a 12% service fee to guests and an 8% commission on host payouts. All monetary amounts are stored in USD and displayed in both USD and GHS. The USD/GHS exchange rate is updated weekly by FieGH administrators. FieGH does not support cash payments or direct bank transfers outside the platform.'
            },
            {
              title: '5. Held payments and payouts',
              body: 'Guest payments are held by FieGH. For short stays, the host is paid 24 hours after check-in. Payouts for monthly and long-term rentals are made by our team. A damage deposit is paid with the booking, held by FieGH, and returned by our team after check-out.'
            },
            {
              title: '6. Problems at check-in',
              body: 'If the property does not match the listing, contact support at support@fiegh.com within 24 hours of check-in. Our team will look at what both the guest and the host say. Once the stay has started, a booking cannot be cancelled online.'
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
              body: 'For legal inquiries, contact us at legal@fiegh.com. For general support, contact hello@fiegh.com.'
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

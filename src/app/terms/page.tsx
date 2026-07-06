export default function TermsPage() {
  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold mb-2" style={{ color: 'var(--cream)' }}>
            Terms of Service
          </h1>
          <p style={{ color: 'rgba(250,247,242,0.6)' }}>Last updated: January 2025 · FieGH Platform</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-16 prose prose-stone">
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
              body: 'Hosts are responsible for ensuring that their listing descriptions, photos, and pricing are accurate. Guests book in good faith based on listed information. FieGH provides escrow protection for all transactions. Double-bookings are prevented by the platform\'s calendar system.'
            },
            {
              title: '4. Payments and Fees',
              body: 'All payments are processed via Paystack or Mobile Money. FieGH charges a 12% service fee to guests and an 8% commission on host payouts. All monetary amounts are stored in USD and displayed in both USD and GHS. The USD/GHS exchange rate is updated weekly by FieGH administrators. FieGH does not support cash payments or direct bank transfers outside the platform.'
            },
            {
              title: '5. Escrow and Payouts',
              body: 'Guest payments are held in escrow until check-in is confirmed. For short stays, host payouts are released 24 hours after check-in. For long-term rentals, payouts follow the agreed schedule. Hosts can raise disputes within 48 hours of check-out regarding damage deposits.'
            },
            {
              title: '6. Disputes',
              body: 'Guests may raise a dispute within 24 hours of check-in if the property does not match the listing. FieGH will review evidence from both parties. FieGH\'s decision on disputes is final. Frivolous disputes may result in account warnings.'
            },
            {
              title: '7. Prohibited Activities',
              body: 'You must not: attempt to circumvent the platform\'s payment system; include contact details in listing descriptions to solicit off-platform payment; create fake listings or fraudulent accounts; harass or discriminate against other users; use the platform for any illegal purpose.'
            },
            {
              title: '8. Cancellation Policies',
              body: 'Each listing has a cancellation policy set by the host (Flexible, Moderate, or Strict). These policies are displayed clearly before booking and are binding. FieGH enforces these policies and handles refunds accordingly.'
            },
            {
              title: '9. Limitation of Liability',
              body: 'FieGH is a marketplace platform and is not responsible for the condition of properties, the conduct of hosts or guests, or any losses arising from transactions between users. FieGH provides the escrow and dispute systems in good faith but cannot guarantee outcomes.'
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

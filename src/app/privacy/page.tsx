export default function PrivacyPage() {
  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold mb-2" style={{ color: 'var(--cream)' }}>
            Privacy Policy
          </h1>
          <p style={{ color: 'rgba(250,247,242,0.6)' }}>Last updated: January 2025 · FieGH Platform</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="space-y-8 text-sm text-[#4A4540] leading-relaxed">
          {[
            {
              title: '1. Information We Collect',
              body: 'We collect: personal information (name, email, phone, nationality); identity documents (Ghana Card, Passport, Voter ID, selfie) for verification; booking and payment information; messages sent through the platform; device and usage data (IP address, browser, pages visited).'
            },
            {
              title: '2. How We Use Your Information',
              body: 'We use your information to: operate the FieGH platform; verify your identity; process payments and payouts; send booking confirmations and notifications via SMS and in-app; calculate trust scores; improve the platform through analytics; comply with Ghanaian law.'
            },
            {
              title: '3. Identity Document Security',
              body: 'Your Ghana Card, Passport, or Voter ID is only used for verification. It is stored securely and never shared with other users. Only authorized FieGH staff can access ID documents for verification purposes. Selfie images are used for identity matching only.'
            },
            {
              title: '4. Payment Data',
              body: 'Payment processing is handled by Paystack and mobile money operators (MTN, Vodafone, AirtelTigo). FieGH does not store raw card numbers. We store transaction references, amounts, and status for bookkeeping and dispute resolution.'
            },
            {
              title: '5. Sharing Your Information',
              body: 'We share limited information with: hosts (your name, profile photo, and trust score when you book); guests (host name, profile photo, verified status); Paystack and MoMo operators (for payment processing); government authorities (only when legally required). We do not sell your data to third parties.'
            },
            {
              title: '6. SMS and Notifications',
              body: 'We use Africa\'s Talking or Twilio to send SMS notifications for key events (booking confirmed, payment received, check-in reminders). You can opt out of non-critical SMS in your notification settings.'
            },
            {
              title: '7. Data Retention',
              body: 'We retain your account data as long as your account is active. Transaction records are kept for 7 years for financial compliance. ID verification records are retained for 3 years after account closure. You may request deletion of your account at any time.'
            },
            {
              title: '8. Your Rights',
              body: 'You have the right to: access your personal data; correct inaccurate information; delete your account; export your data; withdraw consent for optional processing. Contact privacy@fiegh.com to exercise these rights.'
            },
            {
              title: '9. Cookies',
              body: 'We use essential cookies for authentication and platform functionality. We do not use advertising cookies. You can manage cookies through your browser settings.'
            },
            {
              title: '10. Contact',
              body: 'For privacy inquiries, contact privacy@fiegh.com. For general support, contact hello@fiegh.com.'
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

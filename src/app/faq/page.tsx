'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const FAQS = [
  {
    category: 'General',
    questions: [
      { q: 'What does "Fie" mean?', a: '"Fie" (pronounced fee-yeh) means "home" in Twi, one of Ghana\'s most widely spoken languages. FieGH = Your Home in Ghana.' },
      { q: 'What regions does FieGH cover?', a: 'FieGH covers all 16 regions of Ghana including Greater Accra, Ashanti, Western, Central, Eastern, Volta, Northern, Upper East, Upper West, Brong-Ahafo, Oti, Savannah, Bono East, Ahafo, North East, and Western North.' },
      { q: 'Is FieGH only for Ghanaians?', a: 'No! FieGH is for anyone looking to rent in Ghana — locals, diaspora, expats, tourists, and business travellers. We accept international payments via card.' },
    ]
  },
  {
    category: 'Payments',
    questions: [
      { q: 'What payment methods are accepted?', a: 'We accept MTN Mobile Money, Vodafone Cash, AirtelTigo Money, and Visa/Mastercard debit or credit cards. All payments are processed via Paystack, Ghana\'s leading payment gateway.' },
      { q: 'Are my payments safe?', a: 'Yes. All payments are held in escrow until check-in is confirmed. The host only receives the money after you\'ve moved in. If there\'s a problem, you can raise a dispute within 24 hours of check-in.' },
      { q: 'What currencies are accepted?', a: 'Prices are listed in USD and shown in GHS (Ghana Cedis) for reference. MoMo payments are converted using the current exchange rate set by our admin team weekly.' },
      { q: 'Can I pay in Ghana Cedis?', a: 'Yes. When paying via MoMo, the amount is charged in GHS at the current exchange rate shown at checkout.' },
      { q: 'Why can\'t I pay outside the app?', a: 'For your protection. Cash and direct bank transfers have no protection. If you pay outside FieGH, we cannot help you recover funds in case of a scam. Always book and pay through the app.' },
    ]
  },
  {
    category: 'Bookings',
    questions: [
      { q: 'What\'s the difference between Short Stay, Temporary Stay, and Permanent Rental?', a: 'Short Stay is nightly or weekly (like Airbnb). Temporary Stay is monthly, 1–11 months, ideal for workers or diaspora visitors. Permanent Rental is 12+ months with a formal tenancy agreement. Hosts can enable one or more of these on each listing.' },
      { q: 'What is Instant Book?', a: 'Instant Book means your booking is confirmed automatically without waiting for host approval. Not all listings have this — some hosts prefer to approve guests manually.' },
      { q: 'What happens if the property doesn\'t match the listing?', a: 'You have 24 hours after check-in to raise a dispute. Our team will review the case and may issue a partial or full refund depending on the findings.' },
      { q: 'Can I cancel my booking?', a: 'Yes, depending on the cancellation policy set by the host (Flexible, Moderate, or Strict). You\'ll see the policy clearly on the listing page before booking. Flexible allows full refunds if cancelled 24+ hours before check-in.' },
    ]
  },
  {
    category: 'Verification',
    questions: [
      { q: 'Why do I need to verify my identity?', a: 'Ghana\'s rental market has historically suffered from fraud. ID verification helps us ensure every guest and host on FieGH is a real, accountable person. It protects everyone.' },
      { q: 'What ID is accepted?', a: 'We accept Ghana Card (NIA), Passport, and Voter ID. Hosts outside Ghana can use their national passport.' },
      { q: 'How long does verification take?', a: 'Usually within a few hours. Sometimes up to 24 hours. You\'ll be notified by SMS and in-app once approved.' },
    ]
  },
  {
    category: 'Hosting',
    questions: [
      { q: 'How much does it cost to list on FieGH?', a: 'Listing is completely free. We only charge 8% commission on successful payouts. No listing fees, no subscription.' },
      { q: 'What is Superhost status?', a: 'Superhost is automatically awarded to hosts with a 4.8+ average rating and at least 10 completed reviews. It shows as a gold badge on your profile and listings, and increases your bookings.' },
      { q: 'How do I get paid?', a: 'You get paid 24 hours after the guest checks in, via MTN MoMo (primary) or bank transfer (secondary). You\'ll see your net payout (after 8% commission) clearly in your dashboard.' },
      { q: 'For permanent rentals, how do I collect advance payment?', a: 'Set your advance payment requirement (e.g. 6 months) when creating the listing. FieGH clearly shows this to tenants before they apply. The advance amount is collected through the platform on acceptance.' },
    ]
  },
]

export default function FAQPage() {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-3" style={{ color: 'var(--cream)' }}>
            Frequently Asked Questions
          </h1>
          <p style={{ color: 'rgba(250,247,242,0.65)' }}>Everything you need to know about FieGH 🇬🇭</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-16">
        {FAQS.map(({ category, questions }) => (
          <div key={category} className="mb-10">
            <h2 className="text-xl font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>
              {category}
            </h2>
            <div className="space-y-2">
              {questions.map(({ q, a }) => {
                const key = `${category}-${q}`
                const isOpen = open === key
                return (
                  <div key={key} className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
                    <button
                      onClick={() => setOpen(isOpen ? null : key)}
                      className="w-full flex items-center justify-between p-5 text-left gap-3"
                    >
                      <span className="font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>{q}</span>
                      <ChevronDown
                        size={18}
                        className="flex-shrink-0 transition-transform"
                        style={{
                          color: 'var(--color-accent)',
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
                        }}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-5">
                        <p className="text-sm text-[#6B645C] leading-relaxed border-t border-stone-100 pt-3">{a}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div className="text-center mt-12 p-8 rounded-2xl" style={{ backgroundColor: 'var(--brown-dark)' }}>
          <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--cream)' }}>
            Still have questions?
          </h3>
          <p className="text-sm mb-5" style={{ color: 'rgba(250,247,242,0.6)' }}>
            Our team is available via WhatsApp and email.
          </p>
          <a href="mailto:hello@fiegh.com"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
            📧 Contact Support
          </a>
        </div>
      </div>
    </div>
  )
}

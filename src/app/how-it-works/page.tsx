import Link from 'next/link'

const guestSteps = [
  { num: '01', icon: '🔍', title: 'Browse & Filter', desc: 'Search by rental mode (short stay, monthly, long-term), region, price, and amenities. Every listing clearly shows pricing and terms upfront.' },
  { num: '02', icon: '📋', title: 'Review the Listing', desc: 'Read the full description, house rules, cancellation policy, and for permanent rentals — the advance payment requirement. No surprises.' },
  { num: '03', icon: '💬', title: 'Message the Host', desc: 'Chat with the host directly in-app before booking. Ask questions, confirm details, get the welcome message.' },
  { num: '04', icon: '📅', title: 'Book & Pay', desc: 'Submit your booking and pay via MTN MoMo, Vodafone Cash, AirtelTigo, or card. Funds are held in escrow — not released to host until check-in.' },
  { num: '05', icon: '🔑', title: 'Move In', desc: 'After confirmation, you get the full property address and host contact. Raise any dispute within 24 hours of check-in if the property doesn\'t match.' },
  { num: '06', icon: '⭐', title: 'Review Your Stay', desc: 'After check-out, rate your experience. Reviews build trust across the Ghana rental community.' },
]

const hostSteps = [
  { num: '01', icon: '📝', title: 'Create Your Account', desc: 'Sign up with your Ghana phone number or email. Add your Ghana Card, Passport, or Voter ID to get the Verified Host badge.' },
  { num: '02', icon: '🏡', title: 'List Your Property', desc: 'Add photos (up to 12), description, location, amenities, and set your pricing. Choose which rental modes to enable.' },
  { num: '03', icon: '⚡', title: 'Set Your Preferences', desc: 'Enable Instant Book for auto-confirmations, or choose Request to Book to approve guests manually. Set your cancellation policy and damage deposit.' },
  { num: '04', icon: '📲', title: 'Receive Bookings', desc: 'Get notified via SMS and in-app when a booking request arrives. For permanent rentals, review tenant applications before approving.' },
  { num: '05', icon: '💰', title: 'Get Paid', desc: 'Payments are released to you 24 hours after guest check-in via MTN MoMo or bank transfer, minus the 8% platform commission.' },
  { num: '06', icon: '📊', title: 'Manage & Grow', desc: 'Track bookings, earnings, and reviews from your host dashboard. Hit 4.8+ rating with 10+ reviews to earn Superhost status.' },
]

export default function HowItWorksPage() {
  return (
    <div style={{ backgroundColor: 'var(--cream)' }}>
      {/* Hero */}
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>
            Simple & Transparent
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-4" style={{ color: 'var(--cream)', fontFamily: 'Playfair Display, serif' }}>
            How FieGH Works 🇬🇭
          </h1>
          <p className="text-base" style={{ color: 'rgba(250,247,242,0.7)' }}>
            Whether you're renting or hosting, we've made it simple, safe, and built for Ghana.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-16">
        {/* Guest section */}
        <div className="mb-20" id="guests">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-4"
              style={{ backgroundColor: '#FFF8EE', color: 'var(--amber)', border: '1px solid var(--amber)' }}>
              👤 For Guests
            </div>
            <h2 className="text-3xl font-bold" style={{ color: 'var(--brown-dark)' }}>How to Rent on FieGH</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {guestSteps.map(({ num, icon, title, desc }) => (
              <div key={num} className="bg-white p-6 rounded-2xl border border-stone-100 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm"
                    style={{ backgroundColor: 'var(--brown-dark)', color: 'var(--gold)', fontFamily: 'Playfair Display, serif' }}>
                    {num}
                  </div>
                  <span className="text-2xl">{icon}</span>
                </div>
                <h3 className="font-bold mb-2" style={{ color: 'var(--brown-dark)' }}>{title}</h3>
                <p className="text-sm text-stone-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Host section */}
        <div className="mb-20" id="hosts">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-4"
              style={{ backgroundColor: '#F0FDF4', color: '#059669', border: '1px solid #6EE7B7' }}>
              🏡 For Hosts
            </div>
            <h2 className="text-3xl font-bold" style={{ color: 'var(--brown-dark)' }}>How to Host on FieGH</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {hostSteps.map(({ num, icon, title, desc }) => (
              <div key={num} className="bg-white p-6 rounded-2xl border border-stone-100 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm"
                    style={{ backgroundColor: '#065F46', color: '#6EE7B7', fontFamily: 'Playfair Display, serif' }}>
                    {num}
                  </div>
                  <span className="text-2xl">{icon}</span>
                </div>
                <h3 className="font-bold mb-2" style={{ color: 'var(--brown-dark)' }}>{title}</h3>
                <p className="text-sm text-stone-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Fee breakdown */}
        <div className="bg-white rounded-2xl border border-stone-100 p-8 mb-16">
          <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--brown-dark)' }}>Fee Structure</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { label: 'Guest Service Fee', value: '12%', desc: 'Added on top of the listing price. This covers payment processing, escrow protection, and platform costs.', color: 'var(--amber)' },
              { label: 'Host Commission', value: '8%', desc: 'Deducted from your payout. You always see your net earnings before listing. No hidden surprises.', color: '#059669' },
              { label: 'Damage Deposit', value: 'Optional', desc: 'Set by host. Collected at booking, held in escrow, returned within 48 hours of check-out unless a dispute is raised.', color: '#2563EB' },
            ].map(({ label, value, desc, color }) => (
              <div key={label} className="text-center p-5 rounded-2xl" style={{ backgroundColor: '#F9FAFB' }}>
                <p className="text-3xl font-bold mb-1" style={{ color, fontFamily: 'Playfair Display, serif' }}>{value}</p>
                <p className="font-semibold mb-2" style={{ color: 'var(--brown-dark)' }}>{label}</p>
                <p className="text-xs text-stone-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <h2 className="text-3xl font-bold mb-4" style={{ color: 'var(--brown-dark)' }}>Ready to Start?</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/search"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full font-semibold text-sm"
              style={{ backgroundColor: 'var(--amber)', color: '#fff' }}>
              Find a Property 🔍
            </Link>
            <Link href="/auth/signup?role=host"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full font-semibold text-sm border-2"
              style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
              Start Hosting 🏡
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

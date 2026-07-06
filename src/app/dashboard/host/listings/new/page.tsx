'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { GHANA_REGIONS, PROPERTY_TYPES, AMENITIES_LIST, RENTAL_MODES } from '@/lib/utils'

const STEPS = ['Property Info', 'Location', 'Pricing', 'Amenities & Rules', 'Photos', 'Review']

export default function NewListingPage() {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const [form, setForm] = useState({
    title: '', description: '', propertyType: '',
    region: '', city: '', neighbourhood: '',
    bedrooms: '1', bathrooms: '1', maxGuests: '2',
    rentalModes: [] as string[],
    priceNightly: '', priceMonthly: '', priceAnnual: '',
    advanceMonthsRequired: '6',
    amenities: [] as string[],
    rules: [] as string[],
    cancellationPolicy: 'FLEXIBLE',
    instantBook: false,
    minStayNights: '1',
    damageDeposit: '',
    welcomeMessage: ''
  })

  function toggleMode(m: string) {
    setForm((f) => ({
      ...f,
      rentalModes: f.rentalModes.includes(m) ? f.rentalModes.filter((x) => x !== m) : [...f.rentalModes, m]
    }))
  }

  function toggleAmenity(a: string) {
    setForm((f) => ({
      ...f,
      amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a]
    }))
  }

  async function handleSubmit() {
    setLoading(true)
    await new Promise((r) => setTimeout(r, 1500))
    router.push('/dashboard/host')
  }

  const step0 = (
    <div className="space-y-5">
      <Input label="Property Title" placeholder="e.g. Modern 3-Bedroom Apartment in East Legon"
        value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
      <Textarea label="Description" placeholder="Describe your property — what makes it special, what's nearby..."
        value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <Select label="Property Type" value={form.propertyType}
        onChange={(e) => setForm({ ...form, propertyType: e.target.value })}
        options={[{ value: '', label: 'Select type...' }, ...PROPERTY_TYPES.map((t) => ({ value: t, label: t }))]} />
      <div className="grid grid-cols-3 gap-3">
        <Select label="Bedrooms" value={form.bedrooms}
          onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
          options={[1,2,3,4,5,6,7,8].map((n) => ({ value: String(n), label: String(n) }))} />
        <Select label="Bathrooms" value={form.bathrooms}
          onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
          options={[1,2,3,4,5].map((n) => ({ value: String(n), label: String(n) }))} />
        <Select label="Max Guests" value={form.maxGuests}
          onChange={(e) => setForm({ ...form, maxGuests: e.target.value })}
          options={[1,2,3,4,5,6,7,8,10,12,15].map((n) => ({ value: String(n), label: String(n) }))} />
      </div>
    </div>
  )

  const step1 = (
    <div className="space-y-5">
      <Select label="Region" value={form.region}
        onChange={(e) => setForm({ ...form, region: e.target.value })}
        options={[{ value: '', label: 'Select region...' }, ...GHANA_REGIONS.map((r) => ({ value: r, label: r }))]} />
      <Input label="City / Town" placeholder="e.g. Accra, Kumasi, Takoradi"
        value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
      <Input label="Neighbourhood (optional)" placeholder="e.g. East Legon, Cantonments"
        value={form.neighbourhood} onChange={(e) => setForm({ ...form, neighbourhood: e.target.value })} />
      <div className="p-4 rounded-xl border border-dashed border-stone-300 text-center">
        <div className="text-2xl mb-2">📍</div>
        <p className="text-sm font-medium text-stone-700">Map Pin (Coming Soon)</p>
        <p className="text-xs text-stone-500">You will be able to drop a precise map pin for your property.</p>
      </div>
    </div>
  )

  const step2 = (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--brown-dark)' }}>Rental Modes (select all that apply)</p>
        <div className="space-y-3">
          {Object.entries(RENTAL_MODES).map(([key, { label, desc, icon }]) => (
            <button key={key} type="button" onClick={() => toggleMode(key)}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all"
              style={{
                borderColor: form.rentalModes.includes(key) ? 'var(--amber)' : '#E5E7EB',
                backgroundColor: form.rentalModes.includes(key) ? '#FFF8EE' : '#fff'
              }}>
              <span className="text-2xl">{icon}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>{label}</p>
                <p className="text-xs text-stone-500">{desc}</p>
              </div>
              {form.rentalModes.includes(key) ? <CheckSquare size={20} style={{ color: 'var(--amber)' }} /> : <Square size={20} className="text-stone-300" />}
            </button>
          ))}
        </div>
      </div>

      {form.rentalModes.includes('SHORT_STAY') && (
        <div className="space-y-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
          <h4 className="font-semibold text-sm" style={{ color: 'var(--brown-dark)' }}>🌙 Short Stay Pricing</h4>
          <Input label="Price per Night (USD $)" type="number" placeholder="e.g. 80"
            value={form.priceNightly} onChange={(e) => setForm({ ...form, priceNightly: e.target.value })} />
          <Select label="Minimum Stay" value={form.minStayNights}
            onChange={(e) => setForm({ ...form, minStayNights: e.target.value })}
            options={[1,2,3,5,7].map((n) => ({ value: String(n), label: `${n} night${n > 1 ? 's' : ''}` }))} />
        </div>
      )}

      {form.rentalModes.includes('TEMP_STAY') && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50">
          <h4 className="font-semibold text-sm mb-3" style={{ color: '#1E40AF' }}>📅 Temporary Stay Pricing</h4>
          <Input label="Price per Month (USD $)" type="number" placeholder="e.g. 800"
            value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} />
        </div>
      )}

      {form.rentalModes.includes('PERMANENT') && (
        <div className="p-4 rounded-xl border border-green-200 bg-green-50 space-y-3">
          <h4 className="font-semibold text-sm" style={{ color: '#065F46' }}>🏠 Permanent Rental Pricing</h4>
          <Input label="Annual Rent (USD $)" type="number" placeholder="e.g. 9600"
            value={form.priceAnnual} onChange={(e) => setForm({ ...form, priceAnnual: e.target.value })} />
          <Select label="Advance Payment Required (months)" value={form.advanceMonthsRequired}
            onChange={(e) => setForm({ ...form, advanceMonthsRequired: e.target.value })}
            options={[1,2,3,6,12].map((n) => ({ value: String(n), label: `${n} month${n > 1 ? 's' : ''} advance` }))} />
          <p className="text-xs text-green-700">
            ⚠️ This will be shown clearly to tenants before they apply.
          </p>
        </div>
      )}

      <div>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--brown-dark)' }}>Cancellation Policy</p>
        <div className="grid grid-cols-3 gap-2">
          {['FLEXIBLE', 'MODERATE', 'STRICT'].map((p) => (
            <button key={p} type="button" onClick={() => setForm({ ...form, cancellationPolicy: p })}
              className="py-3 px-2 rounded-xl border-2 text-xs font-medium transition-all"
              style={{
                borderColor: form.cancellationPolicy === p ? 'var(--amber)' : '#E5E7EB',
                backgroundColor: form.cancellationPolicy === p ? '#FFF8EE' : '#fff',
                color: form.cancellationPolicy === p ? 'var(--amber)' : '#6B7280'
              }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <Input label="Refundable Damage Deposit (USD $, optional)" type="number" placeholder="e.g. 200"
        value={form.damageDeposit} onChange={(e) => setForm({ ...form, damageDeposit: e.target.value })} />

      <div className="flex items-center justify-between p-4 rounded-xl border border-stone-200 bg-white">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--brown-dark)' }}>⚡ Instant Book</p>
          <p className="text-xs text-stone-500">Auto-confirm guest bookings without manual approval</p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ ...form, instantBook: !form.instantBook })}
          className="w-12 h-6 rounded-full transition-all relative"
          style={{ backgroundColor: form.instantBook ? 'var(--amber)' : '#D1D5DB' }}
        >
          <span className="absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm"
            style={{ left: form.instantBook ? '28px' : '4px' }} />
        </button>
      </div>
    </div>
  )

  const step3 = (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--brown-dark)' }}>Amenities</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AMENITIES_LIST.map((a) => (
            <button key={a} type="button" onClick={() => toggleAmenity(a)}
              className="flex items-center gap-2 p-3 rounded-xl border text-xs text-left transition-all"
              style={{
                borderColor: form.amenities.includes(a) ? 'var(--amber)' : '#E5E7EB',
                backgroundColor: form.amenities.includes(a) ? '#FFF8EE' : '#fff',
                color: form.amenities.includes(a) ? 'var(--amber)' : '#374151'
              }}>
              {form.amenities.includes(a) ? <CheckSquare size={14} /> : <Square size={14} className="text-stone-300" />}
              {a}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--brown-dark)' }}>House Rules</p>
        <div className="grid grid-cols-2 gap-2">
          {['No smoking', 'No parties or events', 'No pets', 'Quiet hours after 10pm', 'No unregistered guests', 'No cooking with open fire'].map((r) => {
            const active = form.rules.includes(r)
            return (
              <button key={r} type="button"
                onClick={() => setForm((f) => ({ ...f, rules: active ? f.rules.filter((x) => x !== r) : [...f.rules, r] }))}
                className="flex items-center gap-2 p-3 rounded-xl border text-xs text-left transition-all"
                style={{
                  borderColor: active ? '#FCA5A5' : '#E5E7EB',
                  backgroundColor: active ? '#FEE2E2' : '#fff',
                  color: active ? '#991B1B' : '#374151'
                }}>
                {active ? '✗' : '+'} {r}
              </button>
            )
          })}
        </div>
      </div>

      <Textarea label="Automated Welcome Message (optional)" placeholder="e.g. Welcome to my place! The WiFi password is..."
        value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })} />
    </div>
  )

  const step4 = (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">Upload up to 12 photos. First photo is your cover image.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <label key={i} className="aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all hover:border-amber-400"
            style={{ borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' }}>
            <input type="file" accept="image/*" className="hidden" />
            <Upload size={24} className="text-stone-400 mb-2" />
            <span className="text-xs text-stone-400">{i === 0 ? 'Cover photo' : `Photo ${i + 1}`}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-stone-500">JPG or PNG, max 10MB each. Use bright, well-lit photos for better bookings.</p>
    </div>
  )

  const step5 = (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-white border border-stone-100">
        <h4 className="font-bold mb-4" style={{ color: 'var(--brown-dark)' }}>Listing Summary</h4>
        <div className="space-y-3 text-sm">
          {[
            ['Title', form.title || '—'],
            ['Type', form.propertyType || '—'],
            ['Location', [form.neighbourhood, form.city, form.region].filter(Boolean).join(', ') || '—'],
            ['Bedrooms', `${form.bedrooms} beds, ${form.bathrooms} baths, max ${form.maxGuests} guests`],
            ['Rental Modes', form.rentalModes.join(', ') || '—'],
            ['Nightly Price', form.priceNightly ? `$${form.priceNightly}` : '—'],
            ['Monthly Price', form.priceMonthly ? `$${form.priceMonthly}` : '—'],
            ['Annual Price', form.priceAnnual ? `$${form.priceAnnual}` : '—'],
            ['Instant Book', form.instantBook ? 'Yes' : 'No'],
            ['Cancellation', form.cancellationPolicy],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-stone-500">{k}</span>
              <span className="font-medium text-right" style={{ color: 'var(--brown-dark)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 rounded-xl flex items-start gap-3"
        style={{ backgroundColor: '#FBE8BB', border: '1px solid var(--gold)' }}>
        <span className="text-lg">💡</span>
        <p className="text-sm" style={{ color: 'var(--brown-dark)' }}>
          Your listing will be reviewed before going live. Typical review time is under 24 hours.
        </p>
      </div>
    </div>
  )

  const stepContent = [step0, step1, step2, step3, step4, step5]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--cream)' }}>
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--brown-dark)' }}>List Your Property</h1>
        <p className="text-stone-600 text-sm mb-8">Fill in the details to get your property live on FieGH 🇬🇭</p>

        {/* Progress */}
        <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-shrink-0">
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold cursor-pointer transition-all"
                onClick={() => i < step && setStep(i)}
                style={{
                  backgroundColor: i <= step ? 'var(--brown-dark)' : '#E5E7EB',
                  color: i <= step ? 'var(--gold)' : '#9CA3AF'
                }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs hidden sm:block ${i === step ? 'font-semibold' : 'text-stone-400'}`}
                style={{ color: i === step ? 'var(--brown-dark)' : undefined }}>
                {s}
              </span>
              {i < STEPS.length - 1 && <div className="w-6 h-px mx-1" style={{ backgroundColor: '#E5E7EB' }} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-white rounded-2xl border border-stone-100 p-6 shadow-sm mb-6">
          <h3 className="text-lg font-bold mb-5" style={{ color: 'var(--brown-dark)' }}>
            Step {step + 1}: {STEPS[step]}
          </h3>
          {stepContent[step]}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0}>
            ← Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)}>
              Continue →
            </Button>
          ) : (
            <Button onClick={handleSubmit} loading={loading}>
              Submit Listing 🏡
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

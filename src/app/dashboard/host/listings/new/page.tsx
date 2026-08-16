'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ScrollHintRow } from '@/components/ui/ScrollHintRow'
import { ListingPhotoManager } from '@/components/ui/ListingPhotoManager'
import { GHANA_REGIONS, PROPERTY_TYPES, AMENITIES_LIST, RENTAL_MODES } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const STEPS = ['Property Info', 'Location', 'Pricing', 'Amenities & Rules', 'Photos', 'Review']

// Index of the Photos step — the listing gets created right before this
// step so photo uploads have a real listingId to attach to, rather than
// holding raw files in memory for the whole wizard.
const PHOTOS_STEP = 4

export default function NewListingPage() {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [stepError, setStepError] = useState('')
  const [listingId, setListingId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

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

  // Shared by the early create (right before the Photos step) and the
  // final publish (Review step) — same fields, just POST vs PATCH.
  function buildListingPayload() {
    return {
      title: form.title.trim(),
      description: form.description,
      propertyType: form.propertyType,
      region: form.region,
      city: form.city.trim(),
      neighbourhood: form.neighbourhood || null,
      bedrooms: parseInt(form.bedrooms, 10),
      bathrooms: parseInt(form.bathrooms, 10),
      maxGuests: parseInt(form.maxGuests, 10),
      rentalModes: form.rentalModes,
      priceNightly: form.priceNightly ? parseFloat(form.priceNightly) : null,
      priceMonthly: form.priceMonthly ? parseFloat(form.priceMonthly) : null,
      priceAnnual: form.priceAnnual ? parseFloat(form.priceAnnual) : null,
      advanceMonthsRequired: form.advanceMonthsRequired ? parseInt(form.advanceMonthsRequired, 10) : null,
      amenities: form.amenities,
      rules: form.rules,
      cancellationPolicy: form.cancellationPolicy,
      instantBook: form.instantBook,
      minStayNights: parseInt(form.minStayNights, 10) || 1,
      damageDeposit: form.damageDeposit ? parseFloat(form.damageDeposit) : null,
      welcomeMessage: form.welcomeMessage || null,
    }
  }

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

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!form.title.trim()) return 'Please enter a property title.'
      if (!form.propertyType) return 'Please select a property type.'
    }
    if (s === 1) {
      if (!form.region) return 'Please select a region.'
      if (!form.city.trim()) return 'Please enter a city / town.'
    }
    if (s === 2) {
      if (form.rentalModes.length === 0) return 'Select at least one rental mode.'
      if (form.rentalModes.includes('SHORT_STAY') && !form.priceNightly) {
        return 'Enter a nightly price for Short Stay.'
      }
      if (form.rentalModes.includes('TEMP_STAY') && !form.priceMonthly) {
        return 'Enter a monthly price for Temporary Stay.'
      }
      if (form.rentalModes.includes('PERMANENT') && !form.priceAnnual) {
        return 'Enter an annual rent for Permanent Rental.'
      }
    }
    return null
  }

  async function handleContinue() {
    const msg = validateStep(step)
    if (msg) {
      setStepError(msg)
      return
    }
    setStepError('')

    // Create the listing right before the Photos step so uploads have a
    // real listingId to attach to, instead of holding raw files in memory
    // for the rest of the wizard. Starts inactive — it won't show up in
    // search until the host reaches the end and publishes it.
    if (step === PHOTOS_STEP - 1 && !listingId) {
      if (authLoading) {
        setStepError('Still checking your session — please wait a moment and try again.')
        return
      }
      if (!user) {
        setStepError('You must be signed in to create a listing.')
        router.push('/login?redirect=/dashboard/host/listings/new')
        return
      }

      setLoading(true)
      try {
        const res = await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...buildListingPayload(), isActive: false }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setStepError(data.error || `Could not save your progress (${res.status}). Please try again.`)
          return
        }
        setListingId(data.listing.id)
      } catch {
        setStepError('Network error. Please check your connection and try again.')
        return
      } finally {
        setLoading(false)
      }
    }

    setStep(step + 1)
  }

  async function handleSubmit() {
    setError('')
    setStepError('')

    for (let s = 0; s <= 2; s++) {
      const msg = validateStep(s)
      if (msg) {
        setStep(s)
        setStepError(msg)
        setError(msg)
        return
      }
    }

    if (authLoading) {
      setError('Still checking your session — please wait a moment and try again.')
      return
    }
    if (!user) {
      setError('You must be signed in to create a listing.')
      router.push('/login?redirect=/dashboard/host/listings/new')
      return
    }

    setLoading(true)
    try {
      // The listing was already created (as a draft) before the Photos
      // step in the common case — publishing just updates it with the
      // latest form values and flips it active, rather than creating a
      // second listing. listingId can still be null here if that earlier
      // create somehow never ran (e.g. the host jumped straight to this
      // step some other way), so fall back to a fresh create.
      const url    = listingId ? `/api/listings/${listingId}` : '/api/listings'
      const method = listingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildListingPayload(), isActive: true }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || `Could not publish your listing (${res.status}). Please try again.`)
        return
      }

      const finalId = data.listing?.id ?? listingId
      if (finalId) {
        router.push(`/dashboard/host?created=${finalId}`)
      } else {
        router.push('/dashboard/host')
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
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
        <p className="text-sm font-medium text-[#4A4540]">Map Pin (Coming Soon)</p>
        <p className="text-xs text-[#6B645C]">You will be able to drop a precise map pin for your property.</p>
      </div>
    </div>
  )

  const step2 = (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>Rental Modes (select all that apply)</p>
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
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{label}</p>
                <p className="text-xs text-[#6B645C]">{desc}</p>
              </div>
              {form.rentalModes.includes(key) ? <CheckSquare size={20} style={{ color: 'var(--color-accent)' }} /> : <Square size={20} className="text-stone-300" />}
            </button>
          ))}
        </div>
      </div>

      {form.rentalModes.includes('SHORT_STAY') && (
        <div className="space-y-3 p-4 rounded-xl border border-[#E5D0A8] bg-[#FAF5EC]">
          <h4 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>🌙 Short Stay Pricing</h4>
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
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>Cancellation Policy</p>
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
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>⚡ Instant Book</p>
          <p className="text-xs text-[#6B645C]">Auto-confirm guest bookings without manual approval</p>
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
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>Amenities</p>
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
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>House Rules</p>
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

  const step4 = listingId ? (
    <ListingPhotoManager listingId={listingId} photos={photos} onPhotosChange={setPhotos} />
  ) : (
    <p className="text-sm text-[#6B645C]">Saving your progress…</p>
  )

  const step5 = (
    <div className="space-y-4">
      <div className="soft-panel p-5">
        <h4 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Listing Summary</h4>
        <div className="space-y-3 text-sm">
          {[
            ['Title', form.title || '—'],
            ['Type', form.propertyType || '—'],
            ['Location', [form.neighbourhood, form.city, form.region].filter(Boolean).join(', ') || '—'],
            ['Bedrooms', `${form.bedrooms} beds, ${form.bathrooms} baths, max ${form.maxGuests} guests`],
            ['Rental Modes', form.rentalModes.join(', ') || '—'],
            ['Photos', `${photos.length} uploaded`],
            ['Nightly Price', form.priceNightly ? `$${form.priceNightly}` : '—'],
            ['Monthly Price', form.priceMonthly ? `$${form.priceMonthly}` : '—'],
            ['Annual Price', form.priceAnnual ? `$${form.priceAnnual}` : '—'],
            ['Instant Book', form.instantBook ? 'Yes' : 'No'],
            ['Cancellation', form.cancellationPolicy],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-[#6B645C]">{k}</span>
              <span className="font-medium text-right" style={{ color: 'var(--color-text-primary)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 rounded-xl flex items-start gap-3"
        style={{ backgroundColor: '#FBE8BB', border: '1px solid var(--gold)' }}>
        <span className="text-lg">💡</span>
        <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Your listing will be reviewed before going live. Typical review time is under 24 hours.
        </p>
      </div>
    </div>
  )

  const stepContent = [step0, step1, step2, step3, step4, step5]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>List Your Property</h1>
        <p className="text-[#6B645C] text-sm mb-8">Fill in the details to get your property live on FieGH.</p>

        {/* Progress */}
        <ScrollHintRow className="mb-8" rowClassName="items-center gap-1 pb-2" fadeColor="var(--color-bg)" activeIndex={step}>
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
        </ScrollHintRow>

        {/* Step content */}
        <div className="soft-panel p-6 mb-6">
          <h3 className="text-lg font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>
            Step {step + 1}: {STEPS[step]}
          </h3>
          {stepContent[step]}
        </div>

        {(stepError || error) && (
          <div
            className="mb-4 rounded-xl px-4 py-3 text-sm font-medium"
            style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
            role="alert"
          >
            {error || stepError}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (step > 0) {
                setStepError('')
                setError('')
                setStep(step - 1)
              }
            }}
            disabled={step === 0 || loading}
          >
            ← Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={handleContinue}>
              Continue →
            </Button>
          ) : (
            <Button onClick={handleSubmit} loading={loading} disabled={authLoading || loading}>
              Submit Listing 🏡
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

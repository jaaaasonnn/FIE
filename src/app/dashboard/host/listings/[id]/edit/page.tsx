'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckSquare, Square, Eye, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { GHANA_REGIONS, PROPERTY_TYPES, AMENITIES_LIST } from '@/lib/utils'

// Pre-filled with mock data for the listing being edited
const MOCK_LISTING = {
  title: 'Luxury 3-Bedroom Apartment in East Legon',
  description: 'Welcome to this beautifully furnished luxury apartment in the heart of East Legon...',
  propertyType: 'Apartment',
  region: 'Greater Accra',
  city: 'Accra',
  neighbourhood: 'East Legon',
  bedrooms: '3', bathrooms: '2', maxGuests: '6',
  rentalModes: ['SHORT_STAY', 'TEMP_STAY'],
  priceNightly: '120', priceMonthly: '2200', priceAnnual: '',
  advanceMonthsRequired: '6',
  amenities: ['WiFi', 'Generator/Inverter', 'Air Conditioning', 'Swimming Pool', 'Parking', 'CCTV'],
  rules: ['No smoking', 'No parties or events'],
  cancellationPolicy: 'MODERATE',
  instantBook: true,
  minStayNights: '2',
  damageDeposit: '200',
  welcomeMessage: 'Welcome! The gate code is 2024#. WiFi: FieGH_EastLegon / Password: Welcome2024!',
  isActive: true
}

export default function EditListingPage() {
  const params = useParams()
  const router = useRouter()
  const [form, setForm] = useState(MOCK_LISTING)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  function toggleMode(m: string) {
    setForm((f) => ({ ...f, rentalModes: f.rentalModes.includes(m) ? f.rentalModes.filter((x) => x !== m) : [...f.rentalModes, m] }))
  }
  function toggleAmenity(a: string) {
    setForm((f) => ({ ...f, amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a] }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await new Promise((r) => setTimeout(r, 1000))
    setLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--cream)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-8 px-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>
              Edit Listing
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>
              {form.title}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/listings/${params.id}`}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-full"
              style={{ backgroundColor: 'rgba(245,192,106,0.2)', color: 'var(--gold)', border: '1px solid rgba(245,192,106,0.3)' }}>
              <Eye size={13} /> Preview
            </Link>
            <Link href="/dashboard/host"
              className="text-xs px-3 py-2 rounded-full text-stone-400 border border-white/20 hover:bg-white/10">
              ← Dashboard
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {saved && (
          <div className="p-4 rounded-xl mb-6 text-sm" style={{ backgroundColor: '#D1FAE5', color: '#065F46', border: '1px solid #6EE7B7' }}>
            ✅ Listing saved successfully!
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Basic info */}
          <div className="bg-white rounded-2xl border border-stone-100 p-6">
            <h3 className="font-bold mb-5" style={{ color: 'var(--brown-dark)' }}>Basic Information</h3>
            <div className="space-y-4">
              <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <div className="grid grid-cols-2 gap-4">
                <Select label="Property Type" value={form.propertyType}
                  onChange={(e) => setForm({ ...form, propertyType: e.target.value })}
                  options={PROPERTY_TYPES.map((t) => ({ value: t, label: t }))} />
                <Select label="Cancellation Policy" value={form.cancellationPolicy}
                  onChange={(e) => setForm({ ...form, cancellationPolicy: e.target.value })}
                  options={['FLEXIBLE', 'MODERATE', 'STRICT'].map((p) => ({ value: p, label: p }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Select label="Bedrooms" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
                  options={[1,2,3,4,5,6,7,8].map((n) => ({ value: String(n), label: String(n) }))} />
                <Select label="Bathrooms" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
                  options={[1,2,3,4,5].map((n) => ({ value: String(n), label: String(n) }))} />
                <Select label="Max Guests" value={form.maxGuests} onChange={(e) => setForm({ ...form, maxGuests: e.target.value })}
                  options={[1,2,3,4,5,6,7,8,10,12,15].map((n) => ({ value: String(n), label: String(n) }))} />
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="bg-white rounded-2xl border border-stone-100 p-6">
            <h3 className="font-bold mb-5" style={{ color: 'var(--brown-dark)' }}>Location</h3>
            <div className="space-y-4">
              <Select label="Region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
                options={GHANA_REGIONS.map((r) => ({ value: r, label: r }))} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="City / Town" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                <Input label="Neighbourhood" value={form.neighbourhood} onChange={(e) => setForm({ ...form, neighbourhood: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-white rounded-2xl border border-stone-100 p-6">
            <h3 className="font-bold mb-5" style={{ color: 'var(--brown-dark)' }}>Rental Modes & Pricing</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'SHORT_STAY', label: '🌙 Short Stay' },
                  { key: 'TEMP_STAY', label: '📅 Monthly' },
                  { key: 'PERMANENT', label: '🏠 Long-Term' },
                ].map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => toggleMode(key)}
                    className="py-2.5 rounded-xl border-2 text-xs font-medium transition-all"
                    style={{
                      borderColor: form.rentalModes.includes(key) ? 'var(--amber)' : '#E5E7EB',
                      backgroundColor: form.rentalModes.includes(key) ? '#FFF8EE' : '#fff',
                      color: form.rentalModes.includes(key) ? 'var(--amber)' : '#6B7280'
                    }}>
                    {label}
                  </button>
                ))}
              </div>
              {form.rentalModes.includes('SHORT_STAY') && (
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Price per Night ($)" type="number" value={form.priceNightly} onChange={(e) => setForm({ ...form, priceNightly: e.target.value })} />
                  <Select label="Min Stay (nights)" value={form.minStayNights} onChange={(e) => setForm({ ...form, minStayNights: e.target.value })}
                    options={[1,2,3,5,7].map((n) => ({ value: String(n), label: `${n} night${n > 1 ? 's' : ''}` }))} />
                </div>
              )}
              {form.rentalModes.includes('TEMP_STAY') && (
                <Input label="Price per Month ($)" type="number" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} />
              )}
              {form.rentalModes.includes('PERMANENT') && (
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Annual Rent ($)" type="number" value={form.priceAnnual} onChange={(e) => setForm({ ...form, priceAnnual: e.target.value })} />
                  <Select label="Advance Months Required" value={form.advanceMonthsRequired}
                    onChange={(e) => setForm({ ...form, advanceMonthsRequired: e.target.value })}
                    options={[1,2,3,6,12].map((n) => ({ value: String(n), label: `${n} month${n > 1 ? 's' : ''}` }))} />
                </div>
              )}
              <Input label="Damage Deposit ($, optional)" type="number" value={form.damageDeposit} onChange={(e) => setForm({ ...form, damageDeposit: e.target.value })} />
            </div>
          </div>

          {/* Amenities */}
          <div className="bg-white rounded-2xl border border-stone-100 p-6">
            <h3 className="font-bold mb-4" style={{ color: 'var(--brown-dark)' }}>Amenities</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {AMENITIES_LIST.map((a) => (
                <button key={a} type="button" onClick={() => toggleAmenity(a)}
                  className="flex items-center gap-2 p-2.5 rounded-xl border text-xs text-left transition-all"
                  style={{
                    borderColor: form.amenities.includes(a) ? 'var(--amber)' : '#E5E7EB',
                    backgroundColor: form.amenities.includes(a) ? '#FFF8EE' : '#fff',
                    color: form.amenities.includes(a) ? 'var(--amber)' : '#374151'
                  }}>
                  {form.amenities.includes(a) ? <CheckSquare size={13} /> : <Square size={13} className="text-stone-300" />}
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Welcome message & settings */}
          <div className="bg-white rounded-2xl border border-stone-100 p-6">
            <h3 className="font-bold mb-4" style={{ color: 'var(--brown-dark)' }}>Settings</h3>
            <div className="space-y-4">
              <Textarea label="Automated Welcome Message" value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
                placeholder="Sent to guests automatically after booking confirmation..." />
              <div className="flex items-center justify-between p-4 rounded-xl border border-stone-200">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--brown-dark)' }}>⚡ Instant Book</p>
                  <p className="text-xs text-stone-500">Auto-confirm bookings without manual approval</p>
                </div>
                <button type="button" onClick={() => setForm({ ...form, instantBook: !form.instantBook })}
                  className="w-12 h-6 rounded-full transition-all relative"
                  style={{ backgroundColor: form.instantBook ? 'var(--amber)' : '#D1D5DB' }}>
                  <span className="absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm"
                    style={{ left: form.instantBook ? '28px' : '4px' }} />
                </button>
              </div>
              <div className="flex items-center justify-between p-4 rounded-xl border border-stone-200">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--brown-dark)' }}>Listing Active</p>
                  <p className="text-xs text-stone-500">Toggle off to temporarily hide from search</p>
                </div>
                <button type="button" onClick={() => setForm({ ...form, isActive: !form.isActive })}
                  className="w-12 h-6 rounded-full transition-all relative"
                  style={{ backgroundColor: form.isActive ? '#059669' : '#D1D5DB' }}>
                  <span className="absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm"
                    style={{ left: form.isActive ? '28px' : '4px' }} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="submit" size="lg" loading={loading} className="flex-1">
              Save Changes
            </Button>
            <button
              type="button"
              className="flex items-center gap-2 px-5 py-3 rounded-full text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => router.push('/dashboard/host')}>
              <Trash2 size={15} /> Delete Listing
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

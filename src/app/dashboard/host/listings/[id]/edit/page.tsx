'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckSquare, Square, Eye, Trash2, AlertTriangle, X, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ListingPhotoManager } from '@/components/ui/ListingPhotoManager'
import { GHANA_REGIONS, PROPERTY_TYPES, AMENITIES_LIST } from '@/lib/utils'

type FormState = {
  title: string
  description: string
  propertyType: string
  region: string
  city: string
  neighbourhood: string
  bedrooms: string
  bathrooms: string
  maxGuests: string
  rentalModes: string[]
  priceNightly: string
  priceMonthly: string
  priceAnnual: string
  advanceMonthsRequired: string
  amenities: string[]
  rules: string[]
  cancellationPolicy: string
  instantBook: boolean
  minStayNights: string
  damageDeposit: string
  welcomeMessage: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  title: '', description: '', propertyType: 'Apartment', region: 'Greater Accra',
  city: '', neighbourhood: '', bedrooms: '1', bathrooms: '1', maxGuests: '2',
  rentalModes: [], priceNightly: '', priceMonthly: '', priceAnnual: '',
  advanceMonthsRequired: '', amenities: [], rules: [], cancellationPolicy: 'MODERATE',
  instantBook: false, minStayNights: '1', damageDeposit: '', welcomeMessage: '', isActive: true,
}

export default function EditListingPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()

  const [form,      setForm]      = useState<FormState>(EMPTY_FORM)
  const [photos,    setPhotos]    = useState<string[]>([])
  const [fetching,  setFetching]  = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [saveError, setSaveError] = useState('')

  const [hostId, setHostId] = useState('')
  const [upcomingBookingCount, setUpcomingBookingCount] = useState(0)
  const [deleteOpen,    setDeleteOpen]    = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteError,   setDeleteError]   = useState('')

  useEffect(() => {
    if (!params.id) return
    fetch(`/api/listings/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        const l = data.listing ?? data
        if (!l?.id) { setFetchError('Listing not found.'); return }
        if (l.hostId) setHostId(l.hostId)

        const parseJson = (v: unknown): string[] => {
          if (Array.isArray(v))  return v as string[]
          if (typeof v === 'string') { try { return JSON.parse(v) } catch { return [] } }
          return []
        }

        setForm({
          title:                  l.title                ?? '',
          description:            l.description          ?? '',
          propertyType:           l.propertyType         ?? 'Apartment',
          region:                 l.region               ?? 'Greater Accra',
          city:                   l.city                 ?? '',
          neighbourhood:          l.neighbourhood        ?? '',
          bedrooms:               String(l.bedrooms      ?? 1),
          bathrooms:              String(l.bathrooms     ?? 1),
          maxGuests:              String(l.maxGuests     ?? 2),
          rentalModes:            parseJson(l.rentalModes),
          priceNightly:           l.priceNightly  != null ? String(l.priceNightly)  : '',
          priceMonthly:           l.priceMonthly  != null ? String(l.priceMonthly)  : '',
          priceAnnual:            l.priceAnnual   != null ? String(l.priceAnnual)   : '',
          advanceMonthsRequired:  l.advanceMonthsRequired != null ? String(l.advanceMonthsRequired) : '',
          amenities:              parseJson(l.amenities),
          rules:                  parseJson(l.rules),
          cancellationPolicy:     l.cancellationPolicy   ?? 'MODERATE',
          instantBook:            l.instantBook          ?? false,
          minStayNights:          String(l.minStayNights ?? 1),
          damageDeposit:          l.damageDeposit != null ? String(l.damageDeposit) : '',
          welcomeMessage:         l.welcomeMessage       ?? '',
          isActive:               l.isActive             ?? true,
        })
        setPhotos(parseJson(l.photos))
      })
      .catch(() => setFetchError('Failed to load listing. Please try again.'))
      .finally(() => setFetching(false))
  }, [params.id])

  // Surfaced in the delete-confirmation dialog so a host isn't surprised by
  // deactivating a listing a guest is actively counting on — doesn't block
  // the delete, just makes sure they see it before confirming.
  useEffect(() => {
    if (!hostId || !params.id) return
    fetch(`/api/bookings?hostId=${hostId}&listingId=${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        const bookings: Array<{ status: string; checkOut: string }> = Array.isArray(data.bookings) ? data.bookings : []
        const now = Date.now()
        const count = bookings.filter((b) =>
          (b.status === 'CONFIRMED' || b.status === 'PENDING') && new Date(b.checkOut).getTime() >= now
        ).length
        setUpcomingBookingCount(count)
      })
      .catch(() => setUpcomingBookingCount(0))
  }, [hostId, params.id])

  async function handleDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/listings/${params.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete listing')
      router.push('/dashboard/host')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete listing')
      setDeleting(false)
    }
  }

  function toggleMode(m: string) {
    setForm((f) => ({ ...f, rentalModes: f.rentalModes.includes(m) ? f.rentalModes.filter((x) => x !== m) : [...f.rentalModes, m] }))
  }
  function toggleAmenity(a: string) {
    setForm((f) => ({ ...f, amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a] }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setSaveError('')
    setSaved(false)

    const body = {
      title:                  form.title,
      description:            form.description,
      propertyType:           form.propertyType,
      region:                 form.region,
      city:                   form.city,
      neighbourhood:          form.neighbourhood || null,
      bedrooms:               parseInt(form.bedrooms),
      bathrooms:              parseInt(form.bathrooms),
      maxGuests:              parseInt(form.maxGuests),
      rentalModes:            form.rentalModes,
      priceNightly:           form.priceNightly           ? parseFloat(form.priceNightly)           : null,
      priceMonthly:           form.priceMonthly           ? parseFloat(form.priceMonthly)           : null,
      priceAnnual:            form.priceAnnual            ? parseFloat(form.priceAnnual)            : null,
      advanceMonthsRequired:  form.advanceMonthsRequired  ? parseInt(form.advanceMonthsRequired)    : null,
      amenities:              form.amenities,
      rules:                  form.rules,
      cancellationPolicy:     form.cancellationPolicy,
      instantBook:            form.instantBook,
      minStayNights:          parseInt(form.minStayNights),
      damageDeposit:          form.damageDeposit          ? parseFloat(form.damageDeposit)          : null,
      welcomeMessage:         form.welcomeMessage || null,
      isActive:               form.isActive,
    }

    try {
      const res  = await fetch(`/api/listings/${params.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error ?? `Save failed (${res.status}). Please try again.`)
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setSaveError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin mx-auto mb-4"
            style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading listing…</p>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-5xl">🔍</div>
        <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{fetchError}</p>
        <Link href="/dashboard/host"
          className="px-6 py-3 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
          ← Back to Dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
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
              style={{ backgroundColor: 'rgba(245,192,106,0.2)', color: 'var(--color-accent)', border: '1px solid rgba(245,192,106,0.3)' }}>
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
        {saveError && (
          <div className="p-4 rounded-xl mb-6 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' }}>
            ❌ {saveError}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Basic info */}
          <div className="soft-panel p-6">
            <h3 className="font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Basic Information</h3>
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
          <div className="soft-panel p-6">
            <h3 className="font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Location</h3>
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
          <div className="soft-panel p-6">
            <h3 className="font-bold mb-5" style={{ color: 'var(--color-text-primary)' }}>Rental Modes & Pricing</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'SHORT_STAY', label: '🌙 Short Stay' },
                  { key: 'TEMP_STAY',  label: '📅 Monthly'    },
                  { key: 'PERMANENT',  label: '🏠 Long-Term'  },
                ].map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => toggleMode(key)}
                    className="py-2.5 rounded-xl border-2 text-xs font-medium transition-all"
                    style={{
                      borderColor:     form.rentalModes.includes(key) ? 'var(--amber)' : '#E5E7EB',
                      backgroundColor: form.rentalModes.includes(key) ? '#FFF8EE'      : '#fff',
                      color:           form.rentalModes.includes(key) ? 'var(--amber)'  : '#6B7280',
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

          {/* Photos */}
          <div className="soft-panel p-6">
            <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Photos</h3>
            <ListingPhotoManager listingId={params.id} photos={photos} onPhotosChange={setPhotos} />
          </div>

          {/* Amenities */}
          <div className="soft-panel p-6">
            <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Amenities</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {AMENITIES_LIST.map((a) => (
                <button key={a} type="button" onClick={() => toggleAmenity(a)}
                  className="flex items-center gap-2 p-2.5 rounded-xl border text-xs text-left transition-all"
                  style={{
                    borderColor:     form.amenities.includes(a) ? 'var(--amber)' : '#E5E7EB',
                    backgroundColor: form.amenities.includes(a) ? '#FFF8EE'      : '#fff',
                    color:           form.amenities.includes(a) ? 'var(--amber)'  : '#374151',
                  }}>
                  {form.amenities.includes(a) ? <CheckSquare size={13} /> : <Square size={13} className="text-stone-300" />}
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Welcome message & settings */}
          <div className="soft-panel p-6">
            <h3 className="font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Settings</h3>
            <div className="space-y-4">
              <Textarea label="Automated Welcome Message" value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
                placeholder="Sent to guests automatically after booking confirmation..." />
              <div className="flex items-center justify-between p-4 rounded-xl border border-stone-200">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>⚡ Instant Book</p>
                  <p className="text-xs text-[#6B645C]">Auto-confirm bookings without manual approval</p>
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
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Listing Active</p>
                  <p className="text-xs text-[#6B645C]">Toggle off to temporarily hide from search</p>
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
              onClick={() => { setDeleteError(''); setDeleteOpen(true) }}>
              <Trash2 size={15} /> Delete Listing
            </button>
          </div>
        </form>
      </div>

      <Dialog.Root open={deleteOpen} onOpenChange={(o) => { if (!deleting) setDeleteOpen(o) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md rounded-2xl bg-white shadow-2xl focus:outline-none"
            aria-describedby={undefined}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEE2E2' }}>
                    <AlertTriangle size={17} style={{ color: '#991B1B' }} />
                  </div>
                  <Dialog.Title className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    Delete this listing?
                  </Dialog.Title>
                </div>
                <Dialog.Close
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-stone-100 flex-shrink-0"
                  aria-label="Close"
                  disabled={deleting}
                >
                  <X size={16} style={{ color: 'var(--color-text-secondary)' }} />
                </Dialog.Close>
              </div>

              <p className="text-sm mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                This removes the listing from search and stops it accepting new bookings. This can&apos;t be undone from here.
              </p>

              {upcomingBookingCount > 0 && (
                <div className="mt-3 p-3 rounded-xl text-sm" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                  This listing has {upcomingBookingCount} upcoming booking{upcomingBookingCount === 1 ? '' : 's'}. {upcomingBookingCount === 1 ? 'It' : 'They'}{' '}
                  won&apos;t be cancelled, but the listing will disappear from search right away.
                </div>
              )}

              {deleteError && (
                <p className="text-sm mt-3" style={{ color: '#991B1B' }}>{deleteError}</p>
              )}

              <div className="flex gap-3 mt-5">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    disabled={deleting}
                    className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold border border-stone-200 text-[#374151] hover:bg-stone-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: '#B91C1C' }}
                >
                  {deleting ? <Loader2 size={16} className="animate-spin" /> : null}
                  {deleting ? 'Deleting…' : 'Delete Listing'}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

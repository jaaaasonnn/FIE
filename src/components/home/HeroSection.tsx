'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { Search, Minus, Plus } from 'lucide-react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { GHANA_REGIONS } from '@/lib/utils'
import { RENTAL_MODES, type RentalMode } from '@/lib/rentalModes'

export type ModePhoto = {
  src: string
  srcSet?: string
  sizes?: string
  alt: string
  /** CSS object-position, for photos whose subject is off-centre. */
  position?: string
  /** Set when the photo is a real listing, so the caption can link to it. */
  listingId?: string
  location?: string
}

type Party = { adults: number; children: number; infants: number; pets: number }

const PARTY_ROWS: { key: keyof Party; label: string; hint: string; max: number }[] = [
  { key: 'adults',   label: 'Adults',   hint: 'Ages 13 and up', max: 16 },
  { key: 'children', label: 'Children', hint: 'Ages 2 to 12',   max: 10 },
  { key: 'infants',  label: 'Infants',  hint: 'Under 2',        max: 5 },
  { key: 'pets',     label: 'Pets',     hint: 'Ask the host about house rules', max: 5 },
]

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function Stepper({
  label, hint, value, min = 0, max, onChange,
}: {
  label: string; hint: string; value: number; min?: number; max: number
  onChange: (next: number) => void
}) {
  const btn =
    'pressable focus-ring w-9 h-9 rounded-full flex items-center justify-center border disabled:opacity-35 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{label}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={btn}
          style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-primary)' }}
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
        >
          <Minus size={15} />
        </button>
        <span className="w-5 text-center text-sm font-semibold tabular-nums" aria-live="polite">{value}</span>
        <button
          type="button"
          className={btn}
          style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-primary)' }}
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`More ${label.toLowerCase()}`}
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  )
}

export function HeroSection({ photos }: { photos: Record<RentalMode, ModePhoto> }) {
  const router = useRouter()
  const [mode, setMode] = useState<RentalMode>('SHORT_STAY')
  const [region, setRegion] = useState('')
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [party, setParty] = useState<Party>({ adults: 0, children: 0, infants: 0, pets: 0 })
  const [whoOpen, setWhoOpen] = useState(false)

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const whoRef = useRef<HTMLDivElement>(null)
  const whoButtonRef = useRef<HTMLButtonElement>(null)

  const isLease = mode === 'PERMANENT'
  const people = party.adults + party.children

  // Close the Who popover on outside click or Escape
  useEffect(() => {
    if (!whoOpen) return
    function onPointer(e: MouseEvent) {
      if (whoRef.current && !whoRef.current.contains(e.target as Node)) setWhoOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setWhoOpen(false)
        whoButtonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [whoOpen])

  // Radio-group keyboard behaviour: arrows move and select, Home/End jump
  function onTabKeyDown(e: React.KeyboardEvent) {
    const current = RENTAL_MODES.findIndex((m) => m.value === mode)
    let next = current
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % RENTAL_MODES.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + RENTAL_MODES.length) % RENTAL_MODES.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = RENTAL_MODES.length - 1
    else return
    e.preventDefault()
    setMode(RENTAL_MODES[next].value)
    tabRefs.current[next]?.focus()
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams({ mode })
    if (region) params.set('region', region)
    if (startDate) params.set('checkIn', format(startDate, 'yyyy-MM-dd'))
    if (people > 0) params.set('guests', String(people))
    router.push(`/search?${params.toString()}`)
  }

  let whoSummary = ''
  if (isLease) {
    whoSummary = people > 0 ? plural(people, 'occupant', 'occupants') : ''
  } else {
    whoSummary = [
      people > 0 && plural(people, 'guest', 'guests'),
      party.infants > 0 && plural(party.infants, 'infant', 'infants'),
      party.pets > 0 && plural(party.pets, 'pet', 'pets'),
    ].filter(Boolean).join(', ')
  }

  const fieldLabel = 'block text-xs font-bold mb-0.5'
  const fieldControl = 'focus-ring w-full text-sm bg-transparent border-none outline-none rounded-md truncate text-left'

  return (
    <section style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 md:pt-9 pb-4 flex flex-col">

        {/* No visible headline: the page opens on the selector. The h1 stays
            for screen readers and document structure. */}
        <h1 className="sr-only">Find your fie: homes to rent in Ghana</h1>

        {/* ── Rental type: one segmented pill, a real radio group ── */}
        <div
          role="radiogroup"
          aria-label="Rental type"
          onKeyDown={onTabKeyDown}
          className="hero-enter self-start w-full sm:w-auto flex p-1 bg-white border rounded-full"
          style={{ borderColor: 'var(--color-border)', '--i': 0 } as React.CSSProperties}
        >
          {RENTAL_MODES.map(({ value, label, icon: Icon }, i) => {
            const checked = mode === value
            return (
              <button
                key={value}
                ref={(el) => { tabRefs.current[i] = el }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setMode(value)}
                className="mode-segment focus-ring flex-1 sm:flex-none h-10 sm:h-11 px-2 sm:px-6 flex items-center justify-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-semibold rounded-full whitespace-nowrap"
              >
                <Icon size={17} strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>

        {/* ── Search: Where / Check-in or Move-in / Who ── */}
        <form
          onSubmit={handleSearch}
          className="hero-enter relative z-10 order-3 md:order-2 mt-4 md:mt-5 md:max-w-4xl bg-white border rounded-2xl md:rounded-full md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
          style={{
            borderColor: 'var(--color-border)',
            boxShadow: '0 6px 24px rgba(31, 27, 22, 0.07)',
            '--i': 1,
          } as React.CSSProperties}
        >
          <div className="px-5 md:pl-8 md:pr-5 py-3">
            <label htmlFor="hero-where" className={fieldLabel} style={{ color: 'var(--color-text-primary)' }}>
              Where
            </label>
            <select
              id="hero-where"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className={`${fieldControl} appearance-none cursor-pointer`}
              style={{ color: region ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
            >
              <option value="">Anywhere in Ghana</option>
              {GHANA_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div
            className="hero-datepicker px-5 py-3 border-t md:border-t-0 md:border-l"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <label htmlFor="hero-date" className={fieldLabel} style={{ color: 'var(--color-text-primary)' }}>
              {mode === 'SHORT_STAY' ? 'Check-in' : 'Move-in'}
            </label>
            <DatePicker
              id="hero-date"
              selected={startDate}
              onChange={(d: Date | null) => setStartDate(d)}
              placeholderText="Add a date"
              minDate={new Date()}
              dateFormat="d MMM yyyy"
              className={`${fieldControl} cursor-pointer`}
              calendarClassName="fiegh-cal"
              showPopperArrow={false}
              popperPlacement="bottom-start"
            />
          </div>

          <div
            ref={whoRef}
            className="relative px-5 py-3 border-t md:border-t-0 md:border-l"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <span id="hero-who-label" className={fieldLabel} style={{ color: 'var(--color-text-primary)' }}>
              {isLease ? 'Occupants' : 'Who'}
            </span>
            <button
              ref={whoButtonRef}
              type="button"
              aria-labelledby="hero-who-label hero-who-value"
              aria-haspopup="dialog"
              aria-expanded={whoOpen}
              onClick={() => setWhoOpen((o) => !o)}
              className={`${fieldControl} cursor-pointer`}
              style={{ color: whoSummary ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
            >
              <span id="hero-who-value">
                {whoSummary || (isLease ? 'Add occupants' : 'Add guests')}
              </span>
            </button>

            {whoOpen && (
              <div
                role="dialog"
                aria-label={isLease ? 'Occupants' : 'Guests'}
                className="who-popover absolute z-20 top-full mt-3 left-0 right-0 md:left-auto md:w-80 bg-white border rounded-2xl px-5 py-2"
                style={{
                  borderColor: 'var(--color-border)',
                  boxShadow: '0 16px 48px rgba(31, 27, 22, 0.14)',
                }}
              >
                {isLease ? (
                  <Stepper
                    label="Occupants"
                    hint="Everyone who will live in the home"
                    value={people}
                    max={16}
                    onChange={(next) =>
                      setParty((p) => {
                        const diff = next - (p.adults + p.children)
                        if (diff > 0) return { ...p, adults: p.adults + diff }
                        // Remove from adults first, then children
                        const fromAdults = Math.min(p.adults, -diff)
                        return { ...p, adults: p.adults - fromAdults, children: p.children - (-diff - fromAdults) }
                      })
                    }
                  />
                ) : (
                  <div className="divide-y divide-[var(--color-border)]">
                    {PARTY_ROWS.map(({ key, label, hint, max }) => (
                      <Stepper
                        key={key}
                        label={label}
                        hint={hint}
                        value={party[key]}
                        max={max}
                        onChange={(next) => setParty((p) => ({ ...p, [key]: next }))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-3 md:p-2 border-t md:border-t-0" style={{ borderColor: 'var(--color-border)' }}>
            <button
              type="submit"
              className="pressable focus-ring w-full md:w-auto h-12 px-6 rounded-full flex items-center justify-center gap-2 text-sm font-bold whitespace-nowrap hover:bg-[var(--color-accent-hover)]"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}
            >
              <Search size={17} strokeWidth={2.25} aria-hidden />
              Search
            </button>
          </div>
        </form>

        {/* ── Photo panels: one whole home per rental type ──
            Pointer shortcut for the tabs above; keyboard and screen-reader
            users select with the radio group, so these stay out of the tab order. */}
        <div
          className="mode-panels order-2 md:order-3 mt-4 md:mt-7"
        >
          {RENTAL_MODES.map(({ value, label }) => {
            const photo = photos[value]
            const active = mode === value
            return (
              <figure key={value} className="mode-panel" data-active={active}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={() => setMode(value)}
                  className="block w-full rounded-2xl overflow-hidden relative aspect-[4/3] md:aspect-auto md:h-[clamp(20rem,52vh,34rem)]"
                  style={{ backgroundColor: 'var(--color-border)', cursor: active ? 'default' : 'pointer' }}
                >
                  <img
                    src={photo.src}
                    srcSet={photo.srcSet}
                    sizes={photo.sizes}
                    alt=""
                    className="mode-panel-photo absolute inset-0 w-full h-full object-cover"
                    style={{ objectPosition: photo.position }}
                    fetchPriority={value === 'SHORT_STAY' ? 'high' : 'low'}
                    decoding="async"
                  />
                </button>
                <figcaption className="mt-3 flex items-baseline gap-2.5 text-sm min-w-0">
                  <span className="font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {label}
                  </span>
                  {active && photo.listingId && photo.location && (
                    <Link
                      href={`/listings/${photo.listingId}`}
                      aria-label={`View ${photo.alt}`}
                      className="focus-ring rounded-sm truncate underline underline-offset-4 decoration-1"
                      style={{ color: 'var(--color-accent-deep)' }}
                    >
                      {photo.location}
                    </Link>
                  )}
                </figcaption>
              </figure>
            )
          })}
        </div>
      </div>
    </section>
  )
}

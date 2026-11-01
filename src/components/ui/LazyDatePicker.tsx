'use client'

import { useRef, useState, type CSSProperties } from 'react'
import { RefreshCw } from 'lucide-react'
import { LOAD_FAILED } from '@/lib/clientFetch'
import { useOnDemand } from '@/lib/useOnDemand'

// A date field that fetches the date picker (react-datepicker and date-fns, about 45 KB compressed) only
// when someone reaches for it (G5). Until then it is the same input, in the same wrapper, so nothing moves
// when the picker takes its place. Pointing at it or touching it starts the fetch; a click, a tap or
// keyboard focus also opens the calendar as soon as it has arrived. If it does not arrive, "Try again".
//
// A pointer opens it on the click, never on the focus that comes with pressing down: the picker must not
// replace the input half way through a click, or the rest of the click lands on nothing and it stays shut.

const loadPicker = () => import('@/components/ui/DatePickerLoaded')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "09 Mar 2027", as the picker writes it ("dd MMM yyyy"). The picker's dates are local midnights. */
export function pickerLabel(d: Date | null | undefined): string {
  return d ? `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : ''
}

// The picker's own wrapper styles (react-datepicker.css), so the input sits exactly where it will be
const WRAPPER: CSSProperties = { display: 'inline-block', padding: 0, border: 0 }
const CONTAINER: CSSProperties = { position: 'relative', display: 'inline-block', width: '100%' }

type Props = {
  /** The input's accessible name, such as "Check-in date" */
  label: string
  inputStyle: CSSProperties
  selected: Date | null
  onChange: (d: Date | null) => void
  placeholderText: string
  minDate?: Date
  maxDate?: Date
  excludeDates?: Date[]
  selectsStart?: boolean
  selectsEnd?: boolean
  startDate?: Date
  endDate?: Date
  popperPlacement?: 'bottom-start' | 'bottom-end'
}

export function LazyDatePicker({ label, inputStyle, ...picker }: Props) {
  const [wanted, setWanted] = useState(false)
  // Opened at least once: only then does the picker take the input's place (fetching early is fine)
  const [opened, setOpened] = useState(false)
  const { mod, failed, retry } = useOnDemand(loadPicker, wanted)
  const pressing = useRef(false)

  if (mod && opened) {
    const DatePicker = mod.default
    return (
      <DatePicker {...picker} dateFormat="dd MMM yyyy" wrapperClassName="w-full" startOpen autoFocus
        customInput={<input aria-label={label} style={inputStyle} readOnly />} />
    )
  }

  const open = () => { setWanted(true); setOpened(true) }
  return (
    <>
      <div className="react-datepicker-wrapper w-full" style={WRAPPER}>
        <div className="react-datepicker__input-container" style={CONTAINER}>
          <input aria-label={label} style={inputStyle} readOnly placeholder={picker.placeholderText}
            value={pickerLabel(picker.selected)} aria-busy={opened && !failed}
            onPointerEnter={() => setWanted(true)}
            onPointerDown={() => { pressing.current = true; setWanted(true) }}
            onFocus={() => { if (!pressing.current) open() }}
            onClick={() => { pressing.current = false; open() }} />
        </div>
      </div>
      {failed && (
        <div role="alert" className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{LOAD_FAILED}</span>
          <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-semibold underline">
            <RefreshCw size={12} aria-hidden="true" /> Try again
          </button>
        </div>
      )}
    </>
  )
}

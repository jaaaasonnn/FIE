import { Moon, CalendarDays, Key, type LucideIcon } from 'lucide-react'

export type RentalMode = 'SHORT_STAY' | 'TEMP_STAY' | 'PERMANENT'

/** The three ways to rent, in the order and wording used across the site. */
export const RENTAL_MODES: {
  value: RentalMode
  label: string
  plural: string
  icon: LucideIcon
}[] = [
  { value: 'SHORT_STAY', label: 'Short Stay', plural: 'short stays',     icon: Moon },
  { value: 'TEMP_STAY',  label: 'Monthly',    plural: 'monthly lets',    icon: CalendarDays },
  { value: 'PERMANENT',  label: 'Long-Term',  plural: 'long-term homes', icon: Key },
]

/** Icon per rental type, for labels that only have the stored value. */
export const MODE_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  RENTAL_MODES.map(({ value, icon }) => [value, icon]),
)

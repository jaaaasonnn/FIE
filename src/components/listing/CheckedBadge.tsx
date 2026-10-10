import { ClipboardCheck } from 'lucide-react'
import { CHECK_BADGE, checkExplanation, type PublicCheck } from '@/lib/listingCheckRules'

/**
 * "Address and photos checked", shown on a listing whose check still stands.
 * The same words everywhere it appears. Hovering, or reading it with a screen
 * reader, gives the whole meaning: what was checked, when, and that it is not
 * proof of ownership or a guarantee. The server decides whether a listing has
 * a check; with none, nothing is drawn.
 */
export function CheckedBadge({ check, className = '' }: { check: PublicCheck | null | undefined; className?: string }) {
  if (!check) return null
  const meaning = checkExplanation(check)
  return (
    <span title={meaning}
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}
      style={{ backgroundColor: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' }}>
      <ClipboardCheck size={12} aria-hidden />
      {CHECK_BADGE}
      <span className="sr-only">. {meaning}</span>
    </span>
  )
}

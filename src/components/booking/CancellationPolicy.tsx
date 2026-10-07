import { POLICY_LABELS, asPolicy, commonRuleLines, policyRuleLines } from '@/lib/cancellationPolicy'

// Wording shared by every page that talks about what happens to a guest's
// money. Each sentence says only what the code does.

/** Where the money sits. Only short stays have an automatic host payout so far. */
export function heldNote(rentalMode: string): string {
  return rentalMode === 'SHORT_STAY'
    ? 'Your payment is held by FieGH and paid to the host 48 hours after check-in.'
    : 'Your payment is held by FieGH.'
}

// A guest reports a problem from the booking itself (lib/disputes.ts); the
// window is the check-in day and the day after.
export const SUPPORT_NOTE = 'If anything is wrong when you arrive, report a problem from your booking by the end of the day after check-in.'

/**
 * The cancellation policy for one rental type: its name, the refund rule for
 * each amount of notice, and the rules that hold under every policy. The
 * sentences come from the same table the refund is worked out from.
 */
export function CancellationPolicy({
  policy, rentalMode, className = '', compact = false,
}: {
  policy: string | null | undefined
  rentalMode: string
  className?: string
  /** Smaller text, for the booking summary column */
  compact?: boolean
}) {
  const p = asPolicy(policy)
  const text = compact ? 'text-xs' : 'text-sm'
  return (
    <div className={className}>
      <p className={`${compact ? 'text-sm' : 'text-base'} font-semibold`} style={{ color: 'var(--color-text-primary)' }}>
        Cancellation policy: {POLICY_LABELS[p]}
      </p>
      <ul className={`mt-2 space-y-1.5 ${text} leading-relaxed`} style={{ color: 'var(--color-text-secondary)' }}>
        {[...policyRuleLines(rentalMode, p), ...commonRuleLines(rentalMode)].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

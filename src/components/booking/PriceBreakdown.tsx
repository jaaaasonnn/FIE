import { formatUsd } from '@/lib/utils'
import { formatStayDate } from '@/lib/stayDates'
import type { RentPlan } from '@/lib/rentRules'

// Shown wherever the deposit is mentioned. It is paid with the booking and
// nothing returns it automatically yet, so no time is promised.
export const DEPOSIT_NOTE = 'Paid now and held by FieGH. Returned by our team after check-out.'

/** "Includes the $200.00 refundable deposit", or null when there is none. */
export function depositIncludedNote(deposit: number): string | null {
  return deposit > 0 ? `Includes the ${formatUsd(deposit)} refundable deposit` : null
}

const UNIT: Record<string, [string, string]> = {
  SHORT_STAY: ['night', 'nights'],
  TEMP_STAY:  ['month', 'months'],
}

/**
 * The one price layout used on the listing page, checkout and confirmation.
 * Display only: every figure is passed in, nothing is calculated for charging.
 * "Total due now" is the full charge, which includes the deposit because it
 * is collected with the booking.
 *
 * A service fee line, and the "Stay total" that adds it to the stay price,
 * appear only when there is a fee: guests pay none on new bookings, and a
 * booking made when there was one still shows the fee it was charged.
 *
 * With `plan` (a monthly or long-term booking paid in instalments) it shows
 * the first payment instead: the months of rent paid up front and the
 * deposit, with what follows monthly underneath. `total` is then that first
 * payment, and there is never a service fee line.
 */
export function PriceBreakdown({
  rentalMode, pricePerUnit, units, subtotal, serviceFee, deposit, total, ghsRate,
  totalLabel = 'Total due now', className = '', plan = null,
}: {
  plan?: RentPlan | null
  rentalMode: string
  pricePerUnit: number
  units: number
  subtotal: number
  serviceFee: number
  deposit: number
  total: number
  ghsRate?: number | null
  totalLabel?: string
  className?: string
}) {
  const unit = UNIT[rentalMode]
  const stayLabel = unit
    ? `${formatUsd(pricePerUnit)} × ${units} ${units === 1 ? unit[0] : unit[1]}`
    : "One year's rent"
  const row = 'flex justify-between gap-4'
  const secondary = { color: 'var(--color-text-secondary)' }
  const primary = { color: 'var(--color-text-primary)' }

  if (plan) {
    const months = plan.advanceMonths === 1 ? "First month's rent" : `First ${plan.advanceMonths} months' rent`
    return (
      <div className={`text-sm ${className}`}>
        <div className={row} style={secondary}><span>{months}</span><span>{formatUsd(plan.firstRent)}</span></div>
        {plan.deposit > 0 && (
          <div className="mt-4">
            <div className={row} style={secondary}><span>Refundable deposit</span><span>{formatUsd(plan.deposit)}</span></div>
            <p className="text-xs mt-1" style={secondary}>{DEPOSIT_NOTE}</p>
          </div>
        )}
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className={`${row} font-semibold`} style={primary}><span>{totalLabel}</span><span>{formatUsd(total)}</span></div>
          {plan.deposit > 0 && <p className="text-xs mt-1" style={secondary}>{depositIncludedNote(plan.deposit)}</p>}
          {ghsRate ? (
            <p className="text-xs mt-1" style={secondary}>
              About GH₵ {(total * ghsRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
          ) : null}
        </div>
        {plan.laterCount > 0 && (
          <p className="text-xs mt-3 leading-relaxed" style={secondary}>
            Then {formatUsd(plan.laterAmount)} a month{plan.firstLaterDue ? `, from ${formatStayDate(plan.firstLaterDue, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
            {' '}({plan.laterCount} more payment{plan.laterCount === 1 ? '' : 's'}). Rent for the whole stay: {formatUsd(subtotal)}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={`text-sm ${className}`}>
      <div className="space-y-2">
        <div className={row} style={secondary}><span>{stayLabel}</span><span>{formatUsd(subtotal)}</span></div>
        {serviceFee > 0 && (
          <>
            <div className={row} style={secondary}><span>Service fee</span><span>{formatUsd(serviceFee)}</span></div>
            <div className={`${row} font-bold`} style={primary}><span>Stay total</span><span>{formatUsd(subtotal + serviceFee)}</span></div>
          </>
        )}
      </div>

      {deposit > 0 && (
        <div className="mt-4">
          <div className={row} style={secondary}><span>Refundable deposit</span><span>{formatUsd(deposit)}</span></div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{DEPOSIT_NOTE}</p>
        </div>
      )}

      <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className={`${row} font-semibold`} style={primary}><span>{totalLabel}</span><span>{formatUsd(total)}</span></div>
        {deposit > 0 && <p className="text-xs mt-1" style={secondary}>{depositIncludedNote(deposit)}</p>}
        {ghsRate ? (
          <p className="text-xs mt-1" style={secondary}>
            About GH₵ {(total * ghsRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
        ) : null}
      </div>
    </div>
  )
}

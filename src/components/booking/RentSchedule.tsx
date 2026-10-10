import Link from 'next/link'
import { formatUsd } from '@/lib/utils'
import { formatStayDate } from '@/lib/stayDates'
import {
  RENT_REMINDER_NOTE, isOverdue, isSettled, laterInstalmentRefusal, outstanding, type InstalmentState,
} from '@/lib/rentRules'

export type ScheduleInstalment = InstalmentState & { id: string; periodStart: string | Date; paidAt?: string | Date | null }

const CHIP: Record<string, { bg: string; color: string; label: string }> = {
  PAID:         { bg: '#D1FAE5', color: '#065F46', label: 'Paid' },
  COVERED:      { bg: '#DBEAFE', color: '#1E40AF', label: 'Paid from deposit' },
  PART_COVERED: { bg: '#FEF3C7', color: '#92400E', label: 'Part paid from deposit' },
  OVERDUE:      { bg: '#FEE2E2', color: '#991B1B', label: 'Late' },
  PENDING:      { bg: '#F5F5F4', color: '#57534E', label: 'Not due yet' },
  DUE:          { bg: '#FEF3C7', color: '#92400E', label: 'Due' },
  CANCELLED:    { bg: '#F5F5F4', color: '#78716C', label: 'Not owed' },
}

const day = (value: string | Date) => formatStayDate(value, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Every rent payment of a monthly or long-term booking, with where each one
 * stands. The guest also gets a pay link on the one that can be paid next.
 * Display only: whether a payment is accepted is decided on the server.
 */
export function RentSchedule({
  instalments, booking, role, className = '',
}: {
  instalments: ScheduleInstalment[]
  booking: { id: string; status: string; paymentStatus: string; checkIn: string | Date }
  role: 'GUEST' | 'HOST'
  className?: string
}) {
  if (instalments.length === 0) return null
  const rows = [...instalments].sort((a, b) => a.sequence - b.sequence)
  const now = new Date()

  return (
    <div className={className}>
      <ul className="divide-y divide-stone-100">
        {rows.map((i) => {
          const late = isOverdue(i, now)
          const due = !isSettled(i) && i.status !== 'CANCELLED' && new Date(i.dueDate).getTime() <= now.getTime()
          const chip = CHIP[late ? 'OVERDUE' : i.status === 'PENDING' && due ? 'DUE' : i.status] ?? CHIP.PENDING
          const owed = outstanding(i)
          const canPay = role === 'GUEST' && i.sequence > 1
            && laterInstalmentRefusal({ instalment: i, instalments: rows, booking, now }) === null
          return (
            <li key={i.id} className="py-3 flex items-center justify-between gap-3 flex-wrap text-sm">
              <div className="min-w-0">
                <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {i.sequence === 1 ? 'First payment' : `Rent from ${day(i.periodStart)}`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {i.sequence === 1
                    ? `Rent to ${day(i.periodEnd)}${i.depositAmount > 0 ? ' and the deposit' : ''}`
                    : `Due ${day(i.dueDate)}`}
                  {i.status === 'PART_COVERED' && ` · ${formatUsd(i.coveredFromDeposit)} taken from the deposit, ${formatUsd(owed)} still owed`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{formatUsd(i.amount + i.depositAmount)}</span>
                <span className="px-2 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: chip.bg, color: chip.color }}>{chip.label}</span>
                {canPay && (
                  <Link href={`/checkout/${booking.id}?instalment=${i.id}`}
                    className="focus-ring text-xs px-3 py-1.5 rounded-full font-semibold"
                    style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>
                    Pay {formatUsd(owed)}
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {role === 'GUEST' && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {RENT_REMINDER_NOTE} Rent is charged in cedis at the rate on the day you pay.
        </p>
      )}
    </div>
  )
}

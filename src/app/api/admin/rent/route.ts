import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/roles'
import { coverFromDeposit } from '@/lib/depositCover'
import { rentDepositCoverEnabled } from '@/lib/payoutSwitches'
import { DAY_MS } from '@/lib/stayDates'
import {
  OPEN_INSTALMENT_STATUSES, coverQuote, daysPastDue, depositLeft, endTenancyQuote, isOverdue, outstanding,
} from '@/lib/rentRules'

/** Rent due this many days ahead is listed as coming up. */
const UPCOMING_DAYS = 7

/**
 * GET /api/admin/rent
 * Rent that is late or coming due on tenancies that stand, with what covering
 * each late one from the deposit would do, and the payouts held for being
 * over the transfer limit.
 */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const now = new Date()
    const owed = await db.instalment.findMany({
      where: {
        sequence: { gt: 1 },
        status: { in: OPEN_INSTALMENT_STATUSES },
        dueDate: { lte: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) },
        booking: { status: { in: ['CONFIRMED', 'COMPLETED'] }, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
      },
      include: {
        payments: { where: { status: 'PENDING' }, select: { id: true } },
        booking: {
          select: {
            id: true, status: true, paymentStatus: true, damageDeposit: true, checkIn: true, checkOut: true, endedEarlyAt: true,
            refund: { select: { depositRefund: true } },
            instalments: true,
            listing: { select: { title: true } },
            guest: { select: { name: true } },
            host: { select: { name: true } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { bookingId: 'asc' }],
    })

    const instalments = owed.map((i) => {
      const b = i.booking
      const depositRefunded = b.refund?.depositRefund ?? 0
      const end = endTenancyQuote({ booking: b, instalments: b.instalments, now })
      return {
        id: i.id, bookingId: b.id, sequence: i.sequence, status: i.status,
        title: b.listing.title, guestName: b.guest.name, hostName: b.host.name,
        dueDate: i.dueDate, periodStart: i.periodStart, periodEnd: i.periodEnd,
        amount: i.amount, coveredFromDeposit: i.coveredFromDeposit, outstanding: outstanding(i),
        daysPastDue: daysPastDue(i.dueDate, now), overdue: isOverdue(i, now),
        depositLeft: depositLeft(b.damageDeposit, b.instalments, depositRefunded),
        cover: coverQuote({ instalment: i, instalments: b.instalments, booking: b, depositRefunded, paymentInProgress: i.payments.length > 0, now }),
        // Where the tenancy would end if it were ended now
        endsOn: end.ok ? end.endsOn : null,
      }
    })

    const heldPayouts = await db.payout.findMany({
      where: { status: 'HELD' },
      select: {
        id: true, amount: true, bookingId: true, instalmentSeq: true, failureReason: true, createdAt: true,
        host: { select: { name: true } },
        booking: { select: { listing: { select: { title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ instalments, heldPayouts, coverEnabled: rentDepositCoverEnabled() })
  } catch (error) {
    console.error('Admin rent GET error:', error)
    return NextResponse.json({ error: 'Failed to load rent' }, { status: 500 })
  }
}

/**
 * POST /api/admin/rent  { action: 'cover', instalmentId, dryRun? }
 * Covers a late rent payment from the booking's damage deposit
 * (lib/depositCover.ts). With dryRun, or while RENT_DEPOSIT_COVER_ENABLED is
 * off, this reports exactly what it would do and writes nothing.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const body = await req.json()
    if (body.action !== 'cover') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    if (typeof body.instalmentId !== 'string') return NextResponse.json({ error: 'instalmentId is required' }, { status: 400 })

    const result = await coverFromDeposit({ instalmentId: body.instalmentId, adminId: auth.user.id, dryRun: body.dryRun === true })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Admin rent POST error:', error)
    return NextResponse.json({ error: 'Failed to cover the rent' }, { status: 500 })
  }
}

// The test database, for arranging and checking. Refuses to open anything
// that is not the local throwaway database (the marker row is the proof).
import { PrismaClient } from '@prisma/client'

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid')
if (url.hostname !== '127.0.0.1' || url.pathname !== '/fiegh_e2e' || process.env.E2E !== '1') {
  throw new Error('e2e/lib/db.ts: DATABASE_URL is not the local test database. Run tests through `node e2e/run.mjs test`.')
}
url.searchParams.set('connection_limit', '3')

export const db = new PrismaClient({ datasources: { db: { url: url.toString() } } })

let checked = false
/** Throws unless this is the throwaway database. Called before anything is deleted or shifted. */
export async function assertTestDatabase(): Promise<void> {
  if (checked) return
  const rows = await db.$queryRawUnsafe<{ n: number }[]>('select count(*)::int n from e2e_marker')
  if (rows[0]?.n !== 1) throw new Error('The e2e marker row is missing: this is not the test database')
  checked = true
}

/** Deletes everything that hangs off these people, by id. */
export async function purge(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await assertTestDatabase()
  const u = { in: userIds }
  const listings = (await db.listing.findMany({ where: { hostId: u }, select: { id: true } })).map((r) => r.id)
  const bookings = (await db.booking.findMany({ where: { OR: [{ guestId: u }, { hostId: u }, { listingId: { in: listings } }] }, select: { id: true } })).map((r) => r.id)
  const b = { in: bookings }
  const disputes = (await db.dispute.findMany({ where: { bookingId: b }, select: { id: true } })).map((r) => r.id)
  await db.message.deleteMany({ where: { OR: [{ senderId: u }, { receiverId: u }] } })
  await db.wishlist.deleteMany({ where: { OR: [{ userId: u }, { listingId: { in: listings } }] } })
  await db.notification.deleteMany({ where: { OR: [{ userId: u }, ...userIds.map((id) => ({ body: { contains: id } })), ...bookings.map((id) => ({ body: { contains: id } }))] } })
  await db.messageLog.deleteMany({ where: { OR: [{ userId: u }, { bookingId: b }] } })
  await db.disputeEvidence.deleteMany({ where: { disputeId: { in: disputes } } })
  await db.disputeEvent.deleteMany({ where: { disputeId: { in: disputes } } })
  await db.dispute.deleteMany({ where: { id: { in: disputes } } })
  await db.refund.deleteMany({ where: { bookingId: b } })
  await db.payout.deleteMany({ where: { OR: [{ hostId: u }, { bookingId: b }] } })
  await db.payment.deleteMany({ where: { bookingId: b } })
  await db.instalment.deleteMany({ where: { bookingId: b } })
  await db.review.deleteMany({ where: { OR: [{ bookingId: b }, { reviewerId: u }, { revieweeId: u }] } })
  await db.blockedDate.deleteMany({ where: { listingId: { in: listings } } })
  await db.booking.deleteMany({ where: { id: b } })
  await db.listingCheck.deleteMany({ where: { OR: [{ listingId: { in: listings } }, { checkedById: u }] } })
  await db.listing.deleteMany({ where: { id: { in: listings } } })
  await db.verification.deleteMany({ where: { userId: u } })
  await db.authToken.deleteMany({ where: { userId: u } })
  await db.authRequest.deleteMany({ where: { userId: u } })
  await db.session.deleteMany({ where: { userId: u } })
  await db.user.deleteMany({ where: { id: u } })
}

const DAY = 24 * 60 * 60 * 1000
/**
 * Makes time pass for one booking: every date on it and on what hangs off it
 * moves back by `days`. The server's clock is never touched; this is the same
 * as having made the booking that many days earlier.
 */
export async function ageBooking(bookingId: string, days: number): Promise<void> {
  await assertTestDatabase()
  const ms = Math.round(days * DAY)
  const back = (d: Date | null) => (d ? new Date(d.getTime() - ms) : d)
  const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } })
  await db.booking.update({
    where: { id: bookingId },
    data: {
      checkIn: back(booking.checkIn)!, checkOut: back(booking.checkOut)!, createdAt: back(booking.createdAt)!, payBy: back(booking.payBy),
      ...('originalCheckOut' in booking ? { originalCheckOut: back((booking as { originalCheckOut: Date | null }).originalCheckOut) } : {}),
    },
  })
  for (const p of await db.payment.findMany({ where: { bookingId } })) await db.payment.update({ where: { id: p.id }, data: { createdAt: back(p.createdAt)!, ...('paidAt' in p ? { paidAt: back((p as { paidAt: Date | null }).paidAt) } : {}) } })
  for (const i of await db.instalment.findMany({ where: { bookingId } })) await db.instalment.update({ where: { id: i.id }, data: { periodStart: back(i.periodStart)!, periodEnd: back(i.periodEnd)!, dueDate: back(i.dueDate)!, paidAt: back(i.paidAt) } })
  for (const b of await db.blockedDate.findMany({ where: { listingId: booking.listingId, date: { gte: booking.checkIn, lt: booking.checkOut } } })) {
    await db.blockedDate.update({ where: { id: b.id }, data: { date: back(b.date)! } }).catch(() => {})
  }
}

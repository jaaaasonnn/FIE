// The test database, for arranging and checking. Refuses to open anything
// that is not the local throwaway database (the marker row is the proof).
import { Prisma, PrismaClient } from '@prisma/client'

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** How long clean-up waits for a send job to finish with these people's messages (the job's own limit per message is 8 s) */
const SENDING_WAIT_MS = 20_000

/**
 * SU9: the send job (src/lib/messaging/deliver.ts) works over the whole database. It claims a message (status
 * SENDING), calls the provider, then records the outcome by the row's id; a row deleted in between made the
 * whole run answer 500. Only this clean-up ever deletes MessageLog rows (the app never does), so it leaves a
 * message alone while a job is sending it: everything else of these people's is deleted at once, and a message
 * being sent is waited for until the job has recorded it. After SENDING_WAIT_MS a SENDING row is a run that
 * died, and is deleted like any other.
 */
async function clearMessages(where: Prisma.MessageLogWhereInput): Promise<Prisma.MessageLogWhereInput> {
  const notSending: Prisma.MessageLogWhereInput = { AND: [where, { status: { not: 'SENDING' } }] }
  const until = Date.now() + SENDING_WAIT_MS
  for (;;) {
    await db.messageLog.deleteMany({ where: notSending })
    if ((await db.messageLog.count({ where })) === 0) return notSending
    if (Date.now() > until) return where
    await sleep(100)
  }
}

/** SU10: every test person one process made and has not removed yet: their emails start e2e-<run id>- (lib/runId.ts) */
export async function purgeRunLeftovers(runId: string): Promise<number> {
  const left = await db.user.findMany({ where: { email: { startsWith: `e2e-${runId}-`, endsWith: '@fiegh.test' } }, select: { id: true } })
  await purge(left.map((u) => u.id))
  return left.length
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
  const messages: Prisma.MessageLogWhereInput = { OR: [{ userId: u }, { bookingId: b }] }
  // In one transaction: nobody reading beside this (another test's check of the money rules) sees a booking
  // without its payment. If a send job claims one of these messages in the moment before it, deleting the
  // person fails on the message's foreign key and nothing is deleted: wait for that send, and go again.
  for (let attempt = 0; ; attempt++) {
    const messageWhere = await clearMessages(messages)
    try {
      await purgeRows(u, b, listings, disputes, userIds, bookings, messageWhere)
      return
    } catch (error) {
      if (attempt < 5 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') continue
      throw error
    }
  }
}

async function purgeRows(u: { in: string[] }, b: { in: string[] }, listings: string[], disputes: string[], userIds: string[], bookings: string[], messageWhere: Prisma.MessageLogWhereInput) {
  await db.$transaction([
    db.message.deleteMany({ where: { OR: [{ senderId: u }, { receiverId: u }] } }),
    db.wishlist.deleteMany({ where: { OR: [{ userId: u }, { listingId: { in: listings } }] } }),
    db.notification.deleteMany({ where: { OR: [{ userId: u }, ...userIds.map((id) => ({ body: { contains: id } })), ...bookings.map((id) => ({ body: { contains: id } }))] } }),
    db.messageLog.deleteMany({ where: messageWhere }),
    db.disputeEvidence.deleteMany({ where: { disputeId: { in: disputes } } }),
    db.disputeEvent.deleteMany({ where: { disputeId: { in: disputes } } }),
    db.dispute.deleteMany({ where: { id: { in: disputes } } }),
    db.refund.deleteMany({ where: { bookingId: b } }),
    db.payout.deleteMany({ where: { OR: [{ hostId: u }, { bookingId: b }] } }),
    db.payment.deleteMany({ where: { bookingId: b } }),
    db.instalment.deleteMany({ where: { bookingId: b } }),
    db.review.deleteMany({ where: { OR: [{ bookingId: b }, { reviewerId: u }, { revieweeId: u }] } }),
    db.blockedDate.deleteMany({ where: { listingId: { in: listings } } }),
    db.booking.deleteMany({ where: { id: b } }),
    db.listingCheck.deleteMany({ where: { OR: [{ listingId: { in: listings } }, { checkedById: u }] } }),
    db.listing.deleteMany({ where: { id: { in: listings } } }),
    db.verification.deleteMany({ where: { userId: u } }),
    db.authToken.deleteMany({ where: { userId: u } }),
    db.authRequest.deleteMany({ where: { userId: u } }),
    db.session.deleteMany({ where: { userId: u } }),
    db.user.deleteMany({ where: { id: u } }),
  ])
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

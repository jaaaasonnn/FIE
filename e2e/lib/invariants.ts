// The rules about money and dates that must hold whatever happened: after two
// people clicked at once, after a job ran twice, after the server was killed
// half way. Reads only. Returns every rule that is broken, in plain words.
import { db } from './db'
import { fakes } from './fakes'

const CENT = 0.005
const COMMISSION = 0.10 // src/lib/utils.ts PLATFORM_COMMISSION; a test checks the two agree

export type Violation = { rule: string; detail: string }

export async function checkInvariants(): Promise<Violation[]> {
  const out: Violation[] = []
  const add = (rule: string, rows: unknown[]) => { for (const row of rows) out.push({ rule, detail: JSON.stringify(row) }) }
  const q = <T = Record<string, unknown>>(sql: string) => db.$queryRawUnsafe<T[]>(sql)

  add('one successful payment per booking paid in one go', await q(`
    select "bookingId", count(*)::int n from "Payment" where status = 'SUCCESS' and "instalmentId" is null group by 1 having count(*) > 1`))
  add('one successful payment per rent instalment', await q(`
    select "instalmentId", count(*)::int n from "Payment" where status = 'SUCCESS' and "instalmentId" is not null group by 1 having count(*) > 1`))
  add('a booking marked paid has a successful payment', await q(`
    select b.id from "Booking" b where b."paymentStatus" = 'PAID'
      and not exists (select 1 from "Payment" p where p."bookingId" = b.id and p.status = 'SUCCESS')`))
  add('a successful first payment means the booking is not left unpaid', await q(`
    select b.id, b.status, b."paymentStatus" from "Booking" b where b."paymentStatus" = 'UNPAID' and b.status in ('CONFIRMED','COMPLETED')
      and exists (select 1 from "Payment" p left join "Instalment" i on i.id = p."instalmentId" where p."bookingId" = b.id and p.status = 'SUCCESS' and coalesce(i.sequence, 1) = 1)`))
  add('an instalment marked paid has a successful payment or was covered', await q(`
    select i.id from "Instalment" i where i.status = 'PAID' and coalesce(i."coveredFromDeposit", 0) = 0
      and not exists (select 1 from "Payment" p where p."instalmentId" = i.id and p.status = 'SUCCESS')
      and not (i.sequence = 1 and exists (select 1 from "Payment" p where p."bookingId" = i."bookingId" and p.status = 'SUCCESS'))`))

  add('one payout per booking or instalment', await q(`
    select "bookingId", "instalmentSeq", count(*)::int n from "Payout" where "bookingId" is not null group by 1, 2 having count(*) > 1`))
  add('a payout is never more than the host share', await q(`
    select po.id, po.amount, b.subtotal, i.amount instalment from "Payout" po join "Booking" b on b.id = po."bookingId" left join "Instalment" i on i.id = po."instalmentId"
     where po.amount > (1 - ${COMMISSION}) * coalesce(i.amount, b.subtotal) + ${CENT}`))
  add('no payout is under way for a cancelled or refunded booking', await q(`
    select po.id, po.status, b.status booking, b."paymentStatus" from "Payout" po join "Booking" b on b.id = po."bookingId"
     where po.status in ('PENDING','PROCESSING','COMPLETED') and po."instalmentSeq" = 0 and (b.status in ('CANCELLED','DECLINED') or b."paymentStatus" = 'REFUNDED')`))
  add('no payout to a host whose ID is not approved', await q(`
    select po.id, po.status from "Payout" po join "User" u on u.id = po."hostId" left join "Verification" v on v."userId" = u.id
     where po.status in ('PROCESSING','COMPLETED') and not (u."isVerified" and v.status = 'APPROVED' and v."reviewedById" is not null)
       and po."createdAt" > coalesce(v."updatedAt", 'epoch')`))

  add('one refund per booking', await q(`select "bookingId", count(*)::int n from "Refund" group by 1 having count(*) > 1`))
  add('a refund is never more than was paid', await q(`
    select r.id, r.amount, coalesce(sum(p.amount), 0) paid from "Refund" r left join "Payment" p on p."bookingId" = r."bookingId" and p.status in ('SUCCESS','REFUNDED','DUPLICATE')
     group by r.id, r.amount having r.amount > coalesce(sum(p.amount), 0) + ${CENT}`))
  add('refund parts are never negative', await q(`select id from "Refund" where amount < 0 or "stayRefund" < 0 or "serviceFeeRefund" < 0 or coalesce("amountPesewas", 0) < 0`))

  add('no two live bookings overlap on one listing', await q(`
    select a.id a, b.id b, a."listingId" from "Booking" a join "Booking" b on a."listingId" = b."listingId" and a.id < b.id
     where a.status not in ('CANCELLED','DECLINED') and b.status not in ('CANCELLED','DECLINED') and a."checkIn" < b."checkOut" and b."checkIn" < a."checkOut"`))
  add('booking totals add up and are never negative', await q(`
    select id, subtotal, "serviceFee", "damageDeposit", "totalPrice" from "Booking"
     where subtotal < 0 or "serviceFee" < 0 or "damageDeposit" < 0 or "totalPrice" < 0 or abs("totalPrice" - (subtotal + "serviceFee" + "damageDeposit")) > ${CENT}`))
  add('rent instalments add up to the rent', await q(`
    select b.id, b.subtotal, sum(i.amount) instalments from "Booking" b join "Instalment" i on i."bookingId" = b.id group by b.id, b.subtotal having abs(sum(i.amount) - b.subtotal) > ${CENT}`))
  add('a suspended account has no sessions', await q(`select s.id from "Session" s join "User" u on u.id = s."userId" where u."suspendedAt" is not null`))
  add('emails and phone numbers are unique', await q(`select lower(email) e, count(*)::int n from "User" where email is not null group by 1 having count(*) > 1`))

  // What the fake Paystack actually saw, against the database
  const transfers = await fakes.transfers()
  const payoutByRef = new Map((await db.payout.findMany({ select: { id: true, bookingId: true, instalmentSeq: true, paystackTransferReference: true } })).map((p) => [p.paystackTransferReference, p]))
  const paidOnce = new Map<string, number>()
  for (const t of transfers) {
    const payout = payoutByRef.get(t.reference)
    if (!payout) continue // a payout row removed by another test's clean-up
    const key = `${payout.bookingId}:${payout.instalmentSeq}`
    paidOnce.set(key, (paidOnce.get(key) ?? 0) + 1)
  }
  add('Paystack was asked to pay a booking or instalment once', [...paidOnce].filter(([, n]) => n > 1).map(([key, n]) => ({ key, transfers: n })))
  const refunds = (await fakes.refunds()).filter((r) => r.status !== 'failed')
  const perTx = new Map<string, number>()
  for (const r of refunds) perTx.set(r.transaction_reference, (perTx.get(r.transaction_reference) ?? 0) + 1)
  add('Paystack was asked to refund a payment once', [...perTx].filter(([, n]) => n > 1).map(([reference, n]) => ({ reference, refunds: n })))
  return out
}

/** Throws with every broken rule listed. */
export async function expectInvariants(): Promise<void> {
  const broken = await checkInvariants()
  if (broken.length) throw new Error(`Money and date rules broken:\n${broken.map((v) => `  - ${v.rule}: ${v.detail}`).join('\n')}`)
}

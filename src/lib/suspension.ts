// Suspending an account. An admin does it, with a reason, and an admin undoes
// it. While an account is suspended:
//   - nobody can sign in to it, and every session it had is ended;
//   - its listings are not in search, cannot be opened by the public and
//     cannot be booked;
//   - no money is sent to it. Like a host whose ID is not approved
//     (lib/hostId.ts) that is a wait and never a failure: nothing is written,
//     and the payout goes out on the first run after the account is restored.
// Bookings already made are not touched: a person decides what happens to them.
//
// Every suspension and restoral is written, in the same transaction, as a
// notice to every admin: who did it, to whom, when and why. Those notices are
// the record; the three columns on User only say how things stand now.

import { db } from '@/lib/db'
import { SUPPORT_EMAIL } from '@/lib/contact'
import { parseText } from '@/lib/validate'
import { REASON_MAX, REASON_MIN } from '@/lib/suspensionRules'

/** True while the account is suspended. */
export function isSuspended(user: { suspendedAt?: Date | null } | null | undefined): boolean {
  return !!user?.suspendedAt
}

/** The Prisma `where` for a listing whose host is not suspended. */
export const HOST_NOT_SUSPENDED = { suspendedAt: null } as const

/** Thrown when something tries to start a transfer to a suspended host. */
export class HostSuspendedError extends Error {
  constructor(hostId: string) {
    super(`Host ${hostId} is suspended: payout waits`)
    this.name = 'HostSuspendedError'
  }
}

/** Why a payout is waiting, in the job's report. */
export const WAITING_FOR_SUSPENSION = 'the host\'s account is suspended'

/** What someone is told when they sign in to a suspended account with the right password. */
export const SUSPENDED_SIGN_IN = `This account has been suspended. Please write to ${SUPPORT_EMAIL} if you think this is a mistake.`

export { REASON_MAX, REASON_MIN }

export type SuspensionAction = 'suspend' | 'restore'
export type SuspensionResult =
  | { ok: true; action: SuspensionAction; userId: string; sessionsEnded: number }
  | { ok: false; status: 400 | 404 | 409; error: string }

const refuse = (status: 400 | 404 | 409, error: string): SuspensionResult => ({ ok: false, status, error })

/**
 * Suspends or restores an account. The caller has already checked that
 * `adminId` is an admin (requireAdmin). Refused: no reason, yourself, an
 * account already in that state, and suspending the only admin left.
 */
export async function setSuspension(
  { adminId, userId, action, reason }: { adminId: string; userId: unknown; action: unknown; reason: unknown },
  now: Date = new Date(),
): Promise<SuspensionResult> {
  if (action !== 'suspend' && action !== 'restore') return refuse(400, 'Choose suspend or restore')
  if (typeof userId !== 'string' || !userId) return refuse(400, 'Choose an account')
  const why = parseText(reason, { label: 'Reason', max: REASON_MAX, required: true })
  if (!why.ok) return refuse(400, why.error)
  if (!why.value || why.value.length < REASON_MIN) return refuse(400, `Give a reason of at least ${REASON_MIN} characters`)
  const text = why.value
  if (userId === adminId) return refuse(400, 'You cannot suspend or restore your own account')

  return db.$transaction(async (tx): Promise<SuspensionResult> => {
    const [target, admin] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, suspendedAt: true } }),
      tx.user.findUnique({ where: { id: adminId }, select: { id: true, name: true } }),
    ])
    if (!target) return refuse(404, 'Account not found')

    if (action === 'suspend') {
      if (target.suspendedAt) return refuse(409, 'This account is already suspended')
      // There must always be an admin who can sign in
      if (target.role === 'ADMIN') {
        const others = await tx.user.count({ where: { role: 'ADMIN', suspendedAt: null, id: { not: target.id } } })
        if (others === 0) return refuse(409, 'This is the only admin account that can sign in. It cannot be suspended.')
      }
      // Only an account that is not suspended is changed, so two admins
      // pressing the button together make one suspension and one record
      const changed = await tx.user.updateMany({
        where: { id: target.id, suspendedAt: null },
        data: { suspendedAt: now, suspendedById: adminId, suspendedReason: text },
      })
      if (changed.count === 0) return refuse(409, 'This account is already suspended')
    } else {
      if (!target.suspendedAt) return refuse(409, 'This account is not suspended')
      const changed = await tx.user.updateMany({
        where: { id: target.id, suspendedAt: { not: null } },
        data: { suspendedAt: null, suspendedById: null, suspendedReason: null },
      })
      if (changed.count === 0) return refuse(409, 'This account is not suspended')
    }

    // Signed out everywhere, at once
    const ended = action === 'suspend' ? await tx.session.deleteMany({ where: { userId: target.id } }) : { count: 0 }

    // The record: one notice to every admin, written with the change itself
    const admins = await tx.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })
    const who = `${admin?.name ?? 'An admin'} (${adminId})`
    const whom = `${target.name ?? 'an account'} (${target.id}, ${target.role})`
    await tx.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: action === 'suspend' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_RESTORED',
        title: action === 'suspend' ? 'An account was suspended' : 'An account was restored',
        body: `${who} ${action === 'suspend' ? 'suspended' : 'restored'} ${whom} on ${now.toISOString()}. Reason: ${text}`,
      })),
    })

    return { ok: true, action, userId: target.id, sessionsEnded: ended.count }
  })
}

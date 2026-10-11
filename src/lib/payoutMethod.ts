// A payout method that was only just saved is not paid into straight away.
// If someone gets into a host's account and points the payouts at their own
// number, the host has a day (and an email saying it changed) to notice
// before any money goes there.
//
// Like a host whose ID is not approved (lib/hostId.ts), this is a wait and
// never a failure: nothing is written, and the payout goes out on the first
// run after the day is up.

export const PAYOUT_METHOD_SETTLE_MS = 24 * 60 * 60 * 1000

/** True once the host's payout method has been in place for a day. */
export function payoutMethodSettled(host: { payoutMethodVerifiedAt: Date | null } | null | undefined, now: Date = new Date()): boolean {
  return !!host?.payoutMethodVerifiedAt && now.getTime() - host.payoutMethodVerifiedAt.getTime() >= PAYOUT_METHOD_SETTLE_MS
}

/** Thrown when something tries to start a transfer to a payout method saved less than a day ago. */
export class PayoutMethodTooNewError extends Error {
  constructor(hostId: string) {
    super(`Host ${hostId} changed their payout method less than 24 hours ago: payout waits`)
    this.name = 'PayoutMethodTooNewError'
  }
}

/** Why a payout is waiting, in the job's report and in alerts. */
export const WAITING_FOR_NEW_METHOD = 'the payout method was saved less than 24 hours ago'

/** What a host is told on the payouts page after saving a method. */
export const NEW_METHOD_NOTE = 'For your safety, payouts to a new or changed payout method start 24 hours after it is saved.'

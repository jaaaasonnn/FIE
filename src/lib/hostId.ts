// A host is paid only once FieGH has approved their ID. This file is the one
// place that says what "approved" means, and holds every sentence the site
// uses about it, so the wording cannot drift from the rule.
//
// A host can list, take bookings and be paid for by guests without one. A
// payout that falls due while the ID is not approved is not sent: no Payout
// row is written, the booking (or rent instalment) stays in the list of
// payouts that are due, and it is sent on the first run after approval. So a
// payout held for this reason is never a row with status HELD (that is a
// payout over the transfer limit), and it cannot be failed, cancelled or lost.
//
// Nothing here is shown to guests. They see only the "Host ID checked" badge.

/** What the rule reads from a user. `verification` is their ID document, if they sent one. */
export type IdFacts = {
  isVerified: boolean
  verification?: { status: string; reviewedById: string | null } | null
}

/** The Prisma `select` that loads exactly what the rule needs. */
export const HOST_ID_SELECT = {
  isVerified: true,
  verification: { select: { status: true, reviewedById: true } },
} as const

/**
 * True only when all three hold: the account is flagged, the ID document is
 * APPROVED, and an admin is recorded as having reviewed it. The flag alone is
 * not enough (a seed script or SQL can set it), and neither is an approved
 * document nobody is recorded as approving.
 */
export function hostIdApproved(host: IdFacts | null | undefined): boolean {
  return !!host
    && host.isVerified === true
    && host.verification?.status === 'APPROVED'
    && !!host.verification.reviewedById
}

export type HostIdState = 'APPROVED' | 'IN_REVIEW' | 'REJECTED' | 'NONE'

/** Where a host stands, for the notices on their pages and the admin page. */
export function hostIdState(host: IdFacts | null | undefined): HostIdState {
  if (hostIdApproved(host)) return 'APPROVED'
  if (host?.verification?.status === 'PENDING') return 'IN_REVIEW'
  if (host?.verification?.status === 'REJECTED') return 'REJECTED'
  return 'NONE'
}

/** Thrown when something tries to start a transfer to a host whose ID is not approved. */
export class HostIdNotApprovedError extends Error {
  constructor(hostId: string) {
    super(`Host ${hostId} has no approved ID: payout waits`)
    this.name = 'HostIdNotApprovedError'
  }
}

/** Why a payout is waiting, in the job's report and in alerts. */
export const WAITING_FOR_HOST_ID = 'the host has no approved ID'

// ── Words ──────────────────────────────────────────────────────────────────

export const VERIFY_ID_PATH = '/auth/verify-id'

/** The card on the become-a-host page. */
export const BECOME_A_HOST_ID = {
  title: 'You need an approved ID before we can pay you',
  body: 'You can list your home and take bookings straight away. We hold your payouts until we have checked your Ghana Card, Passport or Voter ID. It also earns the "Host ID checked" badge.',
}

/** The notice on the last step of creating a listing. */
export const LISTING_ID_NOTICE = 'Before you can be paid, we need to check your ID. You can publish now and send it later.'

/** The banner on the host dashboard and the payouts page, while the ID is not approved. */
export const HOST_ID_BANNER: Record<Exclude<HostIdState, 'APPROVED'>, { title: string; body: string; action: string | null }> = {
  NONE: {
    title: 'We need to check your ID before we can pay you',
    body: 'Your bookings carry on as normal, and we hold your payouts until your ID is approved.',
    action: 'Send your ID',
  },
  IN_REVIEW: {
    title: 'We are checking your ID',
    body: 'This usually takes less than a day. We hold your payouts until it is approved.',
    action: null,
  },
  REJECTED: {
    title: 'We could not approve the ID you sent',
    body: 'Please send a clear photo of the whole document. We hold your payouts until your ID is approved.',
    action: 'Send your ID again',
  },
}

/** Added to the banner on the payouts page when money has fallen due and is waiting. */
export function waitingForIdLine(amountUsd: number, count: number, amountPesewas?: number | null): string {
  const dollars = `$${amountUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  // Cedis first, as it will be sent, with dollars beside; dollars alone when the cedis cannot be worked out
  const amount = typeof amountPesewas === 'number'
    ? `GH₵ ${(amountPesewas / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${dollars})`
    : dollars
  return `${amount} is waiting for you (${count} ${count === 1 ? 'payout' : 'payouts'}). It is sent once your ID is approved.`
}

/** One sentence for the FAQ, the how-it-works page and the Terms. */
export const PAYOUTS_NEED_ID = 'Payouts are held until the host\'s ID has been approved.'

/** The end of the FAQ answer to "Why should I have my ID checked?" */
export const WHO_NEEDS_ID = 'Guests do not need one. Hosts need one before they can be paid.'

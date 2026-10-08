// Every message FieGH sends, in one place: who gets it, on which channels,
// and the words. Nothing here touches the database or the network, so the
// admin preview and the real thing render from exactly the same code.
//
// Rules the templates keep to:
//  - Email carries the detail. SMS is for the few events that cannot wait,
//    fits one plain 160-character segment, writes cedis as "GHS", and never
//    carries a name, an address, a phone number or an account detail.
//  - In-app rows are written only for events that had none before; the five
//    older in-app notices are still written where they always were.
//  - An event marked `optional` is one a person can turn off in their profile.
//    Everything else is about their booking or their money and is always sent.

import { aboutGhs, firstName, ghanaDate, ghanaTime, ghs, sms, smsGhs, usd } from '@/lib/messaging/format'

/** What a template may use. Filled in from the database by lib/messaging/events.ts. */
export type Facts = {
  appUrl: string
  supportEmail: string
  // The booking
  bookingId?: string
  title?: string
  checkIn?: Date
  checkOut?: Date
  guestName?: string | null
  hostName?: string | null
  totalUsd?: number
  /** The latest rate, for amounts not paid yet */
  usdToGhs?: number
  /** What the guest was actually charged, when they have paid */
  paidPesewas?: number | null
  payBy?: Date | null
  hostHasPayoutMethod?: boolean
  // Cancelling and refunds
  cancelReason?: string | null
  refundUsd?: number | null
  refundPesewas?: number | null
  refundId?: string
  expiredFor?: 'UNPAID_EXPIRED' | 'NO_HOST_RESPONSE'
  // Payouts
  payoutUsd?: number | null
  payoutPesewas?: number | null
  payoutId?: string
  payoutMethodLabel?: string
  failureReason?: string | null
  // Disputes
  raisedByRole?: 'GUEST' | 'HOST'
  disputeReason?: string
  outcomeLabel?: string
  resolution?: string | null
  note?: string | null
  // People and listings
  userName?: string | null
  verificationStatus?: string
  senderName?: string | null
  inboxPath?: string
  reviewPublished?: boolean
  listingId?: string
}

export type Audience = 'guest' | 'host' | 'user' | 'admin'

export type Piece = {
  to: Audience
  email?: { subject: string; lines: string[]; link?: { label: string; path: string } }
  sms?: string
  inApp?: { title: string; body: string }
}

export type Template = {
  /** What the event is, for the admin pages */
  label: string
  /** True for the few a person can turn off in their profile */
  optional?: boolean
  render: (f: Facts) => Piece[]
}

// ── Small helpers ──────────────────────────────────────────────────────────

const hello = (name: string | null | undefined) => (firstName(name) ? `Hello ${firstName(name)},` : 'Hello,')
const stay = (f: Facts) => `${ghanaDate(f.checkIn!)} to ${ghanaDate(f.checkOut!)}`
const shortStay = (f: Facts) => `${ghanaDate(f.checkIn!, true)}-${ghanaDate(f.checkOut!, true)}`
const home = (f: Facts) => f.title ?? 'your booking'
/** The price before it is paid: dollars, with cedis at today's rate as a guide. */
const price = (f: Facts) => `${usd(f.totalUsd ?? 0)}${f.usdToGhs ? ` (${aboutGhs(f.totalUsd ?? 0, f.usdToGhs)})` : ''}`
/** What was paid: the cedis charged, with the dollar price beside it. */
const paid = (f: Facts) => (f.paidPesewas ? `${ghs(f.paidPesewas)} (${usd(f.totalUsd ?? 0)})` : usd(f.totalUsd ?? 0))
const refund = (f: Facts) => (f.refundPesewas ? `${ghs(f.refundPesewas)} (${usd(f.refundUsd ?? 0)})` : usd(f.refundUsd ?? 0))
const payout = (f: Facts) => (f.payoutPesewas ? `${ghs(f.payoutPesewas)}${f.payoutUsd ? ` (${usd(f.payoutUsd)})` : ''}` : usd(f.payoutUsd ?? 0))
const payByText = (f: Facts) => `${ghanaDate(f.payBy!)} at ${ghanaTime(f.payBy!)} (Ghana time)`
const REFUND_TIMING = 'Refunds go back to the card or mobile money number you paid with, and can take up to 10 working days to arrive.'

const bookingLink = (f: Facts, label = 'View your booking') => ({ label, path: `/bookings/${f.bookingId}` })
const hostBookingsLink = { label: 'Open your bookings', path: '/dashboard/host/bookings' }
const payoutsLink = { label: 'Open your payouts', path: '/dashboard/host/payouts' }
const adminLink = { label: 'Open the admin page', path: '/admin' }
const bookingUrl = (f: Facts) => `${f.appUrl}/bookings/${f.bookingId}`
const hostUrl = (f: Facts) => `${f.appUrl}/dashboard/host/bookings`
const payoutsUrl = (f: Facts) => `${f.appUrl}/dashboard/host/payouts`

// ── The templates ──────────────────────────────────────────────────────────

export const TEMPLATES = {
  'booking.requested': {
    label: 'A guest sends a booking request',
    render: (f) => [
      {
        to: 'host',
        email: {
          subject: `New booking request for ${home(f)}`,
          lines: [
            hello(f.hostName),
            `${firstName(f.guestName) || 'A guest'} would like to stay at ${home(f)} from ${stay(f)}.`,
            `The stay comes to ${price(f)}. Nothing is charged until you accept and the guest pays.`,
            'Please accept or decline within 48 hours. After that the request ends on its own and the dates open up again.',
          ],
          link: hostBookingsLink,
        },
        sms: sms(f.title, (t) => `FieGH: New booking request for "${t}", ${shortStay(f)}. Accept or decline within 48 hours: ${hostUrl(f)}`),
        inApp: { title: 'New booking request', body: `${home(f)}, ${stay(f)}. Accept or decline it on your bookings page within 48 hours.` },
      },
      {
        to: 'guest',
        email: {
          subject: `Your request for ${home(f)} has been sent`,
          lines: [
            hello(f.guestName),
            `We have sent your request to stay at ${home(f)} from ${stay(f)} to the host.`,
            'Nothing has been charged. The host has 48 hours to answer. If they accept, we will let you know and you will have 24 hours to pay and confirm the booking.',
          ],
          link: bookingLink(f, 'View your request'),
        },
      },
    ],
  },

  'booking.accepted': {
    label: 'The host accepts a request',
    render: (f) => [{
      to: 'guest',
      email: {
        subject: `Your request for ${home(f)} was accepted`,
        lines: [
          hello(f.guestName),
          `Good news: your host accepted your request to stay at ${home(f)} from ${stay(f)}.`,
          `The booking is not confirmed until it is paid for. The total is ${price(f)}.`,
          f.payBy ? `Please pay by ${payByText(f)}. After that the dates are released for other guests.` : 'Please pay to confirm it.',
        ],
        link: { label: 'Pay now', path: `/checkout/${f.bookingId}` },
      },
      sms: sms(f.title, (t) => `FieGH: Your request for "${t}" was accepted. ${f.payBy ? `Pay by ${ghanaDate(f.payBy, true)} ${ghanaTime(f.payBy)} GMT` : 'Pay'} to keep your dates: ${bookingUrl(f)}`),
    }],
  },

  'booking.declined': {
    label: 'The host declines a request',
    render: (f) => [{
      to: 'guest',
      email: {
        subject: `Your request for ${home(f)} was declined`,
        lines: [
          hello(f.guestName),
          `We are sorry: the host could not accept your request to stay at ${home(f)} from ${stay(f)}.`,
          'Nothing was charged. There are other homes for the same dates, and you are welcome to send another request.',
        ],
        link: { label: 'Find another home', path: '/search' },
      },
      inApp: { title: 'Your request was declined', body: `${home(f)}, ${stay(f)}. Nothing was charged.` },
    }],
  },

  'booking.confirmed': {
    label: 'A booking is paid for and confirmed',
    render: (f) => [
      {
        to: 'guest',
        email: {
          subject: `Booking confirmed: ${home(f)}`,
          lines: [
            hello(f.guestName),
            `Your booking is confirmed. You are staying at ${home(f)} from ${stay(f)}.`,
            `We received your payment of ${paid(f)}. This email is your receipt. Your reference is ${f.bookingId}.`,
            'FieGH holds your payment and pays the host after you have checked in.',
            'If something is wrong with the home when you arrive, tell us from your booking page by the end of the day after check-in.',
          ],
          link: bookingLink(f),
        },
        sms: sms(f.title, (t) => `FieGH: Booking confirmed. "${t}", ${shortStay(f)}.${f.paidPesewas ? ` We received ${smsGhs(f.paidPesewas)}.` : ''} Details: ${bookingUrl(f)}`),
      },
      {
        to: 'host',
        email: {
          subject: `Booking confirmed and paid: ${home(f)}`,
          lines: [
            hello(f.hostName),
            `${firstName(f.guestName) || 'Your guest'} has paid, so the booking for ${home(f)} from ${stay(f)} is confirmed.`,
            'For a short stay, your payout is sent 48 hours after check-in.',
            ...(f.hostHasPayoutMethod === false ? ['You have not added a payout method yet. Please add one so we can pay you.'] : []),
          ],
          link: f.hostHasPayoutMethod === false ? payoutsLink : hostBookingsLink,
        },
        sms: sms(f.title, (t) => `FieGH: The booking for "${t}", ${shortStay(f)} is paid and confirmed. Details: ${hostUrl(f)}`),
        inApp: { title: 'A booking is paid and confirmed', body: `${home(f)}, ${stay(f)}.` },
      },
    ],
  },

  'booking.expired': {
    label: 'A booking or request runs out of time',
    render: (f) => f.expiredFor === 'NO_HOST_RESPONSE'
      ? [
          {
            to: 'guest',
            email: {
              subject: `Your request for ${home(f)} has expired`,
              lines: [
                hello(f.guestName),
                `The host did not answer your request to stay at ${home(f)} from ${stay(f)} in time, so it has ended.`,
                'Nothing was charged. You can send a new request or choose another home.',
              ],
              link: { label: 'Find another home', path: '/search' },
            },
            inApp: { title: 'Your request expired', body: `${home(f)}, ${stay(f)}. The host did not answer in time. Nothing was charged.` },
          },
          {
            to: 'host',
            email: {
              subject: `A booking request for ${home(f)} has expired`,
              lines: [
                hello(f.hostName),
                `A request to stay at ${home(f)} from ${stay(f)} was not answered within 48 hours, so it has ended and the dates are open again.`,
                'Answering requests quickly helps guests choose your home.',
              ],
              link: hostBookingsLink,
            },
          },
        ]
      : [
          {
            to: 'guest',
            email: {
              subject: `Your booking for ${home(f)} has expired`,
              lines: [
                hello(f.guestName),
                `Your booking at ${home(f)} from ${stay(f)} was not paid in time, so the dates have been released.`,
                'Nothing was charged. You can book again if the dates are still free.',
              ],
              link: { label: 'Look at the home again', path: `/listings/${f.listingId}` },
            },
            inApp: { title: 'Your booking expired', body: `${home(f)}, ${stay(f)}. It was not paid in time. Nothing was charged.` },
          },
          {
            to: 'host',
            email: {
              subject: `An unpaid booking for ${home(f)} has expired`,
              lines: [
                hello(f.hostName),
                `A booking for ${home(f)} from ${stay(f)} was not paid in time, so it has ended and the dates are open again.`,
              ],
              link: hostBookingsLink,
            },
          },
        ],
  },

  'payment.failed': {
    label: 'A payment does not go through',
    render: (f) => [{
      to: 'guest',
      email: {
        subject: `Your payment for ${home(f)} did not go through`,
        lines: [
          hello(f.guestName),
          `Your payment for ${home(f)} from ${stay(f)} was not completed, so nothing was charged.`,
          f.payBy ? `Your booking is still waiting. You can try again until ${payByText(f)}.` : 'Your booking is still waiting, and you can try again.',
        ],
        link: { label: 'Try again', path: `/checkout/${f.bookingId}` },
      },
    }],
  },

  'payment.late_refund': {
    label: 'A payment arrives for a booking that no longer stands',
    render: (f) => [
      {
        to: 'guest',
        email: {
          subject: `Your payment for ${home(f)} is being refunded`,
          lines: [
            hello(f.guestName),
            `Your payment of ${paid(f)} reached us after the booking for ${home(f)} from ${stay(f)} had ended, so the booking could not be confirmed.`,
            `We are refunding the whole amount: ${refund(f)}. ${REFUND_TIMING}`,
          ],
          link: bookingLink(f),
        },
      },
      {
        to: 'admin',
        inApp: { title: 'A payment arrived for a booking that had ended', body: `${home(f)}: ${usd(f.refundUsd ?? 0)} is owed back to the guest in full. Booking ${f.bookingId}.` },
      },
    ],
  },

  'booking.cancelled_by_guest': {
    label: 'A guest cancels a booking',
    render: (f) => [
      {
        to: 'guest',
        email: {
          subject: `Your booking for ${home(f)} is cancelled`,
          lines: [
            hello(f.guestName),
            `Your booking at ${home(f)} from ${stay(f)} has been cancelled, as you asked.`,
            f.refundUsd
              ? `You will be refunded ${refund(f)}. ${REFUND_TIMING}`
              : f.paidPesewas ? 'Under the cancellation policy for this booking, nothing is refunded.' : 'Nothing was charged.',
          ],
          link: bookingLink(f),
        },
      },
      {
        to: 'host',
        email: {
          subject: `A guest cancelled their booking for ${home(f)}`,
          lines: [
            hello(f.hostName),
            `${firstName(f.guestName) || 'Your guest'} cancelled their booking for ${home(f)} from ${stay(f)}.`,
            'Those dates are open again for other guests.',
          ],
          link: hostBookingsLink,
        },
        sms: sms(f.title, (t) => `FieGH: The guest cancelled their booking for "${t}", ${shortStay(f)}. Those dates are open again. ${hostUrl(f)}`),
        inApp: { title: 'A guest cancelled a booking', body: `${home(f)}, ${stay(f)}. Those dates are open again.` },
      },
    ],
  },

  'booking.request_withdrawn': {
    label: 'A guest withdraws a request',
    render: (f) => [{
      to: 'host',
      email: {
        subject: `A booking request for ${home(f)} was withdrawn`,
        lines: [
          hello(f.hostName),
          `The guest withdrew their request to stay at ${home(f)} from ${stay(f)}. There is nothing for you to do.`,
        ],
        link: hostBookingsLink,
      },
      inApp: { title: 'A booking request was withdrawn', body: `${home(f)}, ${stay(f)}. There is nothing for you to do.` },
    }],
  },

  'booking.cancelled_by_host': {
    label: 'A host cancels a confirmed booking',
    render: (f) => [
      {
        to: 'guest',
        email: {
          subject: `Your host cancelled your booking for ${home(f)}`,
          lines: [
            hello(f.guestName),
            `We are sorry: your host has cancelled your booking at ${home(f)} from ${stay(f)}.`,
            f.refundUsd ? `You will be refunded in full: ${refund(f)}. ${REFUND_TIMING}` : 'Nothing was charged.',
            `If you need help finding another home for these dates, write to ${f.supportEmail}.`,
          ],
          link: { label: 'Find another home', path: '/search' },
        },
        sms: sms(f.title, (t) => `FieGH: Your host cancelled your booking for "${t}", ${shortStay(f)}. ${f.refundUsd ? 'You will be refunded in full.' : 'Nothing was charged.'} Details: ${bookingUrl(f)}`),
        inApp: { title: 'Your host cancelled your booking', body: `${home(f)}, ${stay(f)}. ${f.refundUsd ? 'You will be refunded in full.' : 'Nothing was charged.'}` },
      },
      {
        to: 'host',
        email: {
          subject: `You cancelled a booking for ${home(f)}`,
          lines: [
            hello(f.hostName),
            `You cancelled the booking for ${home(f)} from ${stay(f)}. The guest has been told${f.refundUsd ? ' and will be refunded in full' : ''}.`,
            'The dates are open again.',
          ],
          link: hostBookingsLink,
        },
      },
      {
        to: 'admin',
        email: {
          subject: 'A host cancelled a confirmed booking',
          lines: [
            `${home(f)}, ${stay(f)}.`,
            `Reason given: ${f.cancelReason ?? 'none'}.`,
            f.refundUsd ? `The guest is owed ${usd(f.refundUsd)}.` : 'Nothing had been paid.',
            `Booking ${f.bookingId}.`,
          ],
          link: adminLink,
        },
      },
    ],
  },

  'refund.sent': {
    label: 'A refund is sent',
    render: (f) => [{
      to: 'guest',
      email: {
        subject: 'Your refund is on its way',
        lines: [
          hello(f.guestName),
          `We have sent your refund of ${refund(f)} for ${home(f)}.`,
          REFUND_TIMING,
        ],
        link: bookingLink(f),
      },
    }],
  },

  'refund.arrived': {
    label: 'A refund arrives',
    render: (f) => [{
      to: 'guest',
      email: {
        subject: 'Your refund has been paid',
        lines: [
          hello(f.guestName),
          `Your refund of ${refund(f)} for ${home(f)} has been paid back to the card or mobile money number you paid with.`,
          `If you cannot see it in a few days, write to ${f.supportEmail}.`,
        ],
        link: bookingLink(f),
      },
    }],
  },

  'refund.needs_attention': {
    label: 'A refund fails and needs a person',
    render: (f) => [{
      to: 'admin',
      email: {
        subject: 'A guest refund needs attention',
        lines: [
          `A refund of ${usd(f.refundUsd ?? 0)} for ${home(f)} could not be sent automatically and will not be retried.`,
          `Why: ${f.failureReason ?? 'not recorded'}.`,
          `Refund ${f.refundId}. Booking ${f.bookingId}.`,
        ],
        link: adminLink,
      },
    }],
  },

  'payout.sent': {
    label: 'A payout reaches the host',
    render: (f) => [{
      to: 'host',
      email: {
        subject: `Your payout for ${home(f)} has been sent`,
        lines: [
          hello(f.hostName),
          `We have sent your payout of ${payout(f)} for the stay at ${home(f)} from ${stay(f)}.`,
          'It went to the payout method on your account. Mobile money usually arrives within minutes; a bank account can take a working day.',
        ],
        link: payoutsLink,
      },
      sms: sms(f.title, (t) => `FieGH: Your payout of ${f.payoutPesewas ? smsGhs(f.payoutPesewas) : usd(f.payoutUsd ?? 0)} for "${t}" has been sent to your payout method. ${payoutsUrl(f)}`),
    }],
  },

  'payout.failed': {
    label: 'A payout fails and needs a person',
    render: (f) => [
      {
        to: 'host',
        email: {
          subject: `Your payout for ${home(f)} is delayed`,
          lines: [
            hello(f.hostName),
            `We could not send your payout of ${usd(f.payoutUsd ?? 0)} for the stay at ${home(f)} from ${stay(f)}.`,
            'Our team has been told and is looking into it. Please check that the payout method on your account is still correct.',
            `If you have questions, write to ${f.supportEmail}.`,
          ],
          link: payoutsLink,
        },
      },
      {
        to: 'admin',
        email: {
          subject: 'A host payout failed',
          lines: [
            `A payout of ${usd(f.payoutUsd ?? 0)} for ${home(f)} failed and will not be retried.`,
            `Why: ${f.failureReason ?? 'not recorded'}.`,
            `Payout ${f.payoutId}. Booking ${f.bookingId}.`,
          ],
          link: adminLink,
        },
      },
    ],
  },

  'payout.waiting': {
    label: 'A payout is waiting for a payout method',
    render: (f) => [{
      to: 'host',
      email: {
        subject: `A payout is waiting for you: ${home(f)}`,
        lines: [
          hello(f.hostName),
          `Your payout of ${usd(f.payoutUsd ?? 0)} for the stay at ${home(f)} from ${stay(f)} is ready, but there is no payout method on your account yet.`,
          'Add a mobile money number or a bank account and we will send it within the hour.',
        ],
        link: { label: 'Add a payout method', path: '/dashboard/host/payouts' },
      },
      sms: sms(f.title, (t) => `FieGH: A payout for "${t}" is waiting. Add a payout method in FieGH to be paid: ${payoutsUrl(f)}`),
    }],
  },

  'payout_method.changed': {
    label: 'A host changes their payout method',
    render: (f) => [{
      to: 'user',
      email: {
        subject: 'Your payout method was changed',
        lines: [
          hello(f.userName),
          `The payout method on your FieGH account was changed to ${f.payoutMethodLabel ?? 'a new account'}.`,
          `If this was you, there is nothing to do. If it was not, write to ${f.supportEmail} straight away.`,
        ],
        link: payoutsLink,
      },
      sms: `FieGH: The payout method on your account was changed. If this was not you, write to ${f.supportEmail} straight away.`,
    }],
  },

  'dispute.raised': {
    label: 'A problem is reported on a booking',
    render: (f) => {
      const byGuest = f.raisedByRole === 'GUEST'
      return [
        {
          to: byGuest ? 'guest' : 'host',
          email: {
            subject: `We have your report about ${home(f)}`,
            lines: [
              hello(byGuest ? f.guestName : f.hostName),
              `We have received your report about ${home(f)} (${stay(f)}): ${f.disputeReason}.`,
              `The ${byGuest ? 'host' : 'guest'} can reply once, and then our team decides. We aim to decide within 3 working days.`,
            ],
            link: { label: 'View your report', path: `/bookings/${f.bookingId}/problem` },
          },
        },
        {
          to: byGuest ? 'host' : 'guest',
          email: {
            subject: `A problem was reported about ${home(f)}`,
            lines: [
              hello(byGuest ? f.hostName : f.guestName),
              `${byGuest ? 'Your guest' : 'Your host'} has reported a problem with the stay at ${home(f)} (${stay(f)}): ${f.disputeReason}.`,
              'You can read it and reply once, with photos if you have them. Our team then decides. We aim to decide within 3 working days.',
              ...(byGuest ? ['Your payout for this stay waits until the decision is made.'] : []),
            ],
            link: { label: 'Read it and reply', path: `/bookings/${f.bookingId}/problem` },
          },
        },
        {
          to: 'admin',
          email: {
            subject: `A ${byGuest ? 'guest' : 'host'} reported a problem`,
            lines: [`${home(f)}, ${stay(f)}: ${f.disputeReason}.`, `Booking ${f.bookingId}.`],
            link: adminLink,
          },
        },
      ]
    },
  },

  'dispute.replied': {
    label: 'The other side replies to a reported problem',
    render: (f) => {
      const byGuest = f.raisedByRole === 'GUEST'
      return [
        {
          to: byGuest ? 'guest' : 'host',
          email: {
            subject: `There is a reply to your report about ${home(f)}`,
            lines: [
              hello(byGuest ? f.guestName : f.hostName),
              `The ${byGuest ? 'host' : 'guest'} has replied to the problem you reported about ${home(f)}.`,
              'Our team will now decide. We aim to decide within 3 working days.',
            ],
            link: { label: 'Read the reply', path: `/bookings/${f.bookingId}/problem` },
          },
        },
        {
          to: 'admin',
          email: {
            subject: 'A reported problem has a reply',
            lines: [`${home(f)}: the ${byGuest ? 'host' : 'guest'} has replied. It is ready to decide.`, `Booking ${f.bookingId}.`],
            link: adminLink,
          },
        },
      ]
    },
  },

  'dispute.decided': {
    label: 'A reported problem is decided',
    render: (f) => (['guest', 'host'] as const).map((to) => ({
      to,
      email: {
        subject: `A decision on the problem reported about ${home(f)}`,
        lines: [
          hello(to === 'guest' ? f.guestName : f.hostName),
          `Our team has decided the problem reported about ${home(f)} (${stay(f)}).`,
          `Decision: ${f.outcomeLabel}.`,
          ...(f.resolution ? [`Why: ${f.resolution}`] : []),
          ...(to === 'guest' && f.refundUsd ? [`You will be refunded ${refund(f)}. ${REFUND_TIMING}`] : []),
          'Decisions are final.',
        ],
        link: { label: 'View the decision', path: `/bookings/${f.bookingId}/problem` },
      },
    })),
  },

  'dispute.correction': {
    label: 'A correction is written on a decided problem',
    render: (f) => (['guest', 'host'] as const).map((to) => ({
      to,
      email: {
        subject: `An update on the problem reported about ${home(f)}`,
        lines: [
          hello(to === 'guest' ? f.guestName : f.hostName),
          `Our team has added a note to the problem reported about ${home(f)}:`,
          f.note ?? '',
        ],
        link: { label: 'View it', path: `/bookings/${f.bookingId}/problem` },
      },
    })),
  },

  'verification.submitted': {
    label: 'Someone submits their ID',
    render: (f) => [{
      to: 'admin',
      inApp: { title: 'An ID is waiting for review', body: `${firstName(f.userName) || 'Someone'} has submitted their ID. Open the Verifications tab to review it.` },
    }],
  },

  'verification.decided': {
    label: 'An ID check is approved or rejected',
    render: (f) => {
      const approved = f.verificationStatus === 'APPROVED'
      return [{
        to: 'user',
        email: {
          subject: approved ? 'Your ID has been verified' : 'We could not verify your ID',
          lines: approved
            ? [hello(f.userName), 'Your ID has been checked and your account is now verified. Your profile shows the Verified badge.']
            : [
                hello(f.userName),
                'We could not verify the ID you sent. This is usually because the photo was unclear or part of the document was cut off.',
                `You can send it again at any time. If you need help, write to ${f.supportEmail}.`,
              ],
          link: approved ? { label: 'Open FieGH', path: '/' } : { label: 'Send your ID again', path: '/auth/verify-id' },
        },
        inApp: approved
          ? { title: 'Your ID has been verified', body: 'Your account is now verified and your profile shows the Verified badge.' }
          : { title: 'We could not verify your ID', body: 'Please send a clear photo of the whole document again.' },
      }]
    },
  },

  'listing.held': {
    label: 'An admin switches a listing off',
    render: (f) => [{
      to: 'host',
      email: {
        subject: `Your listing ${home(f)} has been switched off`,
        lines: [
          hello(f.hostName),
          `Our team has switched off your listing ${home(f)}, so guests cannot see or book it for now.`,
          `Bookings already confirmed are not affected. To find out why, or to have it looked at again, write to ${f.supportEmail}.`,
        ],
        link: { label: 'Open your dashboard', path: '/dashboard/host' },
      },
      inApp: { title: 'Your listing has been switched off', body: `${home(f)} is hidden from guests for now. Write to ${f.supportEmail} to have it looked at again.` },
    }],
  },

  'listing.auto_held': {
    label: 'A listing is held for containing contact details',
    render: (f) => [
      {
        to: 'host',
        email: {
          subject: `Your listing ${home(f)} is on hold`,
          lines: [
            hello(f.hostName),
            `Your listing ${home(f)} is on hold because its description looks like it contains contact details (a phone number, an email address or a messaging app).`,
            'Listings cannot carry contact details: it keeps bookings and payments safe for you and your guests. Please remove them, and our team will switch the listing back on.',
          ],
          link: { label: 'Edit your listing', path: `/dashboard/host/listings/${f.listingId}/edit` },
        },
        inApp: { title: 'Your listing is on hold', body: `${home(f)}: the description looks like it contains contact details. Remove them and our team will switch it back on.` },
      },
      {
        to: 'admin',
        inApp: { title: 'A listing was put on hold', body: `${home(f)}: the description looks like it contains contact details. Open the Listings tab to review it.` },
      },
    ],
  },

  'listing.reactivated': {
    label: 'An admin switches a listing back on',
    render: (f) => [{
      to: 'host',
      email: {
        subject: `Your listing ${home(f)} is live again`,
        lines: [hello(f.hostName), `Your listing ${home(f)} has been switched back on. Guests can see and book it again.`],
        link: { label: 'View your listing', path: `/listings/${f.listingId}` },
      },
      inApp: { title: 'Your listing is live again', body: `${home(f)} has been switched back on.` },
    }],
  },

  'message.received': {
    label: 'A new message in the inbox',
    optional: true,
    render: (f) => [{
      to: 'user',
      email: {
        subject: 'You have a new message on FieGH',
        lines: [
          hello(f.userName),
          `${firstName(f.senderName) || 'Someone'} sent you a message${f.title ? ` about ${f.title}` : ''}.`,
          'Open your inbox to read it and reply. Please keep messages and payments on FieGH.',
        ],
        link: { label: 'Open your inbox', path: f.inboxPath ?? '/dashboard/guest/messages' },
      },
    }],
  },

  'booking.completed': {
    label: 'A stay ends: please review',
    optional: true,
    render: (f) => [
      {
        to: 'guest',
        email: {
          subject: `How was your stay at ${home(f)}?`,
          lines: [
            hello(f.guestName),
            `We hope you enjoyed your stay at ${home(f)}.`,
            'A short review helps other guests and your host. It is shown once you have both written one.',
          ],
          link: { label: 'Write a review', path: '/dashboard/guest' },
        },
      },
      {
        to: 'host',
        email: {
          subject: `How was your guest at ${home(f)}?`,
          lines: [
            hello(f.hostName),
            `The stay at ${home(f)} from ${stay(f)} has ended.`,
            'A short review of your guest helps other hosts. It is shown once you have both written one.',
          ],
          link: { label: 'Write a review', path: '/dashboard/host/bookings' },
        },
      },
    ],
  },

  'review.received': {
    label: 'Someone is reviewed',
    optional: true,
    render: (f) => [{
      to: 'user',
      email: {
        subject: f.reviewPublished ? 'You have a new review' : 'You have been reviewed',
        lines: [
          hello(f.userName),
          f.reviewPublished
            ? `${firstName(f.senderName) || 'Someone'} reviewed you after the stay at ${home(f)}. You can read it on your profile.`
            : `${firstName(f.senderName) || 'Someone'} has written a review after the stay at ${home(f)}. Write yours and you will both see what the other said.`,
        ],
        link: f.reviewPublished ? { label: 'Read it', path: '/profile/edit' } : { label: 'Write your review', path: f.inboxPath ?? '/dashboard/guest' },
      },
    }],
  },

  'account.welcome': {
    label: 'Someone creates an account',
    optional: true,
    render: (f) => [{
      to: 'user',
      email: {
        subject: 'Welcome to FieGH',
        lines: [
          hello(f.userName),
          'Akwaaba, and welcome to FieGH. Fie means home in Twi.',
          'You can find a home for a few nights, a few months or the long term, and pay safely by mobile money or card. FieGH holds your payment until after you have checked in.',
          'Verifying your ID takes a few minutes and helps hosts say yes.',
        ],
        link: { label: 'Find a home', path: '/search' },
      },
    }],
  },

  'account.became_host': {
    label: 'A guest becomes a host',
    optional: true,
    render: (f) => [{
      to: 'user',
      email: {
        subject: 'Welcome to hosting on FieGH',
        lines: [
          hello(f.userName),
          'Your account can now host. Three things get you ready for your first guest:',
          '1. Add your home, with clear photos and an honest description.',
          '2. Add a payout method, so we can pay you.',
          '3. Verify your ID, so guests know who they are booking with.',
        ],
        link: { label: 'Open your host dashboard', path: '/dashboard/host' },
      },
    }],
  },
} satisfies Record<string, Template>

export type EventName = keyof typeof TEMPLATES
export const EVENT_NAMES = Object.keys(TEMPLATES) as EventName[]

/** The body stored in the log and sent as the plain-text email. */
export function emailText(email: NonNullable<Piece['email']>, appUrl: string, footer: string): string {
  return [
    ...email.lines.filter(Boolean),
    ...(email.link ? [`${email.link.label}: ${appUrl}${email.link.path}`] : []),
    footer,
  ].join('\n\n')
}

/** What goes under every email. Optional ones say how to turn them off. */
export function emailFooter(f: Pick<Facts, 'appUrl' | 'supportEmail'>, optional: boolean): string {
  return optional
    ? `FieGH. You can turn off emails like this one in your profile: ${f.appUrl}/profile/edit`
    : `FieGH. This message is about your booking or your account, so it is always sent. Questions? Write to ${f.supportEmail}`
}

// ── Sample data for the admin preview ──────────────────────────────────────

export const SAMPLE_FACTS: Facts = {
  appUrl: 'https://fiegh.com',
  supportEmail: 'support@fiegh.com',
  bookingId: 'cmexamplebooking0000000001',
  listingId: 'cmexamplelisting0000000001',
  title: 'Sea-view apartment in Labadi with a garden',
  checkIn: new Date('2027-03-09T12:00:00Z'),
  checkOut: new Date('2027-03-12T12:00:00Z'),
  guestName: 'Ama Owusu',
  hostName: 'Kwame Mensah',
  userName: 'Ama Owusu',
  senderName: 'Kwame Mensah',
  totalUsd: 386,
  usdToGhs: 15.5,
  paidPesewas: 598_300,
  payBy: new Date('2027-03-02T15:45:00Z'),
  hostHasPayoutMethod: false,
  cancelReason: 'The home is no longer available',
  refundUsd: 386,
  refundPesewas: 598_300,
  refundId: 'cmexamplerefund00000000001',
  expiredFor: 'UNPAID_EXPIRED',
  payoutUsd: 276,
  payoutPesewas: 427_800,
  payoutId: 'cmexamplepayout00000000001',
  payoutMethodLabel: 'MTN Mobile Money, ending 4567',
  failureReason: 'Paystack returned HTTP 400: Account closed',
  raisedByRole: 'GUEST',
  disputeReason: 'The home was not clean',
  outcomeLabel: 'Part of the stay price is refunded to the guest',
  resolution: 'The photos show the kitchen and bathroom had not been cleaned. One night is refunded.',
  note: 'The refund amount in our first message was wrong. The correct amount is $95.00.',
  verificationStatus: 'APPROVED',
  inboxPath: '/dashboard/guest/messages',
  reviewPublished: true,
}

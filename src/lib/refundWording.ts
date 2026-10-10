// What a guest is told about a refund, from the Refund row alone.

import { formatUsd } from '@/lib/utils'
import { SUPPORT_EMAIL } from '@/lib/contact'

export type RefundSummary = { amount: number; status: string; processedAt?: string | Date | null }

export function refundStatusText(refund: RefundSummary): string {
  const amount = formatUsd(refund.amount)
  if (refund.status === 'PROCESSED') {
    const on = refund.processedAt
      ? ` on ${new Date(refund.processedAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
      : ''
    return `${amount} was refunded${on}.`
  }
  if (refund.status === 'PROCESSING') {
    return `A refund of ${amount} is on its way. It can take up to 10 working days to arrive.`
  }
  if (refund.status === 'PENDING') {
    return `A refund of ${amount} is owed to you and will be sent to the card or mobile money number you paid with.`
  }
  // FAILED or NEEDS_ATTENTION: a person is looking at it
  return `A refund of ${amount} is owed to you. Our team is handling it. Contact ${SUPPORT_EMAIL} if you have questions.`
}

// What FieGH charges, in words. Every sentence and figure on the site that
// states a fee is built here from the two rates in lib/utils.ts, so the copy
// cannot say one thing while the sums do another. Change a rate there and
// everything here follows.
//
// Nothing here is advice about tax or the law.

import { PLATFORM_COMMISSION, SERVICE_FEE_RATE } from '@/lib/utils'

/** A rate as a percentage: 0.1 as "10%", 0.125 as "12.5%". */
export function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`
}

/** Whether guests are charged a service fee on new bookings at all. */
export const GUEST_FEE_CHARGED = SERVICE_FEE_RATE > 0
export const GUEST_FEE_PERCENT = percent(SERVICE_FEE_RATE)
export const COMMISSION_PERCENT = percent(PLATFORM_COMMISSION)
/** The share of the rent a host is paid. */
export const HOST_KEEPS_PERCENT = percent(1 - PLATFORM_COMMISSION)

export const GUEST_FEE_LINE = GUEST_FEE_CHARGED
  ? `Guests pay a ${GUEST_FEE_PERCENT} service fee, added to the price.`
  : 'Guests pay no service fee.'
export const HOST_COMMISSION_LINE =
  `Hosts keep ${HOST_KEEPS_PERCENT} of the rent: FieGH takes a ${COMMISSION_PERCENT} commission from each payout.`

/**
 * The rule for refunding a service fee, or nothing when there is no fee to
 * refund. `price` is "stay price" or "rent".
 */
export function serviceFeeRefundRule(price: string, hasServiceFee: boolean = GUEST_FEE_CHARGED): string | null {
  return hasServiceFee ? `The service fee is refunded only when the whole ${price} is refunded.` : null
}

// When a guest can still cancel a confirmed booking themselves.
//
// Once the stay has started, or the host has a payout for it, cancelling
// online would free the dates and leave money already owed or sent to the
// host with nothing to undo it. Those cases go to support instead.

import { dayKey } from '@/lib/hostCalendar'
import { ghanaToday } from '@/lib/stayDates'
import { SUPPORT_EMAIL } from '@/lib/contact'

export const CANCEL_CONTACT_SUPPORT =
  `This booking can no longer be cancelled online, because the stay has started or the host has been paid. Please contact support at ${SUPPORT_EMAIL}.`

/**
 * True when the guest must contact support to cancel: the check-in day has
 * arrived (in Ghana, where the home is), or a payout exists for the booking
 * in any state.
 */
export function cancelNeedsSupport(checkIn: Date, hasPayout: boolean, now: Date = new Date()): boolean {
  return hasPayout || ghanaToday(now) >= dayKey(checkIn)
}

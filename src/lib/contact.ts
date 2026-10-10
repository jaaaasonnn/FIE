// How people reach FieGH. One support address, used on every page and in
// every message, so nobody is ever sent to an inbox that does not exist.
// No database and no network, so pages can use it too.

export const SUPPORT_EMAIL = 'support@fiegh.com'

/**
 * The support phone number, from SUPPORT_PHONE. Server only. Null when it is
 * not set, in which case no phone number is shown anywhere: a placeholder is
 * never shown in its place.
 */
export function supportPhone(): string | null {
  return process.env.SUPPORT_PHONE?.trim() || null
}

// Listings must not carry contact details, so guests and hosts cannot be
// steered off the platform. A description that trips this puts the listing
// on moderation hold: it is switched off and only an admin can reactivate it.
const CONTACT_PATTERN = /(\+?233|\b0[2-5]\d{8}\b|\b\d{10}\b|@gmail|@yahoo|whatsapp)/i

export function hasContactDetails(text: string | null | undefined): boolean {
  return CONTACT_PATTERN.test(text || '')
}

// Reporting a listing (the flag on the listing page). Until a reports system exists (a table and an admin tab:
// CLAUDE.md, FINDINGS), a report is an email to support that the person sends themselves. Imports nothing, so
// the dialog's file stays small. The reasons' wording is the owner's (2026-11-15).

export const REPORT_REASONS = [
  'Wrong or misleading information',
  'Not available or doesn\'t exist',
  'Scam or suspicious',
  'Something else',
] as const

/** A mailto: address with the listing and the reason filled in. The person sees it in their own mail app first. */
export function reportMailto(o: { to: string; id: string; title: string; url: string; reason: string; note?: string }): string {
  // One line each, so a title or note cannot add lines that look like other fields
  const line = (s: string) => s.replace(/\s+/g, ' ').trim()
  const note = (o.note ?? '').replace(/\r\n?/g, '\n').trim()
  const subject = `Report: listing ${line(o.id)}`
  const body = [
    `Listing: ${line(o.title)}`,
    `Listing id: ${line(o.id)}`,
    `Link: ${line(o.url)}`,
    `Reason: ${line(o.reason)}`,
    ...(note ? ['', note] : []),
  ].join('\n')
  return `mailto:${o.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

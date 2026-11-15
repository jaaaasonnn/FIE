import { describe, it, expect } from 'vitest'
import { REPORT_REASONS, reportMailto } from './listingReport'

const parse = (m: string) => {
  const [to, query] = m.replace(/^mailto:/, '').split('?')
  const q = new URLSearchParams(query.replace(/\+/g, '%2B'))
  return { to, subject: q.get('subject'), body: q.get('body') }
}

describe('reporting a listing by email', () => {
  it('has the four reasons in the owner\'s words, in order', () => {
    expect(REPORT_REASONS).toEqual(['Wrong or misleading information', 'Not available or doesn\'t exist', 'Scam or suspicious', 'Something else'])
  })

  it('writes the listing id, title, link and reason into the email, and the note after them', () => {
    const m = parse(reportMailto({ to: 'support@fiegh.com', id: 'abc123', title: 'Quiet flat & garden', url: 'https://fiegh.com/listings/abc123', reason: 'Scam or suspicious', note: 'Asked me to pay by bank transfer.\nTwice.' }))
    expect(m.to).toBe('support@fiegh.com')
    expect(m.subject).toBe('Report: listing abc123')
    expect(m.body).toBe('Listing: Quiet flat & garden\nListing id: abc123\nLink: https://fiegh.com/listings/abc123\nReason: Scam or suspicious\n\nAsked me to pay by bank transfer.\nTwice.')
  })

  it('leaves the note out when there is none, and keeps the title on one line', () => {
    const m = parse(reportMailto({ to: 's@x', id: 'i', title: 'Two\nlines', url: 'u', reason: 'Something else', note: '   ' }))
    expect(m.body).toBe('Listing: Two lines\nListing id: i\nLink: u\nReason: Something else')
  })

  it('encodes everything, so a title cannot add fields to the address', () => {
    const m = reportMailto({ to: 's@x', id: 'i', title: 'A&cc=evil@x.com?b', url: 'u', reason: 'Something else' })
    expect(m.split('&').length).toBe(2)
    expect(m).not.toContain('cc=evil')
  })
})

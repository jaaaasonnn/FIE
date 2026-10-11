// Who may run a cron job: whoever sends the shared secret. Vercel's cron
// sends `Authorization: Bearer <CRON_SECRET>` by itself when the variable is set.

import crypto from 'crypto'

/**
 * True when the request carries the cron secret. With no secret set, nobody
 * is let in. The two values are hashed and then compared in constant time, so
 * how long the answer takes says nothing about how much of a guess was right.
 */
export function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = req.headers.get('authorization') ?? ''
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest()
  return crypto.timingSafeEqual(digest(given), digest(`Bearer ${secret}`))
}

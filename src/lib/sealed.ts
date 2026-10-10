// Keeping a secret out of the message log. A message that carries a
// single-use link, or goes to an address other than the one on the account,
// stores that token and address encrypted in MessageLog.sealed. The log's
// body shows "[token]" where the token goes, so neither the database nor the
// admin page ever holds a link that works.
//
// AES-256-GCM, with a key derived from NEXTAUTH_SECRET. If that secret is
// changed, anything still waiting to be sent can no longer be opened: the
// message is skipped and the person asks for a new link.

import crypto from 'crypto'

/** What stands in the stored body for the secret token. */
export const TOKEN_PLACEHOLDER = '[token]'

export type Sealed = {
  /** The raw single-use token that replaces TOKEN_PLACEHOLDER when the message is sent */
  token?: string
  /** The address to send to, when it is not the one on the account */
  to?: string
}

function key(): Buffer | null {
  const secret = process.env.NEXTAUTH_SECRET
  // A short or missing secret is no secret: refuse rather than seal weakly
  if (!secret || secret.length < 16) return null
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'fiegh', 'message-seal-v1', 32))
}

/** True when a secret is configured to seal with. */
export function canSeal(): boolean {
  return key() !== null
}

/** Encrypts the token and address. Null when there is no secret to do it with. */
export function seal(value: Sealed): string | null {
  const k = key()
  if (!k) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), body].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.')
}

/** Opens what seal() made. Null for anything else: tampered with, sealed under another secret, or not sealed text at all. */
export function unseal(sealed: string | null | undefined): Sealed | null {
  const k = key()
  if (!k || !sealed) return null
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !body) return null
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const text = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
    const value = JSON.parse(text) as Sealed
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

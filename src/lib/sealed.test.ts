import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOKEN_PLACEHOLDER, canSeal, seal, unseal } from '@/lib/sealed'

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_SECRET', 'a-test-secret-that-is-long-enough')
})

describe('sealing a secret for the message log', () => {
  const secret = { token: 'q7Jc0lq0p3v9Xw2bT1mN8sKfYhRzUeAaGdLo4iVt5Bg', to: 'ama@example.test' }

  it('gives back exactly what went in', () => {
    expect(unseal(seal(secret))).toEqual(secret)
    expect(unseal(seal({ to: 'old@example.test' }))).toEqual({ to: 'old@example.test' })
  })

  it('shows nothing of the token or the address', () => {
    const sealed = seal(secret)!
    expect(sealed).not.toContain(secret.token)
    expect(sealed).not.toContain('ama')
    expect(Buffer.from(sealed.split('.')[3], 'base64url').toString('latin1')).not.toContain(secret.token)
    expect(sealed.startsWith('v1.')).toBe(true)
  })

  it('is different every time, even for the same secret', () => {
    expect(seal(secret)).not.toBe(seal(secret))
  })

  it('cannot be opened once it has been altered', () => {
    const sealed = seal(secret)!
    const parts = sealed.split('.')
    const flipped = Buffer.from(parts[3], 'base64url')
    flipped[0] ^= 1
    expect(unseal([parts[0], parts[1], parts[2], flipped.toString('base64url')].join('.'))).toBeNull()
    expect(unseal([parts[0], parts[1], Buffer.alloc(16).toString('base64url'), parts[3]].join('.'))).toBeNull()
  })

  it('cannot be opened under a different secret', () => {
    const sealed = seal(secret)
    vi.stubEnv('NEXTAUTH_SECRET', 'another-secret-that-is-long-enough')
    expect(unseal(sealed)).toBeNull()
  })

  it('returns null for anything that is not sealed text', () => {
    for (const bad of [null, undefined, '', 'plain text', 'v1.a.b', 'v2.a.b.c', '{"token":"x"}']) expect(unseal(bad as string)).toBeNull()
  })

  it('refuses to seal with no secret, or one too short to be a secret', () => {
    for (const weak of ['', 'short', '123456789012345']) {
      vi.stubEnv('NEXTAUTH_SECRET', weak)
      expect(canSeal(), weak).toBe(false)
      expect(seal(secret)).toBeNull()
    }
    vi.stubEnv('NEXTAUTH_SECRET', '1234567890123456')
    expect(canSeal()).toBe(true)
  })

  it('uses a placeholder a real token can never look like', () => {
    expect(TOKEN_PLACEHOLDER).toBe('[token]')
    expect(TOKEN_PLACEHOLDER).not.toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

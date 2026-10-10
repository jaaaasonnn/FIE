import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Small safeguards: test-only adapters cannot be used in production, the old
// ways round the dispute switch are gone, and there is one support address
// and no placeholder contact details anywhere on the site.

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)

import { channelGate, isProduction, messagingConfig, resetTestAdapterAlerts } from '@/lib/messaging/config'
import { PROVIDERS } from '@/lib/messaging/providers'
import { SUPPORT_EMAIL, supportPhone } from '@/lib/contact'

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.resolve(root, file), 'utf8')
/** Every source file under src, other than tests. */
function sources(dir = root): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : []
  })
}
const rel = (file: string) => path.relative(root, file)

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('VERCEL_ENV', '')
  sentry.captureMessage.mockReset()
  resetTestAdapterAlerts()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('test-only adapters', () => {
  const drills = [['EMAIL', 'EMAIL_PROVIDER', 'fail-drill-email'], ['SMS', 'SMS_PROVIDER', 'fail-drill-sms']] as const
  const production = [['NODE_ENV', 'production'], ['VERCEL_ENV', 'production']] as const

  it('are exactly the two drill adapters, and the real one is not among them', () => {
    const testOnly = Object.values(PROVIDERS).filter((p) => p.testOnly).map((p) => p.name).sort()
    expect(testOnly).toEqual(['fail-drill-email', 'fail-drill-sms'])
    expect(PROVIDERS.resend.testOnly).toBeFalsy()
  })

  it.each(drills)('%s: the drill adapter can be chosen outside production', (channel, setting, name) => {
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    vi.stubEnv(setting, name)
    expect(channelGate(channel)).toEqual({ live: true, provider: name })
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  for (const [envName, envValue] of production) {
    it.each(drills)(`%s: choosing the drill adapter with ${envName}=${envValue} is treated as not live, with an alert`, (channel, setting, name) => {
      vi.stubEnv(envName, envValue)
      vi.stubEnv('MESSAGING_ENABLED', 'true')
      vi.stubEnv(setting, name)
      expect(isProduction()).toBe(true)
      const gate = channelGate(channel)
      expect(gate).toEqual({ live: false, provider: 'log', reason: `${setting} names a test-only adapter, which cannot be used in production` })
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
      const [message, options] = sentry.captureMessage.mock.calls[0]
      expect(message).toContain('test-only adapter in production')
      expect(options).toMatchObject({ level: 'error', tags: { messaging_issue: 'TEST_ADAPTER_IN_PRODUCTION', channel } })
    })
  }

  it('alerts once per channel, however often the gate is read', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    vi.stubEnv('EMAIL_PROVIDER', 'fail-drill-email')
    vi.stubEnv('SMS_PROVIDER', 'fail-drill-sms')
    for (let i = 0; i < 5; i++) { channelGate('EMAIL'); channelGate('SMS') }
    expect(sentry.captureMessage).toHaveBeenCalledTimes(2)
  })

  it('does not get in the way of the real adapter in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MESSAGING_ENABLED', 'true')
    vi.stubEnv('EMAIL_PROVIDER', 'resend')
    expect(channelGate('EMAIL')).toEqual({ live: true, provider: 'resend' })
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('says nothing, and sends nothing, when messaging is off anyway', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EMAIL_PROVIDER', 'fail-drill-email')
    expect(channelGate('EMAIL')).toMatchObject({ live: false, provider: 'log' })
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('counts a production build and a Vercel production deployment, and nothing else', () => {
    expect(isProduction()).toBe(false)
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(isProduction()).toBe(false)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(isProduction()).toBe(true)
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(isProduction()).toBe(true)
  })
})

describe('the admin actions that went round the switches', () => {
  it('are gone: no resolve-dispute and no pretend suspend-user', () => {
    const route = read('app/api/admin/route.ts')
    expect(route).not.toMatch(/resolve-dispute|suspend-user/)
    // It still counts open disputes for the overview; it never writes one
    expect(route).not.toMatch(/dispute\.(update|updateMany|create|upsert|delete)/)
    for (const file of sources()) expect(fs.readFileSync(file, 'utf8'), rel(file)).not.toMatch(/['"`](resolve-dispute|suspend-user)['"`]/)
  })

  it('leave a dispute writable in one place only: the decision code and the dispute routes', () => {
    const writers = sources().filter((file) => /\.dispute\.(update|updateMany|create|upsert|delete|deleteMany)\b/.test(fs.readFileSync(file, 'utf8'))).map(rel).sort()
    expect(writers).toEqual(['app/api/admin/disputes/route.ts', 'app/api/bookings/[id]/disputes/route.ts', 'app/api/disputes/[id]/route.ts', 'lib/disputeDecisions.ts'])
    // And the admin one moves a dispute to RESOLVED only through decideDispute
    expect(read('app/api/admin/disputes/route.ts')).not.toMatch(/status: 'RESOLVED'/)
  })

  it('send nothing made up with a payment from the checkout page', () => {
    const page = read('app/checkout/[id]/page.tsx')
    expect(page).not.toMatch(/guest@fiegh\.com/)
    expect(page).not.toMatch(/amount:\s+payAmount/)
  })
})

describe('how people reach FieGH', () => {
  it('is one support address, written once', () => {
    expect(SUPPORT_EMAIL).toBe('support@fiegh.com')
    expect(messagingConfig().supportEmail).toBe(SUPPORT_EMAIL)
    expect(messagingConfig().emailFrom).toBe(`FieGH <${SUPPORT_EMAIL}>`)
    const spelledOut = sources().filter((file) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').includes('support@fiegh.com')).map(rel)
    expect(spelledOut).toEqual(['lib/contact.ts'])
  })

  it('has no other FieGH address anywhere on the site', () => {
    for (const file of sources()) {
      const text = fs.readFileSync(file, 'utf8')
      expect(text, rel(file)).not.toMatch(/\b(hello|privacy|legal|info|help|contact|guest)@fiegh\.com/)
    }
    for (const doc of ['../README.md', '../CLAUDE.md', '../.env.example']) {
      expect(read(doc), doc).not.toMatch(/\b(hello|privacy|legal|info|contact)@fiegh\.com/)
    }
  })

  it('shows a phone number only when SUPPORT_PHONE is set, and never a placeholder', () => {
    expect(supportPhone()).toBeNull()
    vi.stubEnv('SUPPORT_PHONE', '   ')
    expect(supportPhone()).toBeNull()
    vi.stubEnv('SUPPORT_PHONE', ' +233 30 000 0000 ')
    expect(supportPhone()).toBe('+233 30 000 0000')
    const footer = read('components/layout/Footer.tsx')
    expect(footer).toContain('{phone && (')
    expect(footer).toContain('supportPhone()')
    for (const file of sources()) expect(fs.readFileSync(file, 'utf8'), rel(file)).not.toMatch(/\+233 XX|XX XXX XXXX/)
  })
})

describe('site copy', () => {
  // Arrows, dingbats and emoji. The cedi sign and ordinary punctuation are not in these ranges.
  const SYMBOLS = /[←-⇿☀-➿⬀-⯿]|[\u{1F000}-\u{1FAFF}]/u

  it('has no arrow characters or emoji in anything a person reads', () => {
    for (const file of sources().filter((f) => f.endsWith('.tsx') || /lib\/(messaging\/templates|fees|rentRules|cancellationPolicy|disputes|payDeadline|authTokens)\.ts$/.test(f))) {
      const withoutComments = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, '')
      const found = withoutComments.split('\n').filter((line) => SYMBOLS.test(line))
      expect(found, rel(file)).toEqual([])
    }
  })

  it('has none in the README either', () => {
    expect(read('../README.md').split('\n').filter((line) => SYMBOLS.test(line))).toEqual([])
  })
})

describe('the word "verified"', () => {
  // It may only ever say what was checked. The listing badge never uses it at
  // all; a person's ID is "checked"; the one place it stays is a payout
  // account, where it is followed by the account name Paystack confirmed.
  const ALLOWED: Record<string, RegExp> = {
    'app/dashboard/host/payouts/page.tsx': /verified as \$\{/i,
  }
  // Not words a person reads: a query parameter, an internal result code, and errors about payout methods kept for the logs
  const NOT_COPY = /searchParams\.get\('verified'\)|kind: 'VERIFIED'|no verified payout method/

  it('never appears in anything a person reads without saying what was checked', () => {
    const stray: string[] = []
    for (const file of sources()) {
      const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, '')
      for (const line of text.split('\n')) {
        if (!/\bverified\b/i.test(line) || NOT_COPY.test(line)) continue
        if (ALLOWED[rel(file)]?.test(line)) continue
        stray.push(`${rel(file)}: ${line.trim().slice(0, 120)}`)
      }
    }
    expect(stray).toEqual([])
  })

  it('is not what any badge says', async () => {
    const { CHECK_BADGE, HOST_ID_BADGE, ID_BADGE } = await import('@/lib/listingCheckRules')
    for (const badge of [CHECK_BADGE, HOST_ID_BADGE, ID_BADGE]) expect(badge).not.toMatch(/verif/i)
    const badgeFile = read('components/ui/Badge.tsx')
    expect(badgeFile).not.toMatch(/>\s*Verified\s*</)
    expect(read('components/listing/CheckedBadge.tsx')).toContain('{CHECK_BADGE}')
  })

  it('leaves the FAQ and Terms saying only what the listing check is, from the one approved text', () => {
    expect(read('app/faq/page.tsx')).toContain('questions: CHECK_FAQ')
    expect(read('app/terms/page.tsx')).toContain('body: CHECK_TERMS')
    expect(read('app/faq/page.tsx')).not.toMatch(/Every host goes through/)
    for (const page of ['app/listings/[id]/page.tsx', 'app/search/page.tsx', 'components/home/FeaturedListings.tsx', 'components/map/ListingsMap.tsx']) {
      expect(read(page), page).toContain('<CheckedBadge check=')
    }
  })
})

describe('the cancellation policy default', () => {
  it('is Moderate in the schema, as the app assumes', async () => {
    const { DEFAULT_POLICY } = await import('@/lib/cancellationPolicy')
    expect(DEFAULT_POLICY).toBe('MODERATE')
    expect(read('../prisma/schema.prisma')).toMatch(/cancellationPolicy\s+String\s+@default\("MODERATE"\)/)
  })
})

import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The app's own configuration: what Next is told to do, and which packages it carries.

const root = path.resolve(__dirname, '../../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

async function config(env: Record<string, string> = {}) {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('SUPABASE_URL', 'https://abcdefghijklmnop.supabase.co')
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  const loaded = (await import('../../../next.config')).default as unknown
  const resolved = typeof loaded === 'function' ? await (loaded as (phase: string, ctx: object) => unknown)('phase-production-build', { defaultConfig: {} }) : loaded
  return resolved as { images: { formats: string[]; remotePatterns: { hostname: string; pathname?: string }[] }; headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>; poweredByHeader?: boolean; productionBrowserSourceMaps?: boolean }
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })

describe('images', () => {
  it('optimises photos only from this project\'s own storage and Unsplash', async () => {
    const { images } = await config()
    expect(images.remotePatterns.map((p) => p.hostname).sort()).toEqual(['abcdefghijklmnop.supabase.co', 'images.unsplash.com'])
    expect(images.remotePatterns.some((p) => p.hostname.includes('*'))).toBe(false)
    expect(images.remotePatterns.find((p) => p.hostname.endsWith('supabase.co'))!.pathname).toBe('/storage/v1/object/public/**')
  })

  it('allows no Supabase host at all when the project\'s address is missing, rather than every one', async () => {
    const { images } = await config({ SUPABASE_URL: '' })
    expect(images.remotePatterns.map((p) => p.hostname).sort()).toEqual(['images.unsplash.com', 'storage.invalid'])
  })

  it('does not ask the optimiser for AVIF', async () => {
    expect((await config()).images.formats).toEqual(['image/webp'])
  })
})

describe('headers', () => {
  const headersFor = async (source: string, env: Record<string, string> = {}) => {
    const rules = await (await config(env)).headers!()
    return Object.fromEntries(rules.filter((r) => r.source === source).flatMap((r) => r.headers).map((h) => [h.key, h.value]))
  }

  it('sends the protective headers with every page and API response', async () => {
    const headers = await headersFor('/:path*')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(headers['Permissions-Policy']).toContain('camera=()')
    expect(headers['Permissions-Policy']).toContain('geolocation=()')
  })

  it('sends the content policy as report-only, naming only the hosts the pages use', async () => {
    const headers = await headersFor('/:path*')
    // Report-only for now: the enforcing header is not sent
    expect(headers['Content-Security-Policy']).toBeUndefined()
    const policy = Object.fromEntries(headers['Content-Security-Policy-Report-Only'].split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]))
    expect(policy['default-src']).toEqual(["'self'"])
    expect(policy['frame-ancestors']).toEqual(["'none'"])
    expect(policy['object-src']).toEqual(["'none'"])
    expect(policy['base-uri']).toEqual(["'self'"])
    expect(policy['form-action']).toEqual(["'self'"])
    expect(policy['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://abcdefghijklmnop.supabase.co', 'https://api.maptiler.com'])
    expect(policy['connect-src']).toEqual(["'self'", 'https://api.maptiler.com', 'https://*.sentry.io'])
    for (const sources of Object.values(policy)) for (const source of sources) expect(source).not.toBe('*')
  })

  it('allows eval only on the dev server, and reports to Sentry only in production', async () => {
    const dev = (await headersFor('/:path*'))['Content-Security-Policy-Report-Only']
    expect(dev).toContain("'unsafe-eval'")
    expect(dev).not.toContain('report-uri')
    const live = (await headersFor('/:path*', { NODE_ENV: 'production', NEXT_PUBLIC_SENTRY_DSN: 'https://publickey123@o999.ingest.sentry.io/4242' }))['Content-Security-Policy-Report-Only']
    expect(live).not.toContain("'unsafe-eval'")
    expect(live).toContain('report-uri https://o999.ingest.sentry.io/api/4242/security/?sentry_key=publickey123')
    // No DSN: no report address, and the policy is still sent
    expect((await headersFor('/:path*', { NODE_ENV: 'production', NEXT_PUBLIC_SENTRY_DSN: '' }))['Content-Security-Policy-Report-Only']).not.toContain('report-uri')
  })

  it('tells browsers and proxies never to keep an API response', async () => {
    expect((await headersFor('/api/:path*'))['Cache-Control']).toBe('no-store')
  })

  it('does not say what the site is built with, and never serves source maps to a browser', async () => {
    const built = await config()
    expect(built.poweredByHeader).toBe(false)
    expect(built.productionBrowserSourceMaps).toBe(false)
    expect(read('next.config.ts')).toContain('sourcemaps: { deleteSourcemapsAfterUpload: true }')
  })
})

describe('packages', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version: string }> }

  it('no longer carries the Auth.js packages, which no code used', () => {
    for (const name of ['next-auth', '@auth/prisma-adapter', '@auth/core']) {
      expect(pkg.dependencies[name], name).toBeUndefined()
      expect(lock.packages[`node_modules/${name}`], name).toBeUndefined()
    }
    // And nothing imports them
    const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? sources(full) : /\.(ts|tsx|mjs)$/.test(entry.name) && !entry.name.includes('.test.') ? [full] : []
    })
    for (const file of [...sources(path.join(root, 'src')), ...sources(path.join(root, 'scripts'))]) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/from ['"](next-auth|@auth\/)/)
    }
  })

  it('is on a patched Next 16.3 and a patched sharp', () => {
    // 16.3.8 is the first release with every advisory open on 16.2 fixed
    const [major, minor, patch] = lock.packages['node_modules/next'].version.split('.').map(Number)
    expect([major, minor]).toEqual([16, 3])
    expect(patch).toBeGreaterThanOrEqual(8)
    expect(pkg.dependencies.next).toBe(lock.packages['node_modules/next'].version)
    // Next no longer carries its own, older copy of sharp or an unpatched postcss
    expect(lock.packages['node_modules/next/node_modules/sharp']).toBeUndefined()
    const [, postcssMinor, postcssPatch] = lock.packages['node_modules/next/node_modules/postcss'].version.split('.').map(Number)
    expect(postcssMinor * 100 + postcssPatch).toBeGreaterThanOrEqual(523)
    const [, sharpMinor, sharpPatch] = lock.packages['node_modules/sharp'].version.split('.').map(Number)
    expect(sharpMinor * 100 + sharpPatch).toBeGreaterThanOrEqual(3505)
  })
})

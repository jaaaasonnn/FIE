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

  it('is on a patched Next 16.2 and a patched sharp', () => {
    const [major, minor, patch] = lock.packages['node_modules/next'].version.split('.').map(Number)
    expect([major, minor]).toEqual([16, 2])
    expect(patch).toBeGreaterThanOrEqual(12)
    expect(pkg.dependencies.next).toBe(lock.packages['node_modules/next'].version)
    const [, sharpMinor, sharpPatch] = lock.packages['node_modules/sharp'].version.split('.').map(Number)
    expect(sharpMinor * 100 + sharpPatch).toBeGreaterThanOrEqual(3505)
  })
})

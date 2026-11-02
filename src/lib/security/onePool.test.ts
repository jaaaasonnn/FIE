import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SU2: one Prisma client, so one connection pool, per server process, in production too.
//
// The production build runs db.ts more than once in a process: Turbopack bundles it once for the API
// routes and once for the server-first pages (which import their route's GET into the page's layer).
// Each copy is loaded here as a fresh module (vi.resetModules), as the second bundle copy would be. A
// second `new PrismaClient()` would be a second pool: in production that doubles the connections each
// server instance opens to Supabase's pooler.

const created = vi.hoisted(() => ({ count: 0 }))
vi.mock('@prisma/client', () => ({
  PrismaClient: class { constructor() { created.count++ } },
}))

const slot = globalThis as unknown as { prisma?: unknown }
const loadCopy = async () => { vi.resetModules(); return (await import('@/lib/db')).db }

describe('one Prisma client per process', () => {
  beforeEach(() => { created.count = 0; delete slot.prisma })
  afterEach(() => { vi.unstubAllEnvs(); delete slot.prisma })

  for (const env of ['production', 'development', 'test']) {
    it(`with NODE_ENV=${env}, every copy of db.ts in the process shares one client`, async () => {
      vi.stubEnv('NODE_ENV', env)
      const routes = await loadCopy()
      const pages = await loadCopy()
      const third = await loadCopy()
      expect(created.count).toBe(1)
      expect(pages).toBe(routes)
      expect(third).toBe(routes)
    })
  }
})

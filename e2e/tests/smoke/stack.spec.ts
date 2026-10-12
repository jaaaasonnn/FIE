import fs from 'fs'
import path from 'path'
import { test, expect } from '../../lib/test'
import { db } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { expectInvariants } from '../../lib/invariants'
import { call, cron } from '../../lib/world'

// The harness itself: it is the throwaway database, it is locked down like
// production, and nothing can leave this machine.

test.describe('the test stack @smoke', () => {
  test('the database is the local throwaway one, locked down like production', async () => {
    const [row] = await db.$queryRawUnsafe<Record<string, number | string>[]>(`
      select current_user, current_database() db,
        (select count(*)::int from e2e_marker) marker,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where nspname = 'public' and relkind = 'r' and not relrowsecurity) tables_without_rls,
        (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')) public_role_grants,
        (select count(*)::int from pg_constraint where conname in ('Listing_damageDeposit_nonneg', 'Booking_damageDeposit_nonneg')) deposit_checks`)
    expect(row).toMatchObject({ current_user: 'postgres', db: 'fiegh_e2e', marker: 1, tables_without_rls: 0, public_role_grants: 0, deposit_checks: 2 })
    // The public API roles are refused, as they are in production
    await expect(db.$transaction([db.$executeRawUnsafe('SET LOCAL ROLE anon'), db.$queryRawUnsafe('select count(*) from "User"')])).rejects.toThrow(/permission denied/)
  })

  test('the environment holds no real key and no real address', async () => {
    expect(process.env.DATABASE_URL).toContain('127.0.0.1:54329/fiegh_e2e')
    expect(process.env.PAYSTACK_SECRET_KEY).toMatch(/^sk_test_e2e_/)
    expect(process.env.RESEND_API_KEY).toBe('re_e2e_fake')
    expect(process.env.SENTRY_AUTH_TOKEN ?? '').toBe('')
    expect(new URL(process.env.NEXT_PUBLIC_SENTRY_DSN!).hostname).toBe('127.0.0.1')
    // Every key the real .env has is overridden here, so Next and Prisma never read the real value
    const envFile = path.resolve(__dirname, '../../../.env')
    test.skip(!fs.existsSync(envFile), 'no .env on this machine (CI): nothing real to fall back to')
    const real = fs.readFileSync(envFile, 'utf8').split('\n').map((l) => /^([A-Z_][A-Z0-9_]*)=/.exec(l)?.[1]).filter(Boolean) as string[]
    expect(real.length).toBeGreaterThan(5)
    for (const key of real) expect(process.env[key], `${key} must have a test value`).toBeDefined()
  })

  test('the preload that redirects outside calls is not part of the app or of a normal start', async () => {
    const root = path.resolve(__dirname, '../../..')
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    for (const script of ['dev', 'build', 'start']) expect(pkg.scripts[script]).not.toMatch(/e2e|egress|NODE_OPTIONS/)
    for (const file of ['next.config.ts', 'vercel.json', 'src/instrumentation.ts', 'src/instrumentation-client.ts']) expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toMatch(/egress|e2e\/|E2E_/)
    // And it refuses to load anywhere but under the launcher
    const { spawnSync } = await import('child_process')
    const bare = spawnSync('node', ['--require', path.join(root, 'e2e/preload/egress.cjs'), '-e', '0'], { env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' })
    expect(bare.status).not.toBe(0)
    expect(bare.stderr).toContain('outside the end-to-end launcher')
  })

  test('both app servers answer, and cron routes need the secret', async () => {
    for (const server of [0, 1] as const) {
      expect((await call('GET', '/api/listings?limit=1', undefined, { server })).status).toBe(200)
      expect((await call('GET', '/api/cron/process-payouts', undefined, { server })).status).toBe(401)
      const run = await cron('process-payouts', { server, dryRun: true })
      expect(run.status).toBe(200)
      expect(run.json.mode).toBe('dry-run')
    }
  })

  test('a paid booking: screen-independent money agrees between the database and the fake Paystack', async ({ world }) => {
    const host = await world.host()
    const guest = await world.guest()
    const home = await world.listing(host, { priceNightly: 80 })
    const { id, reference } = await world.paidBooking(guest, home.id, { nights: 3 })
    const booking = await db.booking.findUniqueOrThrow({ where: { id }, include: { payments: true } })
    expect(booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', subtotal: 240, serviceFee: 0, totalPrice: 240 })
    expect(booking.payments).toHaveLength(1)
    const [tx] = await fakes.tx(undefined, reference)
    // What Paystack was asked to charge is the stored cedi amount, to the pesewa
    expect(tx.amount).toBe(booking.payments[0].amountPesewas)
    expect(tx.currency).toBe('GHS')
    expect(tx.amount).toBe(Math.round(240 * booking.payments[0].usdToGhs! * 100))
    await expectInvariants()
  })
})

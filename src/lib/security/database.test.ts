import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// The rules the database itself keeps, and that the files which describe them agree.

const root = path.resolve(__dirname, '../../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const model = (name: string) => new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`).exec(read('prisma/schema.prisma'))![0]

describe('the database\'s own rules', () => {
  it('allows one review per side per booking', () => {
    expect(model('Review')).toContain('@@unique([bookingId, reviewerId, type])')
  })

  it('refuses a negative damage deposit on a listing and on a booking', () => {
    const sql = read('prisma/constraints.sql')
    expect(sql).toMatch(/ALTER TABLE public\."Listing" ADD CONSTRAINT "Listing_damageDeposit_nonneg"\s+CHECK \("damageDeposit" IS NULL OR "damageDeposit" >= 0\);/)
    expect(sql).toMatch(/ALTER TABLE public\."Booking" ADD CONSTRAINT "Booking_damageDeposit_nonneg"\s+CHECK \("damageDeposit" >= 0\);/)
  })

  it('gives the public API roles nothing on the tables, now or for tables made later', () => {
    const sql = read('prisma/constraints.sql')
    expect(sql).toMatch(/^REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;/m)
    expect(sql).toMatch(/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL ON TABLES FROM anon, authenticated;/m)
    // And nothing in the app is built to use those roles: one Supabase client, made with the service key
    const client = read('src/lib/supabase.ts')
    expect(client).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(client).not.toMatch(/ANON|PUBLISHABLE/i)
  })

  it('has the suspension columns on the user', () => {
    for (const column of ['suspendedAt     DateTime?', 'suspendedById   String?', 'suspendedReason String?']) expect(model('User')).toContain(column)
  })

  it('has row-level security switched on for every table in the schema', () => {
    const models = [...read('prisma/schema.prisma').matchAll(/^model (\w+) \{/gm)].map((m) => m[1]).sort()
    const secured = [...read('prisma/enable_rls.sql').matchAll(/^ALTER TABLE public\."(\w+)"\s+ENABLE ROW LEVEL SECURITY;/gm)].map((m) => m[1]).sort()
    expect(models.length).toBeGreaterThanOrEqual(24)
    // A new model must be added to enable_rls.sql (and run) before it ships
    expect(secured).toEqual(models)
  })
})

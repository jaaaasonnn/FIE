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

  it('has row-level security switched on for every table in the schema', () => {
    const models = [...read('prisma/schema.prisma').matchAll(/^model (\w+) \{/gm)].map((m) => m[1]).sort()
    const secured = [...read('prisma/enable_rls.sql').matchAll(/^ALTER TABLE public\."(\w+)"\s+ENABLE ROW LEVEL SECURITY;/gm)].map((m) => m[1]).sort()
    expect(models.length).toBeGreaterThanOrEqual(24)
    // A new model must be added to enable_rls.sql (and run) before it ships
    expect(secured).toEqual(models)
  })
})

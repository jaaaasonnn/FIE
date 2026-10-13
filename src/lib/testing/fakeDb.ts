// An in-memory stand-in for the Prisma client, for route tests. It covers the
// query shapes the routes use (where with the common operators, select and
// include of related rows, counts) and nothing more. No test that uses it can
// reach a real database.
//
//   const state = vi.hoisted(() => ({ tables: {} as Tables }))
//   vi.mock('@/lib/db', async () => ({ db: (await import('@/lib/testing/fakeDb')).fakeDb(state.tables) }))

import { Prisma } from '@prisma/client'

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

type Relation = { model: string; local?: string; foreign?: string; many?: boolean }

/** How rows point at each other: `local` is a key on this row, `foreign` a key on the other. */
const RELATIONS: Record<string, Record<string, Relation>> = {
  user: {
    verification: { model: 'verification', foreign: 'userId' },
    listings: { model: 'listing', foreign: 'hostId', many: true },
    reviewsReceived: { model: 'review', foreign: 'revieweeId', many: true },
    sessions: { model: 'session', foreign: 'userId', many: true },
  },
  session: { user: { model: 'user', local: 'userId' } },
  listing: {
    host: { model: 'user', local: 'hostId' },
    reviews: { model: 'review', foreign: 'listingId', many: true },
    blockedDates: { model: 'blockedDate', foreign: 'listingId', many: true },
    checks: { model: 'listingCheck', foreign: 'listingId', many: true },
  },
  booking: {
    guest: { model: 'user', local: 'guestId' },
    host: { model: 'user', local: 'hostId' },
    listing: { model: 'listing', local: 'listingId' },
    payments: { model: 'payment', foreign: 'bookingId', many: true },
    disputes: { model: 'dispute', foreign: 'bookingId', many: true },
    instalments: { model: 'instalment', foreign: 'bookingId', many: true },
    payouts: { model: 'payout', foreign: 'bookingId', many: true },
    refund: { model: 'refund', foreign: 'bookingId' },
  },
  payment: {
    booking: { model: 'booking', local: 'bookingId' },
    instalment: { model: 'instalment', local: 'instalmentId' },
  },
  message: {
    sender: { model: 'user', local: 'senderId' },
    receiver: { model: 'user', local: 'receiverId' },
    booking: { model: 'booking', local: 'bookingId' },
    listing: { model: 'listing', local: 'listingId' },
  },
  review: {
    reviewer: { model: 'user', local: 'reviewerId' },
    reviewee: { model: 'user', local: 'revieweeId' },
  },
  dispute: {
    booking: { model: 'booking', local: 'bookingId' },
    evidence: { model: 'disputeEvidence', foreign: 'disputeId', many: true },
  },
}

/** Unique keys the real tables have, so a second insert fails as it would. */
const UNIQUE: Record<string, string[][]> = {
  user: [['email'], ['phone']],
  session: [['token']],
  review: [['bookingId', 'reviewerId', 'type']],
  wishlist: [['userId', 'listingId']],
}

const isObject = (v: unknown): v is Row => v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null))
const less = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() < b.getTime() : (a as number) < (b as number))

const aborts = { left: 0 }
/** Makes the next `count` transactions fail as Postgres fails one it has aborted (P2034). 0 puts things back. */
export function abortNextTransactions(count: number) { aborts.left = count }

export function fakeDb(tables: Tables) {
  const rows = (model: string) => (tables[model] ??= [])

  function related(model: string, row: Row, key: string): Row[] {
    const rel = RELATIONS[model]?.[key]
    if (!rel) return []
    return rel.local
      ? rows(rel.model).filter((r) => r.id === row[rel.local!])
      : rows(rel.model).filter((r) => r[rel.foreign!] === row.id)
  }

  function matches(model: string, row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, cond]) => {
      if (cond === undefined) return true
      if (key === 'OR') return (cond as Row[]).some((c) => matches(model, row, c))
      if (key === 'AND') return ([] as Row[]).concat(cond as Row[]).every((c) => matches(model, row, c))
      if (key === 'NOT') return !matches(model, row, cond as Row)
      const rel = RELATIONS[model]?.[key]
      if (rel && isObject(cond)) {
        const others = related(model, row, key)
        if ('some' in cond) return others.some((o) => matches(rel.model, o, cond.some as Row))
        if ('none' in cond) return !others.some((o) => matches(rel.model, o, cond.none as Row))
        if ('is' in cond) return cond.is === null ? others.length === 0 : others.some((o) => matches(rel.model, o, cond.is as Row))
        return others.some((o) => matches(rel.model, o, cond))
      }
      // A compound unique key: { userId_listingId: { userId, listingId } }
      if (isObject(cond) && key.includes('_') && !(key in row) && Object.keys(cond).every((k) => key.split('_').includes(k))) {
        return matches(model, row, cond)
      }
      const value = row[key]
      if (isObject(cond)) {
        const c = cond as { in?: unknown[]; notIn?: unknown[]; not?: unknown; lt?: unknown; lte?: unknown; gt?: unknown; gte?: unknown; contains?: string; startsWith?: string; equals?: unknown }
        if ('equals' in c && !same(value, c.equals)) return false
        if ('in' in c && !c.in!.some((v) => same(value, v))) return false
        if ('notIn' in c && c.notIn!.some((v) => same(value, v))) return false
        if ('not' in c && same(value, c.not)) return false
        if ('lt' in c && !(value != null && less(value, c.lt))) return false
        if ('lte' in c && !(value != null && (less(value, c.lte) || same(value, c.lte)))) return false
        if ('gt' in c && !(value != null && less(c.gt, value))) return false
        if ('gte' in c && !(value != null && (less(c.gte, value) || same(value, c.gte)))) return false
        if ('contains' in c && !String(value ?? '').includes(c.contains!)) return false
        if ('startsWith' in c && !String(value ?? '').startsWith(c.startsWith!)) return false
        return true
      }
      return same(value, cond)
    })
  }

  type Shape = { select?: Row; include?: Row; where?: Row; take?: number; orderBy?: unknown }

  /** A row as a query returns it: only what was selected, with the related rows that were asked for. */
  function shaped(model: string, row: Row, shape: Shape = {}): Row {
    const out: Row = shape.select ? {} : { ...row }
    const wanted = { ...(shape.select ?? {}), ...(shape.include ?? {}) }
    for (const [key, spec] of Object.entries(wanted)) {
      if (!spec) continue
      if (key === '_count') {
        const counts: Row = {}
        for (const k of Object.keys(((spec as Row).select as Row) ?? {})) counts[k] = related(model, row, k).length
        out._count = counts
        continue
      }
      const rel = RELATIONS[model]?.[key]
      if (!rel) { out[key] = row[key] ?? null; continue }
      const sub: Shape = isObject(spec) ? (spec as Shape) : {}
      let others = related(model, row, key).filter((o) => matches(rel.model, o, sub.where))
      if (typeof sub.take === 'number') others = others.slice(0, sub.take)
      const made = others.map((o) => shaped(rel.model, o, sub))
      out[key] = rel.many ? made : made[0] ?? null
    }
    return out
  }

  function apply(row: Row, data: Row) {
    for (const [key, v] of Object.entries(data)) {
      if (v === undefined) continue
      if (isObject(v) && 'increment' in v) row[key] = ((row[key] as number) ?? 0) + (v.increment as number)
      else if (isObject(v) && 'decrement' in v) row[key] = ((row[key] as number) ?? 0) - (v.decrement as number)
      else row[key] = v
    }
  }

  let made = 0
  function insert(model: string, data: Row): Row {
    for (const keys of UNIQUE[model] ?? []) {
      if (keys.every((k) => data[k] != null) && rows(model).some((r) => keys.every((k) => same(r[k], data[k])))) {
        // As Prisma reports it on Postgres: the fields of the index that refused
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: keys } })
      }
    }
    const row = { id: `${model}_${++made}`, createdAt: new Date(), updatedAt: new Date(), ...data }
    rows(model).push(row)
    return row
  }

  const model = (name: string) => ({
    findUnique: async ({ where, ...shape }: { where: Row } & Shape) => {
      const row = rows(name).find((r) => matches(name, r, where))
      return row ? shaped(name, row, shape) : null
    },
    findFirst: async ({ where, ...shape }: { where?: Row } & Shape = {}) => {
      const row = rows(name).find((r) => matches(name, r, where))
      return row ? shaped(name, row, shape) : null
    },
    findMany: async ({ where, take, skip, ...shape }: { where?: Row; take?: number; skip?: number } & Shape = {}) => {
      let found = rows(name).filter((r) => matches(name, r, where))
      if (typeof skip === 'number') found = found.slice(skip)
      if (typeof take === 'number') found = found.slice(0, take)
      return found.map((r) => shaped(name, r, shape))
    },
    count: async ({ where }: { where?: Row } = {}) => rows(name).filter((r) => matches(name, r, where)).length,
    create: async ({ data, ...shape }: { data: Row } & Shape) => shaped(name, insert(name, data), shape),
    createMany: async ({ data }: { data: Row[] }) => { data.forEach((d) => insert(name, d)); return { count: data.length } },
    update: async ({ where, data, ...shape }: { where: Row; data: Row } & Shape) => {
      const row = rows(name).find((r) => matches(name, r, where))
      if (!row) throw new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' })
      apply(row, data)
      return shaped(name, row, shape)
    },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
      const found = rows(name).filter((r) => matches(name, r, where))
      found.forEach((r) => apply(r, data))
      return { count: found.length }
    },
    delete: async ({ where }: { where: Row }) => {
      const i = rows(name).findIndex((r) => matches(name, r, where))
      if (i === -1) throw new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' })
      return rows(name).splice(i, 1)[0]
    },
    deleteMany: async ({ where }: { where?: Row } = {}) => {
      const keep = rows(name).filter((r) => !matches(name, r, where))
      const count = rows(name).length - keep.length
      tables[name] = keep
      return { count }
    },
  })

  const cache = new Map<string, ReturnType<typeof model>>()
  const db: Record<string, unknown> = new Proxy({}, {
    get(_target, prop: string) {
      if (prop === '$transaction') {
        return async (work: unknown) => {
          if (typeof work !== 'function') return Promise.all(work as Promise<unknown>[])
          // As Postgres does to a Serializable transaction it cannot prove safe
          if (aborts.left > 0) {
            aborts.left--
            throw new Prisma.PrismaClientKnownRequestError('could not serialize access due to read/write dependencies among transactions', { code: 'P2034', clientVersion: 'test' })
          }
          return (work as (tx: unknown) => unknown)(db)
        }
      }
      if (prop === 'then') return undefined
      if (!cache.has(prop)) cache.set(prop, model(prop))
      return cache.get(prop)
    },
  })
  return db
}

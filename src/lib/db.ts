import { PrismaClient } from '@prisma/client'

// One client, so one connection pool, per server process, in production too.
//
// The build has more than one copy of this file: Turbopack bundles it once for the API routes and once
// for the pages, because a server-first page (lib/serverRead.ts) imports its route's GET into the page's
// own bundle, which is a separate layer with its own module ids. Each copy runs its own top level, so
// without the shared slot on globalThis a process held two clients and two pools (twice the connections
// to Supabase's pooler that `connection_limit=1` allows). In development the slot also survives hot reloads.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db = globalForPrisma.prisma ?? (globalForPrisma.prisma = new PrismaClient())

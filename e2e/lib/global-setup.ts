import fs from 'fs'
import { assertTestDatabase, db } from './db'

/** Before anything runs: the stack is up, it is the throwaway database, and nothing has tried to leave this machine. */
export default async function globalSetup() {
  await assertTestDatabase()
  for (const url of ['http://localhost:3200/api/auth/session', 'http://localhost:3201/api/auth/session', 'http://127.0.0.1:4010/__control/health']) {
    const ok = await fetch(url).then((r) => r.status > 0, () => false)
    if (!ok) throw new Error(`${url} is not answering. Start the stack first: node e2e/run.mjs up`)
  }
  const log = process.env.E2E_EGRESS_LOG
  if (log && fs.existsSync(log)) fs.writeFileSync(log, '')
  await db.$disconnect()
}

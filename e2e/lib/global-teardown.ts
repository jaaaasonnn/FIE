import fs from 'fs'
import { db, purgeRunLeftovers } from './db'
import { fakes } from './fakes'
import { RUN_ID } from './runId'

/**
 * After everything: remove what this process left (the admins every test kept, people made through the sign-up
 * form) and any fake-service rule it added, and check the app's server never tried to reach anything but this
 * machine. SU10: only this process's own (lib/runId.ts); another process's people and rules are never touched.
 */
export default async function globalTeardown() {
  await purgeRunLeftovers(RUN_ID)
  await fakes.removeRunRules()
  await db.$disconnect()
  const log = process.env.E2E_EGRESS_LOG
  const blocked = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : ''
  if (blocked) throw new Error(`The app tried to reach outside this machine during the run (refused by the guard):\n${blocked}`)
}

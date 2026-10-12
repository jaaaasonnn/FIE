import fs from 'fs'
import { db, purge } from './db'

/** After everything: remove what is left (the admins every test kept), and check the app's server never tried to reach anything but this machine. */
export default async function globalTeardown() {
  const left = await db.user.findMany({ where: { email: { startsWith: 'e2e-', endsWith: '@fiegh.test' }, NOT: { email: { startsWith: 'e2e-explore-' } } }, select: { id: true } })
  await purge(left.map((u) => u.id))
  await db.$disconnect()
  const log = process.env.E2E_EGRESS_LOG
  const blocked = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : ''
  if (blocked) throw new Error(`The app tried to reach outside this machine during the run (refused by the guard):\n${blocked}`)
}

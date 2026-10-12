import fs from 'fs'

/** After everything: the app's server must not have tried to reach anything but this machine. */
export default async function globalTeardown() {
  const log = process.env.E2E_EGRESS_LOG
  const blocked = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : ''
  if (blocked) throw new Error(`The app tried to reach outside this machine during the run (refused by the guard):\n${blocked}`)
}

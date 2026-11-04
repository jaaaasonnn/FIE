// The contention lane (AS3, run.mjs): an app server whose database is as far away as the test says.

/** PORTS.laneControl in lib/env.mjs */
const CONTROL = 'http://127.0.0.1:54334'

/** Real: Vercel in Dublin and Supabase in eu-west-1 (vercel.json, CLAUDE.md), a few ms apart, with room to spare. */
export const REALISTIC = '5-15'
/** Stress: as if the two were in different regions. */
export const STRESS = '30-80'

/** Sets the lane's round trip to the database, from the next byte on. */
export async function setLaneLatency(ms: typeof REALISTIC | typeof STRESS): Promise<void> {
  const res = await fetch(`${CONTROL}/latency?ms=${ms}`, { method: 'POST' })
  if (!res.ok) throw new Error(`the contention lane's proxy refused ${ms}: ${res.status} ${await res.text()}`)
}

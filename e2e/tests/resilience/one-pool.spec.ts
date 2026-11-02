import { spawnSync } from 'child_process'
import path from 'path'
import { test, expect } from '../../lib/test'

// SU2: one Prisma connection pool per server process, on the real production build.
//
// The build has two copies of src/lib/db.ts, one for the API routes and one for the server-first pages
// (a page imports its route's GET into its own layer). Before the fix each copy made its own client in
// production, so a server held two pools. Here a fresh app server is started with a pool of one
// connection, as on Vercel (`connection_limit=1`), and asked for an API route and then for pages that come
// with their data, one after another: one pool is one connection to Postgres; two pools are two.

const RUN = path.resolve(__dirname, '../../run.mjs')
const PORT = '3203'
const APP = `http://localhost:${PORT}`
const launcher = (env: Record<string, string>, ...args: string[]) => {
  const r = spawnSync('node', [RUN, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } as unknown as NodeJS.ProcessEnv })
  if (r.status !== 0) throw new Error(`launcher ${args.join(' ')} failed: ${r.stdout}${r.stderr}`)
}
const lsof = (...args: string[]) => spawnSync('lsof', args, { encoding: 'utf8' }).stdout
/** The process answering on the port, and its connections to the test Postgres */
function connections() {
  const pid = lsof('-ti', `tcp:${PORT}`, '-sTCP:LISTEN').split('\n').filter(Boolean)[0]
  expect(pid, `a server listening on ${PORT}`).toBeTruthy()
  return lsof('-nP', '-a', '-p', pid, '-iTCP:54329', '-sTCP:ESTABLISHED').split('\n').filter((l) => /->127\.0\.0\.1:54329/.test(l)).length
}

test.describe('the database pool', () => {
  test('a server process holds one pool: its API routes and its server-first pages share one connection', async ({ world }) => {
    test.skip(test.info().project.name !== 'chromium', 'starts its own app server on one port: once is enough')
    test.setTimeout(120_000)
    expect(lsof('-ti', `tcp:${PORT}`, '-sTCP:LISTEN').trim(), `port ${PORT} is free`).toBe('')
    const host = await world.host()
    const home = await world.listing(host)
    launcher({ E2E_APP_POOL: '1' }, 'app:start', PORT)
    try {
      // One after another, so a single pool never needs a second connection
      for (const url of ['/api/listings', `/api/listings/${home.id}`, '/search', `/listings/${home.id}`, '/api/listings', '/search']) {
        const res = await fetch(`${APP}${url}`)
        expect(res.status, url).toBe(200)
        await res.arrayBuffer()
      }
      expect(connections(), 'connections from the server to Postgres').toBe(1)
    } finally {
      launcher({}, 'app:kill', PORT)
    }
  })
})

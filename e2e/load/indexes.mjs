// Applies or removes the proposed indexes (proposed-indexes.sql) on the LOCAL test database only, to measure
// what they change.  node e2e/run.mjs exec node e2e/load/indexes.mjs apply|drop
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const url = process.env.DIRECT_URL ?? ''
if (!/127\.0\.0\.1:54329\/fiegh_e2e/.test(url)) throw new Error('not the local test database: refusing')
const db = new pg.Client({ connectionString: url })
await db.connect()
if ((await db.query(`select to_regclass('public.e2e_marker') t`)).rows[0].t === null) throw new Error('no e2e_marker: refusing')
const statements = fs.readFileSync(path.join(here, 'proposed-indexes.sql'), 'utf8').split('\n').filter((l) => l.startsWith('CREATE INDEX'))
const action = process.argv[2]
for (const sql of statements) {
  const name = /"(\w+_idx)"/.exec(sql)[1]
  const t = Date.now()
  if (action === 'apply') await db.query(sql)
  else if (action === 'drop') await db.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`)
  else throw new Error('apply or drop')
  console.log(`${action} ${name}: ${Date.now() - t} ms`)
}
if (action === 'apply') await db.query('ANALYZE')
await db.end()

import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import { checkInvariants } from '../lib/invariants'

// The money and date rules (lib/invariants.ts) over the whole test database, seeded load set included.
// Run before and after every load scenario: node e2e/run.mjs test --project=perf load/invariants.spec.ts
// (E2E_PERF=1). Any rule broken is a Critical finding. E2E_INVARIANTS_LABEL names the result file.
test('the money and date rules hold over the whole database', async () => {
  test.setTimeout(300_000)
  const started = Date.now()
  const broken = await checkInvariants()
  const label = process.env.E2E_INVARIANTS_LABEL ?? 'adhoc'
  const dir = path.join(__dirname, '..', '.reports', 'invariants')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify({ label, at: new Date().toISOString(), seconds: (Date.now() - started) / 1000, broken }, null, 1))
  expect(broken, broken.map((b) => `${b.rule}: ${b.detail}`).join('\n')).toEqual([])
})

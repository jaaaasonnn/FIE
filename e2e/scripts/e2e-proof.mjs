// For removal-proofs.mjs: a proof whose test is end-to-end. The fix has already been taken out of the
// source; this rebuilds the app from the source as it now is, restarts the two app servers on that build,
// and runs the one test in Chromium.
//
//   PROOF_TEST_FILE=e2e/tests/... PROOF_TEST="title" node e2e/scripts/e2e-proof.mjs
//     exit 1: the test ran and failed (the proof holds); 0: it ran and passed; 2: it did not run
//   node e2e/scripts/e2e-proof.mjs --restore
//     rebuilds from the source as committed and restarts the apps (the runner calls it at the end)
//
// Needs the test stack up (`node e2e/run.mjs up`). A build made from changed source has its E2E_BUILD
// mark removed, so a later `up` without --build rebuilds rather than serve it.
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const run = (...args) => spawnSync('node', [path.join(ROOT, 'e2e/run.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const APPS = ['3200', '3201']

if (!fs.existsSync(path.join(ROOT, 'e2e/.state/pids.json'))) {
  console.error('the test stack is not up: start it with `node e2e/run.mjs up`')
  process.exit(2)
}

function rebuild() {
  const b = run('build')
  if (b.status !== 0) { console.error(`build failed:\n${(b.stdout + b.stderr).slice(-2000)}`); return false }
  for (const port of APPS) run('app:kill', port)
  for (const port of APPS) {
    const s = run('app:start', port)
    if (s.status !== 0) { console.error(`the app on ${port} did not start:\n${s.stdout}${s.stderr}`); return false }
  }
  return true
}

if (process.argv.includes('--restore')) process.exit(rebuild() ? 0 : 2)

const file = process.env.PROOF_TEST_FILE
const title = process.env.PROOF_TEST
if (!file || !title) { console.error('PROOF_TEST_FILE and PROOF_TEST are needed'); process.exit(2) }

if (!rebuild()) process.exit(2)
fs.rmSync(path.join(ROOT, '.next', 'E2E_BUILD'), { force: true })

const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const t = run('test', '--project=chromium', file.replace(/^e2e\//, ''), '-g', escaped, '--retries=0', '--reporter=json')
let stats
try { stats = JSON.parse(t.stdout.slice(t.stdout.indexOf('{'))).stats } catch { console.error(`no report from the test run:\n${(t.stdout + t.stderr).slice(-2000)}`); process.exit(2) }
const ran = stats.expected + stats.unexpected + stats.flaky
console.log(JSON.stringify(stats))
process.exit(ran === 0 ? 2 : stats.unexpected > 0 ? 1 : 0)

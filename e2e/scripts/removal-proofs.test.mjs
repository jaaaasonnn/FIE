// node --test e2e/scripts/removal-proofs.test.mjs
// The removal-proof runner must always put the source back: after a normal run, when it is stopped
// by a signal mid-proof, and (from its journal) after being killed outright.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, spawnSync } from 'child_process'

const runner = path.resolve('e2e/scripts/removal-proofs.mjs')
const ORIGINAL = 'export const limit = (x) => {\n  if (x > 10) return "too big"\n  return null\n}\n'

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofs-test-'))
  const sh = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  fs.writeFileSync(path.join(dir, 'rule.js'), ORIGINAL)
  fs.writeFileSync(path.join(dir, '.gitignore'), 'out/\nproofs.json\n')
  fs.writeFileSync(path.join(dir, 'proofs.json'), JSON.stringify([
    { what: 'limit', edits: [{ file: 'rule.js', find: '  if (x > 10) return "too big"', replace: '  if (false) return "too big"' }], testFile: 'rule.test.js', test: 'limit' },
    { what: 'limit again', edits: [{ file: 'rule.js', find: '  return null', replace: '  return "x"' }], testFile: 'rule.test.js', test: 'limit again' },
  ]))
  sh('init', '-q'); sh('add', '.'); sh('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x')
  return dir
}
const env = (dir, cmd) => ({ ...process.env, PROOFS_ROOT: dir, PROOFS_LIST: 'proofs.json', PROOFS_OUT: 'out', PROOFS_TEST_CMD: cmd })
const clean = (dir) => spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout.trim() === ''
const read = (dir) => fs.readFileSync(path.join(dir, 'rule.js'), 'utf8')

test('a normal run restores every file and records every proof', () => {
  const dir = repo()
  // The "test" fails while the mutation is in place, as a real test should
  const r = spawnSync('node', [runner], { env: env(dir, 'grep -q "if (false)\\|return \\"x\\"" rule.js && exit 1 || exit 0'), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /ALL 2 PROOFS HOLD/)
  assert.equal(read(dir), ORIGINAL)
  assert.ok(clean(dir))
  assert.equal(fs.readFileSync(path.join(dir, 'out/results.jsonl'), 'utf8').trim().split('\n').length, 2)
})

test('SIGTERM in the middle of a proof puts the file back', async () => {
  const dir = repo()
  const p = spawn('node', [runner], { env: env(dir, 'sleep 30') })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  // wait until the mutation is in place
  for (let i = 0; i < 100 && !read(dir).includes('if (false)'); i++) await new Promise((r) => setTimeout(r, 50))
  assert.ok(read(dir).includes('if (false)'), 'the mutation was applied')
  p.kill('SIGTERM')
  const code = await new Promise((r) => p.on('close', r))
  assert.equal(code, 143)
  assert.match(out, /git status clean after stopping/)
  assert.equal(read(dir), ORIGINAL)
  assert.ok(clean(dir))
})

test('after SIGKILL the next start reports the leftover, repairs it from the journal, and --resume carries on', async () => {
  const dir = repo()
  const failing = 'grep -q "if (false)\\|return \\"x\\"" rule.js && exit 1 || exit 0'
  // run proof 1 to the end, then kill during proof 2
  const p = spawn('node', [runner], { env: env(dir, `if grep -q 'return "x"' rule.js; then sleep 30; fi; ${failing}`) })
  for (let i = 0; i < 200 && !read(dir).includes('return "x"'); i++) await new Promise((r) => setTimeout(r, 50))
  p.kill('SIGKILL')
  await new Promise((r) => p.on('close', r))
  assert.ok(read(dir).includes('return "x"'), 'SIGKILL left the mutation')
  const r = spawnSync('node', [runner, '--resume'], { env: env(dir, failing), encoding: 'utf8' })
  assert.match(r.stdout, /LEFTOVER: an earlier run was cut off during proof 2/)
  assert.match(r.stdout, /Resuming: 1 proofs already recorded/)
  assert.match(r.stdout, /ALL 2 PROOFS HOLD/)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(read(dir), ORIGINAL)
  assert.ok(clean(dir))
})

test('refuses to start on a dirty tree, and names a mutation left with no journal', () => {
  const dir = repo()
  fs.writeFileSync(path.join(dir, 'rule.js'), ORIGINAL.replace('if (x > 10)', 'if (false)'))
  const r = spawnSync('node', [runner], { env: env(dir, 'exit 1'), encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stdout, /LEFTOVER mutation suspected: proof 1 in rule.js/)
  assert.match(r.stderr, /Refusing to start: the working tree is not clean/)
})

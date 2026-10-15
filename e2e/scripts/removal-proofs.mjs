// Removal proofs: take one fix out of the source, run the named test that should catch it, expect it
// to fail, and put the source back exactly as it was.
//
//   node e2e/scripts/removal-proofs.mjs              run every proof
//   node e2e/scripts/removal-proofs.mjs 3,7          run only these
//   node e2e/scripts/removal-proofs.mjs --resume     carry on after the last proof recorded
//
// Safe against being cut off:
// - it refuses to start unless `git status` is clean (the source must be exactly as committed);
// - before it edits a file it writes the file's original text to a journal on disk, so a run that is
//   killed outright (SIGKILL, power loss) is repaired from the journal on the next start;
// - originals are restored in `finally`, on exit, and on SIGINT, SIGTERM and SIGHUP;
// - it reports any leftover mutation it finds on start, and checks `git status` again at the end;
// - each result is appended to the results file as soon as it is known.
//
// Settings (environment, for the test of this script): PROOFS_ROOT (the repository, default the
// current directory), PROOFS_LIST (the proofs, default e2e/scripts/removal-proofs.json),
// PROOFS_OUT (results folder, default e2e/.reports/proofs), PROOFS_TEST_CMD (a command run in place
// of vitest; it gets the test file and name as $PROOF_TEST_FILE and $PROOF_TEST, and fails the proof
// by exiting non-zero).
import fs from 'fs'
import path from 'path'
import { spawn, spawnSync } from 'child_process'

const root = path.resolve(process.env.PROOFS_ROOT || '.')
const listFile = path.resolve(root, process.env.PROOFS_LIST || 'e2e/scripts/removal-proofs.json')
const outDir = path.resolve(root, process.env.PROOFS_OUT || 'e2e/.reports/proofs')
const journalFile = path.join(outDir, 'journal.json')
const resultsFile = path.join(outDir, 'results.jsonl')
const testCmd = process.env.PROOFS_TEST_CMD || ''

const args = process.argv.slice(2)
const resume = args.includes('--resume')
const onlyArg = args.find((a) => /^\d+(,\d+)*$/.test(a))
const only = onlyArg ? onlyArg.split(',').map(Number) : null

const log = (line) => console.log(line)
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' })
const dirty = () => {
  const r = git('status', '--porcelain=v1')
  if (r.status !== 0) throw new Error(`git status failed: ${r.stderr}`)
  return r.stdout.trim()
}

// --- the journal: originals of the files being edited right now --------------------------------
let current = null // { n, files: { relPath: originalText } }

function writeJournal() {
  const tmp = journalFile + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(current))
  fs.renameSync(tmp, journalFile)
}

function restore() {
  if (!current) return
  for (const [rel, text] of Object.entries(current.files)) fs.writeFileSync(path.join(root, rel), text)
  current = null
  fs.rmSync(journalFile, { force: true })
}

let child = null
let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  log(`\n${signal}: stopping, putting the source back`)
  try { child?.kill('SIGTERM') } catch {}
  try { restore() } catch (e) { console.error('RESTORE FAILED', e) }
  const left = dirty()
  log(left ? `git status is NOT clean after stopping:\n${left}` : 'git status clean after stopping')
  process.exit(signal === 'SIGINT' ? 130 : 143)
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => stop(s))
process.on('exit', () => { try { restore() } catch {} })

// --- start-up checks ----------------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true })
const P = JSON.parse(fs.readFileSync(listFile, 'utf8'))

if (fs.existsSync(journalFile)) {
  const j = JSON.parse(fs.readFileSync(journalFile, 'utf8'))
  log(`LEFTOVER: an earlier run was cut off during proof ${j.n} and left ${Object.keys(j.files).join(', ')} edited; restoring from the journal`)
  current = j
  restore()
}

// A mutation left by a run that kept no journal: the proof's replacement is there and its original is not
const leftovers = []
for (const [i, { edits }] of P.entries()) {
  for (const { file, find, replace } of edits) {
    const f = path.join(root, file)
    if (!fs.existsSync(f)) continue
    const text = fs.readFileSync(f, 'utf8')
    if (!text.includes(find) && replace && text.includes(replace)) leftovers.push(`proof ${i + 1} in ${file}`)
  }
}
if (leftovers.length) log(`LEFTOVER mutation suspected: ${leftovers.join('; ')}`)

const before = dirty()
if (before) {
  console.error(`Refusing to start: the working tree is not clean.\n${before}`)
  process.exit(2)
}

const head = git('rev-parse', 'HEAD').stdout.trim()
const done = new Set()
if (resume && fs.existsSync(resultsFile)) {
  for (const line of fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line)
    if (r.head && r.head !== head) {
      console.error(`Refusing to resume: results were made on ${r.head}, this is ${head}. Run without --resume.`)
      process.exit(2)
    }
    if (r.n) done.add(r.n)
  }
  log(`Resuming: ${done.size} proofs already recorded on ${head.slice(0, 7)}`)
} else if (!only) {
  fs.writeFileSync(resultsFile, '')
}

// --- one proof ----------------------------------------------------------------------------------
function runTest(testFile, test) {
  return new Promise((resolve) => {
    const env = { ...process.env, PROOF_TEST_FILE: testFile, PROOF_TEST: test }
    const escaped = test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    child = testCmd
      ? spawn('sh', ['-c', testCmd], { cwd: root, env })
      : spawn('npx', ['vitest', 'run', testFile, '-t', escaped, '--reporter=json'], { cwd: root, env })
    let stdout = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', () => {})
    child.on('close', (code) => { child = null; resolve({ code, stdout }) })
  })
}

async function proof(i, { what, edits, testFile, test }) {
  let problem = ''
  let failed = false
  let ran = 0
  current = { n: i + 1, files: {} }
  try {
    for (const { file } of edits) {
      if (!(file in current.files)) current.files[file] = fs.readFileSync(path.join(root, file), 'utf8')
    }
    writeJournal() // on disk before the first edit
    for (const { file, find, replace } of edits) {
      const f = path.join(root, file)
      const now = fs.readFileSync(f, 'utf8')
      if (now.split(find).length !== 2) { problem = `text not found exactly once in ${file}`; break }
      fs.writeFileSync(f, now.replace(find, () => replace))
    }
    if (!problem) {
      const r = await runTest(testFile, test)
      if (testCmd) {
        ran = 1
        failed = r.code !== 0
      } else {
        const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
        const tests = json.testResults.flatMap((f) => f.assertionResults).filter((t) => t.title === test)
        ran = tests.length
        // A source change that stops the test file loading at all also counts: the suite cannot pass
        failed = (ran > 0 && tests.every((t) => t.status === 'failed')) || (ran === 0 && json.testResults.some((f) => f.status === 'failed'))
      }
    }
  } catch (error) {
    problem = String(error).slice(0, 200)
  } finally {
    restore()
  }
  return problem ? `PROBLEM: ${problem}` : failed ? 'test FAILED as it should' : ran === 0 ? 'PROBLEM: test not found' : 'PROBLEM: test still passed'
}

// --- the run ------------------------------------------------------------------------------------
let held = 0
let notHeld = 0
for (const [i, p] of P.entries()) {
  const n = i + 1
  if (only && !only.includes(n)) continue
  if (done.has(n)) continue
  const result = await proof(i, p)
  const ok = result.startsWith('test FAILED')
  ok ? held++ : notHeld++
  fs.appendFileSync(resultsFile, JSON.stringify({ n, head, what: p.what, test: p.test, result, at: new Date().toISOString() }) + '\n')
  log(`${String(n).padStart(3)}. ${result.padEnd(26)} | ${p.what} | ${p.test}`)
  const after = dirty()
  if (after) {
    console.error(`STOPPING: git status is not clean after proof ${n}:\n${after}`)
    process.exit(3)
  }
}

const all = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const recorded = new Set(all.map((r) => r.n))
const bad = all.filter((r) => !r.result.startsWith('test FAILED'))
const after = dirty()
log(`this run: ${held} held, ${notHeld} did not`)
if (!only) log(`recorded: ${recorded.size} of ${P.length}; ${bad.length} do not hold${bad.length ? ': ' + bad.map((r) => r.n).join(', ') : ''}`)
log(after ? `git status NOT clean at the end:\n${after}` : 'git status clean at the end')
const complete = only ? notHeld === 0 : recorded.size === P.length && bad.length === 0
log(complete ? (only ? 'ALL SELECTED PROOFS HOLD' : `ALL ${P.length} PROOFS HOLD`) : 'SOME PROOFS DO NOT HOLD OR ARE NOT YET RUN')
process.exit(complete && !after ? 0 : 1)

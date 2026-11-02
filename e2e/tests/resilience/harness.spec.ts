import crypto from 'crypto'
import { test, expect } from '../../lib/test'
import { db, purgeRunLeftovers } from '../../lib/db'
import { fakes } from '../../lib/fakes'
import { RUN_ID } from '../../lib/runId'
import { call, freshIp } from '../../lib/world'

// SU10: the harness keeps one test, or one test process, from breaking another.
//  - The fake refuses a failure rule with no match: it would break every request on the stack.
//  - A rule a test adds is removed when the test ends, even when it fails or runs out of time.
//  - The end-of-run clean-up removes only the people its own process made (lib/runId.ts).

const CONTROL = 'http://127.0.0.1:4010/__control'
const rulesMatching = async (match: string) => (await fakes.rules() as { id: string; match?: string }[]).filter((r) => r.match === match)

test.describe('the fake services harness (SU10)', () => {
  test('a failure rule with no match is refused, with a reason, and nothing is added', async () => {
    for (const body of [{ endpoint: 'verify', behaviour: 'reset' }, { endpoint: 'verify', behaviour: 'reset', match: '' }, { endpoint: 'verify', behaviour: 'reset', match: '   ' }]) {
      const res = await fetch(`${CONTROL}/rule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await res.json()).error).toContain('A failure rule needs a match')
    }
    // Through the helper too: a missing reference (the SU10 accident) is an error in the test, not a global rule
    await expect(fakes.rule('verify', 'reset', { match: undefined as unknown as string })).rejects.toThrow(/refused the rule/)
    // (other tests run beside this one, so their scoped rules may come and go: none may lack a match)
    expect((await fakes.rules() as { match?: string }[]).filter((r) => !r.match?.trim())).toEqual([])
  })

  test.describe('a rule left by a test that does not finish', () => {
    test.describe.configure({ mode: 'serial' })
    const failed = `su10-failed-${crypto.randomBytes(5).toString('hex')}`
    const timedOut = `su10-timeout-${crypto.randomBytes(5).toString('hex')}`

    test('a test that adds a rule and then fails (expected to fail)', async () => {
      test.fail(true, 'it fails on purpose, after adding a rule it never removes')
      await fakes.rule('verify', 'reset', { match: failed })
      expect(await rulesMatching(failed)).toHaveLength(1)
      expect('the test fails here').toBe('with its rule still in place')
    })

    test('a test that adds a rule and then runs out of time (expected to fail)', async () => {
      // A timeout is its own status, not a failure: this test expects exactly that
      test.info().expectedStatus = 'timedOut'
      test.info().annotations.push({ type: 'fail', description: 'it times out on purpose, after adding a rule it never removes' })
      test.setTimeout(3_000)
      await fakes.rule('verify', 'reset', { match: timedOut })
      expect(await rulesMatching(timedOut)).toHaveLength(1)
      await new Promise(() => {})
    })

    test('leaves no rule behind: both were removed when their tests ended', async () => {
      expect(await rulesMatching(failed)).toEqual([])
      expect(await rulesMatching(timedOut)).toEqual([])
    })
  })

  test('the end-of-run clean-up of one process never removes another process\'s people', async () => {
    // Two other processes' ids, so this run's own people are not touched by the check
    const [mine, theirs] = [`t${crypto.randomBytes(4).toString('hex')}`, `t${crypto.randomBytes(4).toString('hex')}`]
    const join = async (run: string) => {
      const email = `e2e-${run}-guest-${crypto.randomBytes(4).toString('hex')}@fiegh.test`
      const r = await call('POST', '/api/auth/signup', { name: 'E2E Run Check', email, password: 'Run-pass-12345', role: 'GUEST' }, { ip: freshIp() })
      expect(r.status, r.text).toBe(201)
      return email
    }
    const [mineEmail, theirEmail] = [await join(mine), await join(theirs)]
    try {
      expect(await purgeRunLeftovers(mine)).toBe(1)
      expect(await db.user.count({ where: { email: mineEmail } })).toBe(0)
      expect(await db.user.count({ where: { email: theirEmail } })).toBe(1)
      // And this process's id is its own: the check above never matched this run's people
      expect(RUN_ID).not.toBe(mine)
    } finally {
      await purgeRunLeftovers(theirs)
    }
    expect(await db.user.count({ where: { email: theirEmail } })).toBe(0)
  })
})

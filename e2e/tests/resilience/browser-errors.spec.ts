import crypto from 'crypto'
import { test, expect } from '../../lib/test'
import { fakes } from '../../lib/fakes'

// G5 (mobile speed) trimmed the browser's Sentry set-up (src/instrumentation-client.ts) to error reporting
// only. This proves what must stay true: an error thrown in a page and a promise rejection nobody handles
// both reach Sentry (the local fake), and both arrive scrubbed of the email address and phone number they
// carried (src/lib/sentryScrub.ts).

const EMAIL = 'kofi.mensah@example.com'
const PHONE = '0241234567'

async function reported(tag: string) {
  let found: string[] = []
  await expect.poll(async () => (found = await fakes.sentry(tag)).length, { timeout: 15_000, message: `a report carrying ${tag}` }).toBeGreaterThan(0)
  return found.join('\n')
}

for (const [kind, raise] of [
  ['an error thrown in the page', (msg: string) => { setTimeout(() => { throw new Error(msg) }, 0) }],
  ['a promise rejection nobody handles', (msg: string) => { void Promise.reject(new Error(msg)) }],
] as const) {
  test(`${kind} reaches Sentry, without the email address or phone number in it`, async ({ page }) => {
    const tag = `e2e-browser-${crypto.randomBytes(5).toString('hex')}`
    await page.goto('/terms')
    await page.waitForLoadState('networkidle')
    await page.evaluate(raise, `${tag} failed for ${EMAIL} on ${PHONE}`)
    const sent = await reported(tag)
    expect(sent).toContain('[email]')
    expect(sent).toContain('[phone]')
    expect(sent).not.toContain(EMAIL)
    expect(sent).not.toContain(PHONE)
  })
}

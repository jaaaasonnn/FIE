// SU10: every test process has an id of its own (set once in playwright.config.ts, inherited by its workers).
// The people a process makes carry it in their email address, and the fake-service rules it adds carry it as
// their owner, so the end-of-run clean-up removes only what its own process made: a second process running
// beside it, or one left over, is never touched.

export const RUN_ID = process.env.E2E_RUN_ID ?? 'solo'

/** "e2e-<run>-" : the start of every email address this process gives a test person */
export const RUN_EMAIL_PREFIX = `e2e-${RUN_ID}-`

/** A test person's email address, tagged with this process's id */
export const runEmail = (kind: string, tag: string) => `${RUN_EMAIL_PREFIX}${kind}-${tag}@fiegh.test`

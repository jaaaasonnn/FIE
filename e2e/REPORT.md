# End-to-end test report

## Second go, Stage A: the gaps from the first go (2026-10-15, branch `e2e-performance`)

Before starting, the post-merge run on `main` (`8e0bf14`) was repeated in full under `caffeinate`: build passed, smoke 7/7, all 220 removal proofs held in one pass (the tree clean after each), build passed, smoke 7/7, `git status` clean. The first attempt had stopped at proof 85 of 220 and left that proof's edit in `src/lib/exchangeRate.ts`; the runner is now `e2e/scripts/removal-proofs.mjs`, which journals originals to disk, restores on exit and on signals, repairs a killed run on the next start and resumes (`--resume`).

Machine: MacBook Air (Mac16,12), Apple M4, 10 cores, 16 GB, no fan; on mains power; 36 GB free.

| Run | Result |
|---|---|
| https front for WebKit | `https://localhost:3443`, throwaway certificate accepted only by the webkit, tablet and iphone projects |
| The 18 tests skipped in WebKit for the Secure cookie (6 in each of webkit, tablet, iphone) | all run, all pass. The suspended log-in test is now in the core set too (3 more) |
| New browser journeys (`tests/journeys/clicked.spec.ts`): listing in six steps with two photos, ID sent and an admin's Reject then Approve, the "address and photos checked" form, suspend and restore from the Users tab, the payout method form, the second month's rent paid from the booking page | 6 of 6 in Chromium, 30 of 30 repeated five times, and in all six browser set-ups |
| Everything in Chromium | 169 passed (4 skipped: the opt-in contrast measurement) |
| Crashes and the database, alone | 10 passed |
| Core set in Firefox, WebKit, tablet, iPhone and Android | 138 passed, 1 skipped (the map in Firefox), 1 flaky: "search by city" on the tablet (G3) |
| New findings | G1 (Medium), G2 (High), G3 (Low, not confirmed); see `FINDINGS.md` |

---

## After the fixes (2026-10-13, branch `e2e-fixes`)

Run against a production build of the branch, on this machine, with the local
test stack. All 17 findings of the first go are fixed except the text
contrast part of F12, which is a proposal (`CONTRAST-PROPOSAL.md`). No test is
marked as known-failing any more. `FINDINGS.md` has what was done for each.

| Run | Result |
|---|---|
| Everything in Chromium | 147 passed, none on a retry (4 skipped: the opt-in contrast measurement) |
| Crashes and the database, run alone | 10 passed |
| Every race at 50 rounds, first time | 30 passed |
| Every race at 50 rounds, second time | 30 passed |
| Core set in Firefox, WebKit, tablet, iPhone and Android sizes | 75 passed, 19 skipped as before, 1 failed (see below) |
| Fuzz: 1,360 hostile bodies to 34 routes, 240 hostile query strings | none answered wrongly, with nothing set aside |
| Accessibility scan | passes against a baseline with no unnamed button, field or select box |
| Unit tests in six time zones | 1,355 passed in each |
| Removal proofs | 185 of 185 hold |

The one failure in the other browsers was the test "signing out from the menu"
on the tablet set-up: the test asked for the dashboard while the app was still
doing its own redirect after signing out. The sign-out code is unchanged on
this branch. The test was corrected and then passed 36 times out of 36 across
the six browser set-ups. The whole other-browser run was not repeated after
that.

Two things went wrong during the work and were put right:

- The F14 commit wrote its new tests over an existing file of 15 tests
  (`src/lib/security/input.test.ts`). The removal proofs caught it. The file
  is restored exactly as it was and the new tests are in
  `unreadable.test.ts`. The six time-zone runs were repeated afterwards with
  all 1,355 tests.
- One slow unit test (23 real password checks, about 4.5 seconds against a
  5 second limit) failed twice in the time-zone runs and passed alone. It was
  already that slow before this branch. It now has a 20 second limit.

The first go's report follows as it was written.

---

# First go (stages 0 to 3)

Run on 2026-10-12 against a production build of `main` + Next 16.3.8, on this
machine, with the local test stack described in `README.md`. Nothing under
`src/` was changed. Performance, throttling, Lighthouse, load, stress and soak
work is the second go and has not been run.

## Results

| Area | Tests | Result |
|---|---|---|
| Harness and guards (smoke) | 5 | pass |
| Main journeys in the browser (smoke) | 2 | pass |
| Journeys: accounts, search, booking, paying | 17 | 16 pass, 1 known failing (F13) |
| Journeys: cancellation, payouts, disputes | 26 | pass |
| Journeys: host ID, listing checks, calendar, reviews, messages | 7 | pass |
| Journeys: rent by the month | 5 | pass |
| Site crawl, 36 pages as 4 kinds of visitor | 4 | pass: no broken link, console error or failed request |
| Navigation: deep links, back/forward, refresh, double clicks, two tabs, keyboard | 16 | 12 pass, 4 known failing (F1 ×3, F2) |
| Accessibility scan (axe) | 4 | pass against the baseline; the baseline itself is finding F12 |
| Races: dates, paying, jobs, admins, rent, accounts, limits | 30 | 23 pass, 7 known failing (F2, F3, F4, F6, F7, F8, F11) |
| Failures: Paystack, email, storage, exchange rate | 24 | 23 pass, 1 known failing (F9) |
| Fuzz: bodies, raw bodies, query strings, uploads | 7 | 3 pass, 4 known failing (F14 ×2, F15, F16) |
| Crashes and the database (run alone) | 8 | 7 pass, 1 known failing (F17) |
| Core set in Firefox, WebKit, tablet, iPhone, Android sizes | 95 | 76 pass, 19 skipped (see "Not tested") |

Chromium: 155 tests, of which 18 are known-failing tests for 14 of the 17
findings (the other three are measured or held by a baseline); the other 137
pass. Two full runs in a row were clean, with no test passing only
on a retry. Every race was also run 50 rounds. The money and date rules
(`lib/invariants.ts`) held after every test, and no rule was seen broken even
for a moment by a test running beside another.

Run time: smoke 5 s; everything in Chromium 4 min; the crash set 25 s; the
other browsers 2.6 min.

## What held

- No double charge counted as paid, no double payout, no double refund, no
  oversold dates, in any race or crash: two servers running the payout,
  refund, send and expiry jobs at once; the webhook 20 times before, during
  and after the browser's return; a forged webhook; the server killed before
  and after Paystack accepted a transfer; a retry meeting the normal run.
- A host is paid 90% of the rent, once, only after 48 hours, an approved ID,
  a payout method a day old, and not while suspended or disputed.
- Refunds match the policy table at every tier boundary, to the pesewa.
- With the database down the site answers plain errors, leaks nothing, makes
  no booking, and recovers by itself.
- Hostile uploads are all refused; nothing was stored outside its folder.
- Nothing tried to reach outside this machine, from the server or the browser.

## Findings

See `FINDINGS.md` for each one with how to reproduce it. In order:

- **Critical:** F11 (cancel at the moment of payment: paid, cancelled, no refund on record).
- **High:** F2 (Pay pressed twice charges twice), F4 (sign-in limit beaten by parallel guesses), F9 (no time limit on calls to Paystack), F17 (payout converted at the day's rate: decision needed).
- **Medium:** F1 (redirect after log-in lost), F3 (unrelated bookings abort each other), F7 (sign-up limit beaten by parallel requests), F12 (accessibility).
- **Low:** F5, F6, F8, F10, F13, F14, F15, F16.

## Not tested

- Everything in the second go: Lighthouse and Web Vitals, throttled networks, page-to-page timings, server timings on a large database, load, spike, stress, soak, capacity.
- Logging in through the form in WebKit (18 tests skipped in the WebKit, tablet and iPhone projects): WebKit drops the `Secure` session cookie on `http://localhost`. Those projects sign in by setting the cookie instead. Needs an https front on the test stack.
- The map in Firefox (1 test skipped): headless Firefox has no WebGL here.
- Real Paystack, Resend, Supabase Storage, MapTiler and Sentry. The fakes follow their documented behaviour as the app uses it; where the fake had to guess (a duplicate transfer reference is refused with HTTP 400) it follows the app's own comments.
- The Supavisor pooler, TLS to the database, Vercel's many instances and its limits. Two server processes stand in for instances.
- Creating a listing through the multi-step form, sending an ID through the upload page, and the admin tabs' buttons: these were done through the same API the pages call, not by clicking.
- SMS (no adapter exists), the 14-day stop of rent reminders, the deposit kept or returned in a host's dispute, the review auto-publish after 14 days.
- Clock edges (Ghana midnight, month ends, leap day) at the level of the running server. They are covered by the unit tests in six time zones; no new property tests were added.
- Screen readers. axe finds a part of what a person would.

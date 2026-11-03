# End-to-end test report

## AS2 resolved in the tests (2026-11-03, branch `payout-retry-claim`, test code only)

**Cause.** The payout job works on every payout in the database. In both full runs where AS2 showed, its
test overlapped "the payout job starts on two servers at the same moment" (four runs per round, in another
worker). That test's runs took AS2's retry: (b) they sent it and listed it in their own answer; (a) once,
one had claimed it and was still on its way to Paystack when AS2 read the payout. No app defect: payout
code, the cron route and every other app file are unchanged.

**Changes (`3e8810c`, test code only).** The AS2 test checks the payout once no run is working on it, still
requiring one payout row, PROCESSING, one retry and exactly one transfer, and records which run listed it.
`e2e/lib/payoutRetry.ts` holds the shared steps. `races/payout-retry.spec.ts` makes the reproduction permanent:
(b) another run takes the retry first; (a) the claiming run is held at Paystack; (a2) the claimer dies, nothing
happens until the 15-minute limit, then the next run asks Paystack (404) and sends once; (c) three runs at once,
the payout made long ago; (d) three runs find an abandoned claim. (c) and (d) run 20 rounds, or `E2E_ROUNDS`
if more. Each has its own host and checks only its own payouts, settled.

**Proof** (`e2e/.reports/as2c/full/`, each run in its own folder, clean rebuilds, `caffeinate -dims` on mains):

| Check | Result |
|---|---|
| Lint, type check | pass (39 warnings, none new) |
| New tests alone, 50 rounds | 5 passed |
| Money rules | clean before and after |
| Chromium suite at 50, run 1 (clean rebuild) | **241 passed, 13 skipped, 0 failed, 0 flaky** |
| Chromium suite at 50, run 2 (clean rebuild) | **241 passed, 13 skipped, 0 failed, 0 flaky** |
| Removal proofs 284-286 | all 3 hold (284: the wait removed, (a) fails; 285 and 286: the stale-claim pick-up removed, (a2) and (d) fail) |

AS3 did not show. In the two Chromium runs, AS2's payout was listed by one of the test's own runs every round
(17 and 17); in the 50-round run alone, (b) was taken by another test's run 7 times of 17, (a) 7 of 17, (a2) 1
of 17: the interference is common, and now harmless.

**AS6 (new, Low, open):** a run that loses the claim reports `paid` with the payout still PENDING although it
sent nothing; in (d) two or three runs said "paid" for one transfer in 43 rounds of 50. Fix before
`PAYOUTS_ENABLED` is switched on (option B, payout code: needs the go-ahead).

## app-shell, stage 1: the full set again (2026-11-03, `5de4ce8`, not merged)

Run once on `5de4ce8` (the AS5 keys `ffe265c` and the sign-out test fix in), after a clean rebuild (`down`, `.next`
removed, `up --build`, for AS4), under `caffeinate -dims` on mains power. Each suite in its own folder,
`e2e/.reports/polish2/full/`. Nothing was re-run.

| Check | Result |
|---|---|
| Lint, type check | pass (39 warnings, none new) |
| `npm run test:tz` | 1,675 passed in each of the six zones |
| Money rules | clean before and after |
| Chromium suite, races at 50 | **236 passed, 13 skipped, 0 failed, 0 flaky** |
| Chaos | **17 passed** |
| Other five set-ups | **274 passed, 36 skipped, 0 failed, 0 flaky** |
| Removal proofs | **all 283 hold** |
| Bundle guard | desktop search **648 KB** (limit 648); phone pages 202-244 KB (limit 350) |
| Layout shift at phone width | 0.0000 on every page, signed out, signed in, and with every answer 1.5 s late (seven pages) |
| Accessibility at phone width | 0 problems, signed out, guest with an unread message, host |

**Clean: no test failed, none was retried, none flaky, none "did not run".** Every skip is a planned one:
pictures only when asked for (11), the bar is for phones (12), phones only (16), widths set by the fit test in
three set-ups only (6), the map in headless Firefox (4).

- **AS2** passed all 17 rounds. One round (11) is worth recording: the retry was sent (lookup 404, then the
  transfer, 200) and the payout ended `PROCESSING` with one retry, as it should, but **none of the three runs
  listed it** in its answer. In the other 16 rounds exactly one run said "retry sent". So a run can act on the
  retry without reporting it; in the failing round (polish run) a run claimed it and neither sent nor reported.
  Both point at the same place in the retry path. Payout code not touched.
- **AS3** did not show.
- **AS4** did not show: the clean rebuild came first, and `.next/BUILD_ID` was present after the proofs.

## app-shell, stage 1 polish (2026-11-03, branch `app-shell`, not merged)

Phones only; desktop unchanged (desktop search **648 KB**, no desktop page downloads the bar's script). Money,
sign-in, messaging and payout code untouched; no schema or live-database change.

1. **Logo:** Trips' icon is the header logo's own asset and mask (`public/logo-mark.png`), gold on Trips like the
   header, the muted grey elsewhere; `e2e/.reports/app-shell/logo-compare.png` shows them side by side at 24, 28
   and 48 px.
2. **Type scale** (rem): body 15 px, small text 13 px, page titles 24 px, section titles 19 px, card titles 16 px,
   titles at 600, tighter lines; nothing under 12 px but the tab labels (11 px); 44 px targets everywhere.
3. **Nothing outside its box:** a new audit (`tests/layout/phone-fit.spec.ts`) at 320, 360, 390 and 430 px on
   home, search, a listing, how it works, and signed in Trips, wishlist, messages and account. It found 355
   problems at first, none now: the Explore rental types (now sized to their words, scrolling if they must,
   icons hidden below 375 px), Trips' chip and stat cards, the search field ("Accra"), the search dates, the host
   row and title row on a listing (its buttons on their own row on a small phone), a booking's title and status
   pill, the stat card label, and the guest's page-tab row (desktop only now: the bar does that on a phone).
4. **Search dates:** side by side, 44 px, our font and corners, "Add date" or "Wed, 10 Mar", over the browser's
   own date input (its calendar on a tap); no picker code, so the bundle is unchanged.
5. **Header and bar:** header 56 px with the logo at its size; tab labels 11 px, the active one semi-bold in
   `--color-accent-deep` under the gold marker, a slight press, no tap flash, thin top border, lightly blurred.
6. **Trips on a phone:** a compact header ("Hi, <name>", one verification chip), one row of four figures, then
   the bookings; notices after them. Layout only.

Removal proofs 276-283 (the logo mask, the 56 px header, the date face, Trips' order, the 44 px minimum, the
listing title's width, the search field's box, and drawing late answers fresh). Screenshots of the main pages at
360 and 390 px on iPhone and Android: `e2e/.reports/app-shell/pages/`.

**The full set, once (`ce349ba`, each suite in its own folder, `e2e/.reports/polish/full/`):**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each zone |
| Money rules | clean before and after |
| Chromium suite, races at 50 | **233 passed, 13 skipped, 1 failed, 1 flaky** |
| Chaos | 17 passed |
| Other five set-ups | **272 passed, 36 skipped, 2 failed** |
| Removal proofs | all 282 hold (281 re-pointed first, see below) |
| Bundle guard | desktop search 648 KB; phone pages 202-244 KB |

**Not clean. What failed and why** (none re-run to pass):
- *Layout shift at phone width* (failed twice): the booking page 0.135, Wishlists 0.008, when their answers came
  late under load: React moved the loading screen's pieces into place. Older than the polish; reproduced with
  every answer 1.5 s late; fixed by keying each state (AS5, `ffe265c`), and the guard now covers late answers
  (0 on seven pages). Proof 283.
- *"Signing out from the menu"* on iPhone and Android (failed twice each): the test expected Trips' heading
  "Welcome back"; on a phone it is now "Hi, <name>", as asked. The sign-out worked; the test now accepts both.
- *The payout-retry race (AS2)*, flaky: caught with its timings. The fake was never asked anything during the
  retry, yet the payout ended PENDING with its retry counted: the cause is in the app's retry path, which was not
  touched (FINDINGS AS2).
- Proof 281 first did not hold (the fit audit cannot see the listing title's row reliably); it now names a direct
  test of that layout, and holds.
- After the run the stack served a home page linking a stylesheet from an earlier build (AS4, harness); a clean
  rebuild put it right.

The fixes were checked on their own (layout shift 0 with late answers; sign-out passing in all six set-ups;
proof 283 holds); the full set has not been run again.

**Proposals for stage 2** (not built):
- A compact search summary pill at the top of Explore and search ("Accra · 10-12 Mar · 2 guests") that opens a
  full-screen sheet: where, dates (the date picker on demand), who, rental type; Search at the bottom of the sheet.
- Vertical, full-width result cards on a phone: a big photo (swipeable, dots), the heart on the photo, title,
  area, rating, our badge, price per night or month (and the total once dates are chosen), all fixed heights.
- Explore without the top header on a phone: the search pill is the top of the page; the logo in the pill or not
  at all (the bar is the navigation).
- Sticky filter chips under the search pill (rental type, price, bedrooms, checked homes) that stay while the list
  scrolls; the map as a floating button above the bar.
- Loading: skeletons the exact size of the cards, never a centred spinner; pull to refresh on Trips and Messages.
- Transitions: the listing photo growing from the card into the listing page; sheets sliding up; `prefers-reduced-
  motion` respected.
- Empty states with a picture and one action (no trips yet, nothing saved, no messages), in FieGH's voice.
- Scroll: the header hiding on scroll down and coming back on scroll up; scroll position kept on Back.
- The dark bands at the top of Messages, Wishlists and Payments replaced by plain titles on a phone, as on Trips.

## app-shell: AS1 fixed, AS2 investigated (2026-11-02, test code only, not merged)

**AS1** (`6b0a20c`, `c2f64af`): the send-job test had two timing causes, both in the test. It started its runs
before the sign-up emails were in the log (it now waits for all eight); and the job sends the 50 oldest messages due,
so when the races had queued more than that, one round of four runs never reached the test's emails (it now repeats
the same four runs at once until all eight have gone, at most 20 rounds, still requiring each exactly once).
Reproduced the second cause on purpose with 120 older queued messages: the old test fails, the new one passes in 3
rounds. 50 of 50 four at a time; the whole resilience set with 50 copies in one process, 107 of 107. `deliver.ts`
unchanged.

**AS2** (`3553632`): the fake Paystack now times every request, and the payout-retry race prints each round's run
times, what each run said about the payout, and every Paystack request with its timing (also in its failure
message); the assertion is unchanged.

| Run (own results folder, `e2e/.reports/as/`) | Rounds | Result | Fake Paystack answer | Payout runs |
|---|---|---|---|---|
| On its own, nothing else running (`E2E_ROUNDS=600`: this test runs a third) | 200 | 200 passed | within 1 ms, none given up on | 9 ms median, 138 ms at most |
| Inside the full Chromium set, `E2E_ROUNDS=50` | 17 | 17 passed | within 1 ms, none given up on | 18 ms median, 1,050 ms at most |

**So AS2 did not fail again**, in 217 rounds, and the fake was never slow; whether the one failure was a slow fake or
something in the app is still not proved. Nothing was changed in the fake or the waiting, because nothing slow was
found to make robust; the timings are now in place, so if it comes back its message will say which. Payout code was
not touched.

**That Chromium run was not clean** (231 passed, 2 flaky): the send-job test (AS1's second cause, found here and
fixed above) and a new one, **AS3**: in "ten guests book ten different homes at the same instant" one booking got the
app's designed `503 "We are busy right now"` (its serializable transaction aborted eight times under the races'
load). App behaviour, not touched; a decision for the owner (FINDINGS).

## app-shell, stage 1: the phone's bottom bar (2026-11-02, branch `app-shell`, not merged)

From `main` at `c294542`. Phone widths only; desktop untouched. Money, sign-in, messaging and payout code untouched;
no schema change; no live database, switch or environment variable touched. Commits: `048805c` (the shell),
`630d398` (its end-to-end tests and what they found), `3a6f3a8` (layout-shift guard, phone accessibility scan,
bundle guard, removal proofs 270-275).

**What it is.** A bottom bar on phones (Explore, Wishlists, Trips, Messages, Profile) drawn on the server with each
page's tab marked, so it adds no script; FieGH's mark as the Trips icon; the page keeps room for it from the first
paint, the browser never brings a control to rest under it (`scroll-padding-bottom`), the iPhone home-bar area is
respected (`viewport-fit=cover`), and it steps aside while a text field has focus. Signed out, the tabs lead to log
in and back. `/account` (Profile) and `/messages` (to the right inbox) are new. The unread badge is the only script:
`public/bar.js`, 1.2 KB, loaded at phone widths only, asking the new `GET /api/messages/unread`.

**Found by its own tests and fixed before the full run:** the bar's border made it 1 px taller than the room kept
for it; in WebKit the visible height can be shorter than the page's, so pages keep 16 px more; "Pay now" on a
booking could come to rest under the bar on an iPhone SE (fixed with scroll padding); the badge read before the
tab's name to a screen reader (moved after the label).

Pictures (`e2e/.reports/app-shell/`): the mark at 24, 48 and 192 px (`logo-mark.png`); on the iPhone and Android
set-ups, signed out (`*-signed-out.png`), signed in with an unread badge (`*-unread-badge.png`), Trips active
(`*-trips-active.png`), and with a field focused, the bar gone (`*-keyboard-open.png`; the emulators draw no
keyboard).

| Check (each suite in its own folder, `e2e/.reports/shell/full/`) | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each of the six zones |
| Money rules | clean before and after |
| Chromium suite, races at 50 rounds | **231 passed, 7 skipped, 2 flaky, 0 failed, 0 did not run** |
| Chaos | 17 passed |
| Other five set-ups (the bar's phone tests run in iPhone and Android) | 260 passed, 10 skipped, 0 flaky |
| Removal proofs | **all 275 hold** (270-275 new) |
| Bundle guard | desktop search **648 KB** (unchanged), no desktop page downloads the bar's script; phone pages 202-244 KB of 350 |
| Layout shift at phone width (new guard) | 0 on all 11 page loads |
| Accessibility at phone width (new, no baseline) | nothing found |

**Not clean: two flaky tests, not re-run, neither touched by stage 1** (FINDINGS AS1, AS2): the send-job test
started its runs before the sign-up emails were in the log; the payout-retry race ended one round with the payout
safely `PENDING` (most likely a slow answer from the fake Paystack under load; not proved). Nothing paid twice; the
money rules held.

## su10-harness: test processes and fake rules cannot break each other (2026-11-02, branch `su10-harness`)

From `main` at `e457dd1`; test harness only, no app code; no live database, switch or environment variable.

- **No rule without a match.** The fake's control refuses one (400: "A failure rule needs a match ... A rule with no
  match would break every request on the stack."); `fakes.rule` requires a `match` and throws if refused. The two
  tests that scoped a rule to a payment reference (`resilience/paystack.spec.ts`, `chaos/crash.spec.ts`) check the
  reference exists first: the type checker found them once `match` was required. The exchange-rate rule names its
  request (`pair/USD/GHS`).
- **Every rule removed when its test ends**, passed, failed or timed out: an automatic fixture (`fakeRules`,
  `e2e/lib/test.ts`); and at the end of the run, every rule the process added (rules carry the process's id).
- **Clean-up only of its own process.** Each process gets an id (`E2E_RUN_ID`, set in `playwright.config.ts`,
  inherited by its workers; `e2e/lib/runId.ts`); every test person's email carries it (`runEmail`, in all eight
  places a test makes one), and the end-of-run clean-up removes only `e2e-<its id>-…` people.

Tests, `tests/resilience/harness.spec.ts`: a rule with no match is refused, three ways, and none is added; a test
that adds a rule and fails, and one that adds a rule and times out (both expected), leave no rule behind; one
process's clean-up removes its own leftovers and never another's. With the fixture's clean-up taken out by hand,
the rule test fails (9 rules left); put back, it passes.

| Run (retries off, each its own results folder `e2e/.reports/su10/`) | Result |
|---|---|
| The harness tests | 5 of 5 (two of them expected to fail, and did) |
| The whole resilience set | 57 of 57 |
| Smoke, while a second process ran `paystack.spec`, `services.spec` and `switched-off.spec` | smoke 7 of 7 (19:51:02-19:51:15); the second process 30 of 30 (19:50:54-19:51:38), so smoke's clean-up ran in the middle of it |
| The other tests the change touched (fuzz, account races, navigation, accounts) | 39 of 39 |
| Chaos | 17 of 17 |
| Rules left on the fake, test users left in the database | none, none |
| Lint, type check | pass (39 warnings, none new) |

No removal proof added: an end-to-end proof rebuilds the app, which this change does not touch; the rule test was
checked against its fixture by hand instead.

## payments-switched-off: SU7, a home that is no longer available (2026-11-02, branch `payments-switched-off`)

Branch `payments-switched-off`, from `main` at `c27c0bd`, pushed after each commit, **not merged**. Built and
tested on the local test stack only, under `caffeinate -dims` on mains power; no live database, switch or
environment variable touched; no real Paystack, email or SMS.

### SU9 fixed in the test harness (`e2e/lib/db.ts`), not merged yet

As decided, test side only: `deliver.ts` is unchanged, because the app never deletes `MessageLog` rows (only the
test clean-up does), so production cannot reach the 500. The clean-up (`purge`) now never deletes a message a send
job has claimed (`SENDING`): it deletes the people's other messages at once and waits (up to 20 s) for one being
sent to be recorded; inside its transaction it deletes only messages not being sent, and if a job claims one in that
moment the person's foreign key stops the transaction, which waits and goes again.

Proof, retries off, each run in its own results folder (`e2e/.reports/su9/`):

| Run | Result |
|---|---|
| "the send job starts on two servers at once", 50 times, four at a time | 50 of 50 |
| the same 50, while a second Playwright process ran the resilience set twice | 50 of 50 |
| that second process (the resilience set twice) | **not clean: 78 passed, 26 failed**, see below |
| the whole resilience set and 50 copies of the test, in one process (as the full suite runs) | **102 of 102** |
| the whole resilience set once | **52 of 52** |
| lint, type check | pass (39 warnings, none new) |

**The run that was not clean was my test set-up, not the fix.** The 50-run process finished first, and the harness's
global teardown deletes every remaining `e2e-…@fiegh.test` user, including the second process's people: its
failures begin two seconds later (a booking gone mid-test, a user gone under a `Verification` row, a sign-in for a
person deleted). One of those, "verify drops the connection", had added a fake-Paystack rule with
`match: pay.reference` while the reference was undefined, so the rule matched every request and stayed: every
later payment check failed ("CONFIRMED/UNPAID after paying"). The rule (`verify`/`reset`, 105 hits) was removed by
hand. The full suite runs one process, so neither can happen there; both recorded as SU10 (test code, open). The
check was then made the way the full suite runs: 102 of 102.

### SU8 fixed, and the full set again (`06734e5`, `183992d`)

- **SU8** (`06734e5`, test code only): the map and date-picker "file does not arrive" tests end with
  `page.unrouteAll({ behavior: 'ignoreErrors' })`; so do `resilience/loads.spec.ts`'s routed test (the only other
  test that fetches inside a route) and the context fixture (`e2e/lib/test.ts`), whose route for the fake
  Paystack's pages fetches in the Safari set-ups. Checked first: the affected tests 20 of 20, the Safari payment
  tests 8 of 8, no error outside a test.
- **Each suite's own results** (`183992d`): `E2E_REPORT_DIR` puts the JSON results, HTML report and artifacts in a
  folder of the run's own. The run below wrote `e2e/.reports/su8/full/<suite>/`, each with a `summary.txt` naming
  every test that did not simply pass.

**The full set, once, on `183992d`, under `caffeinate -dims`, mains power:**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each of the six zones |
| Harness build | pass |
| Money rules (with SU7's) | clean before and after (2 of 2 each) |
| Chromium suite, races at 50 rounds | **216 passed, 4 skipped (the four "pictures" tests, only when asked for), 1 flaky, 0 failed, 0 did not run, no error outside a test** |
| Chaos | 17 passed |
| Other five set-ups | 226 passed, 4 skipped (the map in headless Firefox), 0 flaky, 0 did not run |
| Removal proofs | **all 269 hold** |
| Bundle guard | pass; **desktop search 648 KB of 650** |

SU7's races at 50 rounds: switched off as the money landed, 41 paid and left alone and 9 refunded in full and
ended; switched off as Pay was pressed, 14 refused before Paystack and 36 paid on a page handed out first and
refunded in full. Never both, never neither, one charge every round.

**Not clean: one flaky test, not re-run.** `resilience/services.spec.ts`, "the send job starts on two servers at
once: each email goes once", failed once and passed on its retry: one of the four simultaneous `send-messages` runs
answered 500 (every email still went exactly once). The app log has the cause: `messageLog.update` in
`src/lib/messaging/deliver.ts` (recording a message's outcome) threw P2025, "No record was found for an update".
The send job works over the whole database, and another test's clean-up (`purge` in `e2e/lib/db.ts`, the only code
that deletes `MessageLog` rows) deleted a row it was sending. Recorded as **SU9**: older than these branches
(`deliver.ts` unchanged since `6c66f24`), not reachable in production today (the app never deletes these rows), a
small fix proposed; needs your go-ahead.

### The rule, as decided

A home is no longer available when its host switched it off (`isActive = false` and `moderationHold = false`) or
the host is suspended (`src/lib/homeAvailability.ts`). **Homes on hold are deliberately outside the rule**: an
admin hold and the automatic contact-details hold store the same thing (`isActive = false`, `moderationHold =
true`), so the code cannot tell them apart, and an automatic hold must never end a guest's booking. Held homes stay
payable, nothing ends their bookings early, money that lands on them is confirmed, and an admin who holds a home
with unpaid bookings handles those **by hand**. A hold-kind column (for example `Listing.holdKind`, set by the two
hold paths) would let admin holds join the rule later; it is a schema change on the live database, not made.

### What changed, in order (one commit each, each pushed)

1. **`65354a6`**: `POST /api/payments` refuses a booking's first payment on such a home (409, `HOME_UNAVAILABLE`,
   "This home is no longer available. You have not been charged."), before a payment row is written or Paystack is
   called, so an open Paystack page is not handed back either. Accepting a request there is refused ("Switch this
   home back on before accepting requests for it."); declining works. Later rent on a paid tenancy is untouched.
   Proofs 263, 264.
2. **`40ccd7a`** (`settlePayment`, the riskiest change): a successful charge on an unpaid confirmed booking on such
   a home is refunded in full: in one transaction the payment is claimed (SUCCESS), the booking ends (`CANCELLED`,
   `SYSTEM`, `HOME_UNAVAILABLE`, `PAID`), open instalments are cancelled, its own nights are released (never a
   host's own blocks), and the refund is recorded through the existing late-payment path (`LATE_PAYMENT`). The home
   is read again inside that transaction after the claim; if it changed since the decision, the charge is decided
   again. A booking paid before is never touched. Proofs 265, 266.
3. **`1bf9483`**: `expire-bookings` ends unpaid bookings and unanswered requests on such a home at its next run,
   whatever their deadline (bookings with no `payBy` too), after asking Paystack: a payment that went through is
   settled (and refunded), one in progress waits. Dry run, or the job switched off: `would-end`. The approved
   messages (guest; the host who switched the home off; the refund with "several working days"). A suspended host
   is not written to: the approved wording covered a switched-off home only. Proof 267.
4. **`a0002bf`**: booking reads carry `homeAvailable` (the home's switches and the host's suspension are not sent);
   a new pay state; checkout, the guest's booking page and dashboard show the message instead of a Pay button; the
   host's bookings show "Home switched off". End-to-end tests, races, money rules. Proofs 268 (end to end), 269.
5. **`d2bd91e`**: removal proofs 36 and 37 (H6, contact details hidden) re-anchored: commit 4 wrapped the lines they
   look for, so the full run could not apply them. Both hold.

`CLAUDE.md`: the suspension rule no longer says a guest can still pay for a suspended host's bookings; a new section
"A home that is no longer available (SU7)", with holds outside the rule and handled by hand.

### Tests

- Unit (`paymentSettle.test.ts`, `homeAvailability.test.ts`, `messaging/homeUnavailable.test.ts`): refused for a
  switched-off home and a suspended host, an open page not handed back, a held home payable and acceptable; money
  after the switch-off refunded once even with webhook and verify arriving twice together; a held home confirmed; a
  booking paid before the switch-off untouched; a switch-off between the decision and the write caught; every case
  of the expiry job; the approved wording.
- End to end (`switched-off.spec.ts`, every browser set-up): SU7's `test.fail()` is now a normal test (refused,
  what the guest sees, ended by the job, both told); a suspended host; **the held-home edge** (stays payable, not
  ended, its payment confirmed, no refund); **switched off while the guest is on Paystack's page** (the payment
  finishes, one charge, one full refund, the booking ends, webhooks on both servers twice change nothing).
  Screenshots: `e2e/.reports/switched-off/`.
- `money.spec.ts`: a stay paid before its home was switched off stands and **is paid out**.
- Races, 50 rounds each: **switched off as the money lands** (webhooks on both servers and the guest's return in the
  same tick): 40 rounds paid and left alone, 10 refunded in full and ended, never both, never neither, one payment
  and one charge every round. **Switched off as Pay is pressed**: 15 refused before Paystack, 35 paid on a page
  handed out first and refunded in full.
- Money rules (`e2e/lib/invariants.ts`): a booking ended because its home went was never charged or holds one full
  refund, and has no payout; `load/invariants.spec.ts` now also runs the expiry job live and checks that no unpaid
  booking is left on such a home (so, unlike the rest of the checker, it writes: it ends what the job would end).

### The full set, once (`a0002bf`, under `caffeinate -dims`, mains power)

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (39 warnings, none new); 1,675 tests in each of the six zones |
| Harness build | pass |
| Money rules, with the new ones | clean before and after (2 of 2 each time) |
| Chromium suite, races at 50 rounds | **216 passed, 4 skipped, 0 failed, 0 flaky, 1 did not run; exit 1**: one error outside any test (SU8, below) |
| Chaos | 17 passed |
| Other five set-ups | 226 passed, 4 skipped, 0 failed, 0 flaky |
| Removal proofs | **267 held, 2 did not**: 36 and 37 could not be applied (their text had moved, commit 4); re-anchored in `d2bd91e`, and both hold |
| Bundle guard | pass; **desktop search 648 KB of 650** |

**So the run was not clean**, and nothing was re-run to make it so:

- **The Chromium suite exited 1.** `tests/perf/bundle.spec.ts`, "a date-picker file that does not arrive gives Try
  again" (not changed by SU7) left its `page.route` handler fetching a chunk after the test ended; Playwright raised
  "route.fetch: Test ended" outside any test and stopped that worker, and one test was counted "did not run" (all
  221 started; which one was cut short is not recorded: the run's JSON was overwritten by the chaos set). Recorded
  as SU8, with the one-line fix proposed (`page.unrouteAll({ behavior: 'ignoreErrors' })`); not fixed.
- **Proofs 36 and 37** did not run in the full set because their anchors had moved: a mistake in commit 4, fixed in
  `d2bd91e` and both proved holding on their own afterwards. The full set was not run again.

## security-upgrades: the audit items that ship (2026-11-02, branch `security-upgrades`)

Branch `security-upgrades`, from `main` at `2c51a84`, pushed, **not merged**. Everything ran on this MacBook Air on
mains power under `caffeinate -dims`, on the local test stack, built only through the harness; nothing real was
called; no switch or environment variable was set; **the live database was not touched.**

### SU6 bounded, a switched-off home checked, and a clean full run (2026-11-02, `296e810`, `972894d`)

**SU6, option 1 tried first** (wait 1 s inside the change's own request, then mark the home page again, awaited
at the seven call sites). The race test passed 20 of 20, but the original "leaves the home page at once" test
failed 9 of 20 with four in parallel (each time the page right after the answer was a cache HIT with the home in
it), so it did not meet the bar and was reverted. How much slower each action answered with it (median of 8, local
stack, against the same code without the wait):

| Action | Before | With option 1 |
|---|---|---|
| Create a listing (`POST /api/listings`) | 3 ms | 1,012 ms |
| Edit a listing (`PATCH /api/listings/[id]`) | 4 ms | 1,016 ms |
| Add a photo (`POST /api/listings/[id]/photos`) | 6 ms | 1,023 ms |
| Admin holds a listing (`POST /api/admin`) | 3 ms | 1,014 ms |
| Admin clears a hold (`POST /api/admin`) | 3 ms | 1,012 ms |
| Switch a listing off (`DELETE /api/listings/[id]`) | 3 ms | 1,014 ms |
| Admin suspends an account (`POST /api/admin/users`) | 5 ms | 1,009 ms |

**SU6, option 4 landed** (`296e810`): the home page is redrawn every 60 s instead of every 300 s
(`s-maxage=60`). The guarantee is now "usually at once, at most a minute". The original test polls for up to 75 s
and records the time: 20 of 20 passed with four in parallel, 19 at once (0.5-1.4 s, the page load) and one after
62.5 s; the race test left a copy behind in round 8, gone after 64 s. (The first visit after the minute still gets
the old copy while the page is drawn again, so "a minute" is about 60-65 s.) A test that the page is kept at most
60 s is removal proof 262. Money and sign-in code are untouched.

**Extra database reads:** a redraw of the home page runs 3 small listing queries (one per rental type, up to 8 rows
each); nothing else on the page reads on the server. Timed redraws happen only when the page is visited after its
minute: at most 1,440 a day (4,320 queries) instead of 288 (864), so **at most about 3,456 more queries a day,
about 2.4 a minute**, and only if the home page is visited every minute. Redraws after a change are unchanged.

**A switched-off home from an old page** (`972894d`, `tests/journeys/switched-off.spec.ts`, @core, every browser
set-up). What the guest sees:
- pressing a card on a home page drawn before the switch-off: "Listing not found. This listing may have been removed
  or is no longer active." with "Browse all listings"; no dates, no Book button
  (`e2e/.reports/switched-off/*-stale-card.png`). The server refuses a booking: 400 "Listing is not available";
  no booking, no payment;
- a listing page left open: dates chosen, then Instant Book after the switch-off shows "Listing is not available"
  under the price; nothing booked or charged (`*-open-listing-page.png`);
- **SU7 (new, open):** a booking confirmed *before* the switch-off can still be paid for after it: `POST
  /api/payments` answered 200 with a Paystack link. The payment route does not look at the listing. Payment code
  was not changed; the test expects a refusal and is marked `test.fail()` until you decide.

**The full set, once, under `caffeinate -dims` on mains power (`972894d`):**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass (lint: 39 warnings, none new, 0 errors); 1,646 tests in each of the six zones |
| Harness build | pass |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Chromium suite, races at 50 rounds (resilience, session, accessibility included) | **211 passed, 4 skipped, 0 failed, 0 flaky** (SU7's test counted as the expected failure it is marked to be). Peak 26 connections |
| Chaos set | **17 passed** |
| Core set in Firefox, WebKit, tablet, iPhone, Android | **216 passed, 4 skipped, 0 failed, 0 flaky** |
| Removal proofs | **all 262 hold** (261 SU5, 262 SU6) |
| Bundle guard | pass. **Desktop search with the map 648 KB of 650.** Phone pages 200-243 KB |

**Clean: no failure and no flaky test anywhere.**

### SU5 fixed; SU6 cause found, fix waiting for a decision (2026-11-02, `ac0d7f3`)

**SU5** (`ac0d7f3`): what each engine writes was checked in Node, Chromium, WebKit and Firefox for every date
format the code uses. Only short month names differ ("Sept" in Node, Chromium and Firefox; "Sep" in WebKit);
numbers in `en-GH` and `en-US` are the same everywhere. `src/lib/dateText.ts` now writes every date from a fixed
table, with the same output as before except "Sep", and every date in `src/` goes through it:

| Where | Drawn by the server too? | Was |
|---|---|---|
| `formatStayDate`: checkout, both dashboards, booking and problem pages, host bookings and calendar, rent schedule, price breakdown, cancel dialog, admin disputes, rent and listing checks | yes (checkout, dashboards) | `en-GH` short months: "Sept" vs "Sep" |
| `formatPayBy`: checkout, guest dashboard, booking page | yes | `en-GB` short months |
| Listing page: host joined, review months | yes | long months (same everywhere, moved for safety) |
| Search: the date summary | yes | `en-GB` short months |
| Admin: exchange rate updated / last fetch | yes (Settings tab from a link) | `toLocaleString()`: the runtime's language and zone. Now "6 Sep 2027, 3:45 pm", UTC from the server, the reader's zone once running |
| Profile, guest payments, host payouts, admin users, verifications and messages, message dates, refund and listing-check wording, blocked-dates message | no (fetched in the browser) | short months or the runtime's zone; now the table (reader's zone kept where it was) |
| Home page cedi prices, wishlist, host bookings total | home page yes | `toLocaleString()` with no locale; now pinned |

Tests: `src/lib/dateText.test.ts` (every month, every format, the six zones of `test:tz` and the process's own,
and a guard that fails on any locale date call in `src/`); `tests/journeys/dates.spec.ts` (@core, every browser
set-up): a stay in September reads "Sep" from the server and in the browser on checkout and both dashboards, with
no React 418. It failed on the old build ("Sept" in the server's copy). Removal proof 261; proof 257 (SU1)
re-anchored on the new 12-hour clock. Both hold.

**SU6: the cause.** In Next's cache (`next/dist/server/lib/incremental-cache`), a page that is kept is stamped
with the moment it is stored (`set()`: `lastModified: Date.now()`), and `revalidatePath('/')` expires only copies
stored before the mark (`areTagsExpired`: `expiredAt > timestamp`). A visit that read the listings just before a
home was switched off, and stored the page just after the switch-off marked it, is therefore kept as fresh. Shown
with a probe (every response for `/` recorded): one test at a time with only visits to `/`, 0 of 15 failed; with
visits and another listing's edits (which keep drawings under way), 4 of 15, each time a cache HIT holding the
switched-off home, put right only by the next mark.

**On `main` (`2c51a84`, Next 16.3.8):** the same code in Next, and the same result: the probe 4 of 15, the suite's
test 2 of 20 with four in parallel. Not caused by the upgrade.

**Tried and dropped:** marking the page again 1 s and 5 s later from `after()`. Next applies every mark made in
`after()` only when all of the request's `after()` work has finished, as one mark, so the 1 s mark landed at 5 s.
A new race test (four lanes: three visitors drawing `/`, a host editing another listing; ten rounds) failed every
time alone on the old code (19 bad rounds in 50) and still failed 3 of 5 runs with this change (3 in 50). Reverted;
the test and the attempt are kept outside the repository for whichever fix is chosen.

**Not run:** the full set. The suite's test for SU6 is still flaky under parallel load, so the run could not be
clean; it waits for the SU6 decision.

### SU1-SU4 fixed, and the full set again (2026-11-02, `f023872`..`c741149`)

On the owner's go-ahead, one commit each, still on this branch and not merged:

1. **SU1** (`f023872`): `formatPayBy` uses `hourCycle: 'h12'` in place of `hour12: true` (which overrides
   `hourCycle`, so it is gone, not kept beside it). New `src/lib/payDeadline.test.ts`: 12:00-12:59 am and pm and
   the hours either side, in the six zones of `test:tz` and in the process's own zone. Proof 257.
2. **SU2** (`0bc322a`): one Prisma client per process in production too. **Why `db.ts` was loaded twice:**
   Turbopack bundles it once for the API routes and once for the pages. A server-first page imports its route's
   `GET` (`lib/serverRead.ts`), so `db.ts` is also compiled into the page layer, under a second module id (843793
   and 761469 in that build). Both copies live in one process and each ran its own top level; `db.ts` shared the
   client through `globalThis` only outside production, so a production server made two clients, two pools. Now
   it is shared in every environment. Tests: `src/lib/security/onePool.test.ts` loads `db.ts` three times as fresh
   modules and fails if a second `PrismaClient` is made; `tests/resilience/one-pool.spec.ts` starts an app server
   with a pool of one, asks it for API routes and server-first pages one after another and counts its
   connections to Postgres (2 on the old build, 1 now). The harness gives each app a pool of 10 (`run.mjs`,
   `--pool` or `E2E_APP_POOL` to change it). Proofs 258, 259.
3. **SU3** (`23db71f`): without WebGL2 the map area says "The map isn't available on this device. The list shows
   the same homes." (no canvas, pins or credits); tested with WebGL2 refused, on desktop and both phones. Proof 260.
4. **SU4** (`c741149`): "1 property found", "Map view · 1 property".

**Connections, full Chromium suite (races at 50 rounds), peak on the test Postgres (limit 60):**

| | Peak | Largest single app server | "Too many clients" |
|---|---|---|---|
| Before the fixes (`84e6764`, second run) | 60 | 33 | yes: 1 failed, 2 flaky; first run 34 failed |
| Before any upgrade (`292958f`) | 56 | 30 | none |
| **After the fixes (`c741149`)** | **25** | **10** (its pool) | **none** |

(The chaos set afterwards takes every free connection on purpose, "no connections left": with 53 taken, 35 of 40
requests were answered 200 and 5 with a plain 500, and both servers mended. Those are the only "too many clients"
lines in the app logs of this run.)

**The full set, under `caffeinate -dims` on mains power:**

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass; 1,549 tests in each of the six zones |
| Harness build | pass |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Chromium suite, races at 50 rounds (resilience, session, accessibility included) | **204 passed, 4 skipped, 1 flaky**: "a home switched off leaves the home page at once" failed once and passed on retry (SU6) |
| Chaos set | 17 passed |
| Core set in Firefox, WebKit, tablet, iPhone, Android | **199 passed, 4 skipped, 2 flaky**: the crawl as host on tablet and iPhone, React error 418 on the host dashboard, passed on retry (SU5) |
| Removal proofs | **all 260 hold** (257-260 new) |
| Bundle guard | pass. Desktop search with the map **648 KB of 650** (647 before; the WebGL2 check and message are 1 KB). Phone pages 200-243 KB |

**So the run was not clean.** Nothing was re-run to make it pass. No failure was about connections. The three
flaky tests are two older faults, both new findings:

- **SU5**: a September stay date is "Sept" from the server (Node's ICU 75, `en-GH`) and "Sep" in Safari, so a
  server-first page with a September date is drawn twice in Safari. A diagnostic (24 loads of the host dashboard
  in the tablet and iPhone set-ups) reproduced 418 three times, each with a September booking; the crawl's dates
  are random, which is why it passed on retry and in earlier runs.
- **SU6**: the home-page test fails only alongside other home-page renders: 0 of 20 one at a time, 2 of 20 with
  four in parallel. A render that read the listings before the switch-off appears to be kept after
  `revalidatePath('/')`. In real use a switched-off home could stay in the hero until the 5-minute refresh.

Neither is fixed: both need your go-ahead.

### What changed, in order (one commit each)

1. **Map tests on maplibre 5** (`292958f`): `tests/journeys/map.spec.ts` (pins, popup and its link, clusters that
   zoom apart or list, Enter and Escape, no map or worker error), written and passing before the upgrade. Before
   screenshots in `e2e/.reports/map-shots/v5-*`.
2. **Next 16.3.8 → 16.4.3**, pinned, with `eslint-config-next` (`2e3c7dd`). The three October advisories are fixed
   from 16.4.1. None reached this app: `dangerouslyAllowSVG` is not set and sharp was already 0.35.5; there is no
   `use cache`; there is no Server Action (`'use server'` appears nowhere: every write is an API route). 16.4.4 (out
   on 2 November) was read first: bug fixes only, no advisory, so 16.4.3 is kept. The version test now requires 16.4
   with patch 1 or later; proofs 48 and 49 are re-anchored on the new version line.
3. **maplibre-gl 5.24 → 6.16, react-map-gl 8.1.1 → 8.1.3** (`8eea4f3`). The advisory was in `DOM.sanitize`, used
   only by maplibre's attribution control, which was off. Two changes were needed: maplibre 6 runs its worker from
   a file of its own, which `ListingsMap` now hands to the bundler and passes as `workerUrl`; and maplibre 6 removed
   the internal `map.transform` that react-map-gl 8.1.1 read (the map never finished loading), which 8.1.3 no longer
   uses. Popups, markers, clustering and the `.map-popup` CSS needed nothing. The bundle guard now counts the
   worker's bytes. After screenshots: `e2e/.reports/map-shots/v6-*`.
4. **@sentry/nextjs 10.72 → 10.78** (`c3a04a0`). The advisory needed a tunnel route and a webpack build; there is
   neither here. The hand-built browser client is unchanged and still reports errors and unhandled rejections,
   scrubbed (`tests/resilience/browser-errors.spec.ts`; proofs 77 and 248). Every page is 2 KB smaller.
5. **The map's credits** (`84e6764`): "© MapTiler © OpenStreetMap contributors", as MapTiler's terms ask; our own
   small line (not maplibre's control), bottom left, clear of the zoom buttons, both links to the copyright pages,
   in a new tab; a test checks text, links, size and position. Screenshots: `e2e/.reports/map-shots/attr-*`.

`npm audit`: 60 → **56**; nothing high or critical in anything that ships. Left in what ships: a moderate on
@sentry/nextjs from the OpenTelemetry packages it uses on the server (no fixed release, not even 11.x; server
tracing is off, so the database-user advisory never applies).

### Speed

Real throttling, before → after, mobile LCP: 1.58-1.74 → 1.61-1.76 s on all seven pages, TBT at most 33 ms, CLS 0:
within the run-to-run spread. Script on first load: 2-6 KB less on every page. Desktop search with the map:
484 → **647 KB of its 650 KB cap**, all of it maplibre 6 (its worker, 145 KB, used to be inside its script and is
now a file of its own, counted since this branch). Full table: `e2e/load/results/security-upgrades.md`.

### Verification (`84e6764`)

Quick set after each commit (lint, type check, `test:tz`, harness build, smoke, bundle guard) plus each commit's
own tests: all passed. (On the Next commit the server-first test first failed at 11:3x UTC and passed after 12:00:
the pay-by formatter, unchanged by this branch, writes 12 o'clock times differently on the server; SU1 below.) The full set once at the end:

| Check | Result |
|---|---|
| Lint, type check, `npm run test:tz` | pass; 1,476 tests in each time zone |
| Harness build | pass, logged (`e2e/.reports/security-upgrades/full/build.log`) |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Chromium suite, races at 50 rounds (resilience, session, accessibility included) | **first run: 165 passed, 34 failed, 4 flaky; every one "too many clients" on the test Postgres (SU2). Second run: 200 passed, 1 failed, 2 flaky** (two race tests with 500s from the same cause, and "a home switched off leaves the home page" timing out). The same suite on `292958f` (before any upgrade): 202 passed, peak 56 connections; with the upgrades the peak was 60, the limit. |
| Chaos set | 17 passed, both runs |
| Core set in Firefox, WebKit, tablet, iPhone, Android | 197 passed, 3 skipped (the map in Firefox), none flaky |
| Removal proofs (restore-safe runner) | **all 256 hold**; 48 and 49 re-anchored on the Next version line |

So the full set did not come back clean. The failures are the test database running out of connections, which
the suite on the commit before the upgrades did not quite do (56 of 60). The cause is older than this branch (SU2):
each app server holds more than one Prisma pool. Reverting upgrades one at a time would not separate a 4-connection
difference from run-to-run noise; the fix that would is SU2's, which needs your go-ahead.

### Found along the way (FINDINGS.md, SU1-SU4; fixed afterwards, see the top of this section)

- **SU1**: "Pay by 0:34 pm": a deadline in the 12 o'clock hour is written with a 0-11 clock by the server. One line.
- **SU2**: two Prisma pools per app server (production: two connections per instance, not one); the test database
  runs out. Proposed: keep the client on `globalThis` in production too, and an explicit pool size in the harness.
- **SU3**: without WebGL2 the map area is empty, with no message (maplibre 5 fell back to WebGL1). Screenshots:
  `e2e/.reports/map-shots/v5-nowebgl2.png` (map and pins) and `v6-nowebgl2.png` (empty).
- **SU4**: "1 properties found".
- A pointer press on a pin does not move the focus (the map stops the default on its markers), so Escape closes a
  popup only when it was opened from the keyboard; the close button and a tap on the map close it otherwise.

### Dev-only items, not upgraded (owner's decision)

| Package | Fix | Major | Clears | Why not now |
|---|---|---|---|---|
| vitest 3.2.7 | 4.1.12 | yes | vitest, vite, tinypool, @vitest/mocker (2 critical, 1 high, 1 moderate) | test runner only; may need config changes across 1,476 tests |
| prisma CLI 6.19 | 7.10 | yes | prisma, @prisma/config, deepmerge-ts (3 high) | the CLI and `@prisma/client` move together: a server change for every query. Its own project after launch |
| lighthouse 12.8.2 | 13.6 | yes | 9 high and most moderates (it carries Sentry 9) | the G5 speed figures would need a new baseline |
| eslint 9 | 10.14 | yes | 1 | the rest follow `eslint-config-next` |

### Not checked

- Real MapTiler tiles (the harness's style is a plain background), real phones, a real Vercel build.
- A real phone without WebGL2: simulated by making the browser refuse it.
- Real Sentry: a report from the browser after the upgrade, with its source maps.

## mobile-speed: G5, pages that come with their data (2026-11-01/02, branch `mobile-speed`)

Branch `mobile-speed`, from `main` at `38a9975`, not merged. Everything ran on this MacBook Air on mains power on
the local test stack, built only through the harness; nothing real was called; no switch was set in `.env`; no
email, SMS, Paystack, Arkesel or Sentry upload; **the live database was not touched.** The home page's code was
left alone (its redesign is next): its figures moved only with the shared changes.

### What changed, in order (one commit each)

1. **Guards** (`4c3da58`): a script budget per page (`tests/perf/bundle.spec.ts`: 350 KB compressed on first
   load, the router's prefetching of linked pages left out; desktop search with its map 650 KB; map code only on
   desktop search; date-picker code only once a date field is opened), browser errors reaching Sentry scrubbed
   (`tests/resilience/browser-errors.spec.ts`: an error and an unhandled rejection), and no server code in any
   client file (`src/lib/security/clientImports.test.ts`).
2. **Admin's Prisma leak** (`6dcaf89`): two constants moved to `lib/exchangeRateShared.ts`.
3. **The map** (`f214627`): fetched on a phone only when "Map" is pressed (it had loaded, hidden, on every phone:
   280 KB), on desktop once the list has drawn, same-size skeleton, "Try again" if the file fails
   (`lib/useOnDemand.ts`). Its stylesheet already loaded only with it.
4. **The date picker** (`a0490c5`): on the listing page, fetched when a date field is opened
   (`components/ui/LazyDatePicker.tsx`); the same input until then.
5. **Sentry** (`7b3b164`): `compiler.define` was not used: Next applies it to the server and edge builds too,
   which stay unchanged. The browser client is built from the same parts minus tracing; `...SCRUBBING` is word
   for word as before; `onRouterTransitionStart` is gone (Sentry's build prints a notice about it: it feeds
   navigation tracing only). About 42 KB less on every page.
   **Found on the way (G6 follow-up, `97c2589`):** the chunk guard fetched and ran Next's `nomodule` polyfills
   (about 40 KB) on every page view; it now leaves them alone.
6. **Server-first pages** (`afb52c4` checkout, `8f40bc5` guest dashboard, `81de7c5` host dashboard, `986cd53`
   listing, `a9b47e9` search, `c55c4f4` admin): each `page.tsx` calls the API route's own `GET` in the same
   process for the request being answered (`lib/serverRead.ts`), so the data and its checks are those the browser
   would get, and only a 200 is used. With no answer within 3 s the page fetches in the browser as before (tries,
   Try again, G1's 401 rule). The notices above the dashboards come with them too, which ends the host dashboard's
   layout shift. Then `0e99928`: the client pages had Suspense boundaries of their own, and React threw the
   server's HTML away and drew checkout again once its JavaScript arrived (on every load); they are gone, with a
   test that each page keeps the element the server sent.
7. **Inlined stylesheets** (`669ecfc`, reverted in `699f8c7`): kept reverted by the owner's decision. An open
   option to revisit after the live Lighthouse run; see "For the owner" below.
8. **Logo font** (`b175444`, reverted in `89850c0` by the owner's decision): Unbounded was kept for "fie." and no
   longer preloaded. No measurable gain beyond the run-to-run spread, and the logo was drawn in the fallback at
   first paint and swapped about 0.5 s later. It is preloaded again, as on `main` before this branch; home and
   search measured after the revert are in `results/g5-final.md`.
9. **Packages** (`a027977`): the 7 unused packages removed, 2 type packages moved to devDependencies.

The commit `39ca97f` ("measuring after the Sentry change") carried half-made server-first files by mistake and did
not build on its own; `2fe83a5` puts them back and the server-first commits follow it. Nothing was force-pushed.

### Before and after against the budgets

Lighthouse 12.8.2 as in Stage B (simulated slow 4G, CPU 4x, median of 5 runs). "JS first load, phone" is the
bundle guard's count (the baseline built from `38a9975` through the harness).

| Page | LCP mobile, empty DB | LCP mobile, seeded | CLS (worst) | TBT (worst) | JS first load, phone | JS, Lighthouse | Desktop LCP, seeded |
|---|---|---|---|---|---|---|---|
| home | 3.6 s → 3.3 s **over** | 3.6 s → 3.3 s **over** | 0.000 → 0.000 | 41 → 17 ms | 327 → 247 KB | 320 → 261 KB | 0.6 s → 0.7 s |
| search with map (desktop: 204 KB, 484 KB with the map) | 4.5 s → 3.1 s **over** | 7.3 s → 3.2 s **over** | 0.000 → 0.000 | 193 → 18 ms | 565 → 204 KB | 604 → 279 KB | 1.5 s → 0.7 s |
| listing | 4.2 s → 3.4 s **over** | 4.2 s → 3.5 s **over** | 0.038 → 0.000 | 78 → 28 ms | 347 → 223 KB | 354 → 299 KB | 0.9 s → 0.6 s |
| checkout | 4.1 s → 2.4 s | 4.1 s → 2.4 s | 0.077 → 0.000 | 67 → 31 ms | 286 → 206 KB | 320 → 280 KB | 0.9 s → 0.5 s |
| guest dashboard | 3.8 s → 3.2 s **over** | 4.2 s → 2.6 s **over** | 0.000 → 0.000 | 63 → 32 ms | 304 → 224 KB | 361 → 321 KB | 0.8 s → 0.6 s |
| host dashboard | 4.4 s → 2.4 s | 3.3 s → 3.4 s **over** | 0.176 → 0.000 | 71 → 19 ms | 300 → 220 KB | 336 → 296 KB | 1.0 s → 0.5 s |
| admin | 4.4 s → 3.1 s **over** | 4.8 s → 2.4 s | 0.000 → 0.000 | 64 → 31 ms | 309 → 212 KB | 343 → 287 KB | 1.0 s → 0.5 s |


Simulated LCP for the server-first pages lands at about 2.4 or about 3.1 s from run to run: the simulation counts
every script that started before the content was painted, even ones that do not hold it up; in Lighthouse's own
recording, LCP is the first paint. So the same pages were measured with the browser really slowed to the same line
and CPU (`E2E_LH_THROTTLING=devtools`, empty database, 3 runs):

| Page | Mobile LCP | Mobile CLS | Mobile TBT | Desktop LCP |
|---|---|---|---|---|
| home (unchanged, redesign pending) | 1.57 → 1.55 s | 0.000 → 0.000 | 62 → 40 ms | 0.09 → 0.08 s |
| search with map | 5.34 → 1.60 s | 0.000 → 0.000 | 143 → 15 ms | 0.17 → 0.16 s |
| listing | 5.04 → 1.63 s | 0.038 → 0.000 | 62 → 15 ms | 0.20 → 0.12 s |
| checkout | 3.90 → 1.65 s | 0.077 → 0.000 | 52 → 22 ms | 0.19 → 0.13 s |
| guest dashboard | 3.99 → 1.67 s | 0.000 → 0.000 | 48 → 24 ms | 0.16 → 0.12 s |
| host dashboard | 4.59 → 1.66 s | 0.123 → 0.000 | 50 → 23 ms | 0.22 → 0.15 s |
| admin | 4.03 → 1.66 s | 0.000 → 0.000 | 50 → 22 ms | 0.19 → 0.11 s |

The harness's photos are small generated ones, so the image pages (home, search, listing) do not carry a real
photo's weight in either table. Results per step: `e2e/load/results/g5-*.md`.

### Verification on the final code (`414ae03`, under `caffeinate -dims`, mains power)

| Check | Result |
|---|---|
| Lint, type check | pass (warnings only, all from before) |
| `npm run test:tz` (six time zones) | pass, 1,476 tests each |
| Full harness build | pass, logged (`e2e/.reports/mobile-speed/final/build.log`) |
| Chromium suite, races at 50 rounds | 199 passed, 4 skipped (the opt-in contrast measurement), none flaky |
| Chaos set (now with the server-first fallbacks) | 17 passed |
| Core set in Firefox, WebKit, tablet, iPhone, Android | 189 passed, 1 skipped (the map in Firefox), none flaky |
| Resilience and session sets, accessibility scan | in the Chromium suite: pass, 0 accessibility failures |
| Money and date rules (`load/invariants.spec.ts`) | clean before and after |
| Removal proofs (restore-safe runner) | **all 256 hold**; 245-256 are new (245 admin import, 246 map on phones, 247 eager date picker, 248 browser scrubbing end to end, 249 chunk guard and `nomodule`, 250-255 each page's server data, 256 no Suspense boundary of their own). 246 and 245 were re-anchored when their code moved to `SearchClient.tsx` and `AdminClient.tsx`; none of 1-244 needed it. |

### For the owner

- **Inlined stylesheets** were reverted because the agreed measure (the simulated runs) got worse: LCP up on 5 of
  7 pages and TBT up on all (listing 259 ms). With real throttling the same change made every page 0.2 to 0.9 s
  faster (checkout 1.67 → 0.81 s). Decision: it stays reverted for now, an open option to revisit once
  Lighthouse has been run against the live site; `669ecfc` has the change (one setting in `next.config.ts`).
- The logo font change showed no gain in either measure and cost a flash of the plain logo: reverted (`89850c0`).
- `npm audit` reports 60 issues now, before and after the package change (CLAUDE.md says 12: its list has grown).
- Seen once, not reproduced in 6 targeted runs: React error 418 (text differed between server and browser) on the
  host dashboard in the iPhone set-up during a crawl. React recovers by drawing that part again.

### Not checked

- Real phones, real networks, Vercel and Supabase's real latency: the server now waits for its reads (up to 3 s)
  before sending these pages.
- Real Sentry: that a report from the hand-built client shows a readable stack trace from the uploaded source maps.
- Real MapTiler tiles and real photos (the harness answers with a blank style and small photos).

## fix-perf-1: fixes and capacity (2026-10-21, branch `fix-perf-1`)

Branch `fix-perf-1`, from `e2e-performance`, not merged. Everything ran on this MacBook Air on the local test
stack; nothing real was called; no switch was set in `.env`; no email or SMS was sent; no Paystack call was made.
**The live database was not changed:** the Supabase project could not be reached (see G13 below).

### What was fixed

G15, G6, G1, G7, G2, G11, G4, G9, G8 and G10, one commit each; the capacity work; the Vercel region and the
production database settings. Each, with its tests, is in `FINDINGS.md` ("Second go: where things stand").
Deferred by the owner and not touched: G12, G14, G3, G16 and the JavaScript reduction (G5).

### Capacity: before and after

Production-like set-up as in Stage C: 4 app processes, a pool of 5 each, Postgres at 60 connections, 30-80 ms
added to every database round trip, the same k6 mix and the same 5,000-home load set. "Before" was run again
today on the commit before the capacity work (`abf97c2`), so both sides share the machine and the day; it
matched Stage C closely. Results: `e2e/.reports/fixperf/{before,after,before-errors,after-errors}`, summarised by
`node e2e/load/summarise.mjs <folders>`. Browse and write: p50 / p95 / p99 in ms.

| Scenario | Req/s | Browse | Write | Failed | 5xx / no answer | Bookings / payments |
|---|---|---|---|---|---|---|
| average, before | 25.7 | 376 / 1,064 / 1,591 | 2,308 / 3,574 / 4,837 | 0.00% | 0 / 0 | 184 / 53 |
| average, after | 29.5 | 285 / **613** / 820 | 1,406 / **2,457** / 3,408 | 0.00% | 0 / 0 | 240 / 64 |
| ramp-up, before | 31.4 | 1,278 / 4,618 / 8,247 | 7,987 / 24,177 / 25,186 | 0.61% | 187 / 0 | 188 / 55 |
| ramp-up, after | 43.8 | 325 / **3,568** / 5,998 | 4,815 / **10,354** / 11,151 | 0.50% | 211 / 0 | 300 / 82 |
| spike, before | 36.9 | 775 / 10,417 / 10,674 | 10,004 / 30,002 / 30,002 | 10.38% | 1,853 / 208 | 88 / 14 |
| spike, after | 44.7 | 324 / 10,142 / 17,760 | 14,797 / 28,976 / 29,879 | **4.30%** | 1,039 / 5 | 109 / 29 |
| breakpoint (stops on latency), before | **38.4 at the stop** | 544 / 2,371 / 2,922 | 2,865 / 8,308 / 10,958 | 0.06% | 1 / 0 | 17 / 2 |
| breakpoint (stops on latency), after | **56.2 at the stop** | 269 / 1,665 / 2,318 | 1,687 / 5,224 / 7,931 | 0.00% | 0 / 0 | 20 / 10 |
| breakpoint (stops on errors), before | **48.4 at the stop** | 1,603 / 9,884 / 10,459 | 13,591 / 30,001 / 30,001 | 2.23% | 61 / 44 | 23 / 2 |
| breakpoint (stops on errors), after | **86.9 at the stop** | 297 / 10,003 / 10,296 | 8,971 / 28,603 / 29,548 | 2.70% | 256 / 0 | 30 / 11 |

"At the stop": requests served per second in the 30 s before k6 stopped the run (latency: browse p95 over 2 s or
write p95 over 5 s; errors: more than 2% failed). Req/s in the other rows is the whole run's average.

- **The breaking point moved from about 38 to about 56 requests a second on latency (+46%), and from about 48 to
  about 87 on errors (+80%).** Average-load p95 fell 42% for browsing and 31% for writes; the spike's failures
  fell from 10.4% to 4.3%, and requests with no answer at all from 208 to 5.
- **What still breaks first: the connection pool.** The errors left are Prisma P2024 (no connection within 10 s)
  and P2028 (a transaction could not start in time), most of them booking creation, which holds a serializable
  transaction. At the top of the ramp-up (200 visitors, above the breaking point) 41% of booking attempts failed
  (before: 50%), while 300 bookings succeeded (before: 188).
- **Money and date rules: clean before and after every run, 20 checks** (`e2e/.reports/invariants/fixperf-*`).
- No safety check, rate limit or money rule was changed for speed. One 429 in the average run and one in the
  ramp-up are the rate limits doing their job.
- App memory peaked at 268 MB a process (before: 229 MB), CPU at 176% of one core over the four (before: 128%):
  the servers do more work because they wait less. Database connections peaked at 33 in both.

One request at a time, through the 30-80 ms proxy (`e2e/.reports/stageB/server-timing-fixperf-{before,after}.json`),
p50 in ms; each round trip to the database costs about 300 ms on this proxy:

| Route | Before | After |
|---|---|---|
| a listing (`GET /api/listings/:id`) | 937 | 305 |
| one booking, as checkout reads it | 1,895 | 602 |
| a guest's bookings (dashboard) | 1,625 | 641 |
| a guest's messages | 1,358 | 621 |
| search (`limit=50`) | 581 | 348 |
| search with dates | 594 | 381 |
| a listing's reviews | 555 | 314 |
| the session check | 425 | 293 |
| exchange rate, homes per region | 298, 315 | 1, 1 (kept 30 s) |
| sign-in (bcrypt) | 2,067 | 1,174 |
| booking a home | 1,990 | 1,459 |
| starting a payment | 2,515 | 1,589 |

What changed (commit `974c70e`): Prisma's `relationJoins`, so a read with relations is one query; the public
exchange rate and homes per region kept 30 s per process (charges, refunds and payouts still read the rate from
the database); the booking transaction's three limit counts made one read; "already paid" and "already open" one
read inside the payment claim; sign-in's lookup alongside the attempt being written, and the session made
alongside the counter being cleared; a booking's digital address read with the booking; a listing's viewer looked
up alongside it.

Not done, and worth the next step: serving the last kept answer when a refresh of a kept read fails (in the
spike, some exchange-rate and region-count requests failed together when one refresh timed out); keeping the
booking transaction's connection for less time again (the conflict and blocked-date checks are still two reads);
and the payouts-due queries (G12, deferred).

### Bad networks after G6 (Stage B profiles, Chromium, median of 3)

| Profile | Home | Search | Listing | Checkout |
|---|---|---|---|---|
| stalls (5%) and resets (2%), Stage B | never | never | never | never |
| stalls and resets, after G6 | 8.6 s | 0.9 s | 0.9 s | 0.9 s |
| slow 4G, Stage B → after G6 | 3.8 → 4.0 s | 3.5 → 3.9 s | 4.5 → 5.0 s | 4.0 → 4.4 s |
| 3G, Stage B → after G6 | 5.3 → 5.5 s | 4.7 → 4.7 s | 5.7 → 6.2 s | 5.2 → 5.2 s |
| low-end Android, 3G, CPU 6x, Stage B → after G6 | 5.3 → 5.5 s | 4.8 → 5.3 s | 5.9 → 6.3 s | 5.3 → 5.3 s |

The first measurement after G6 was 0.3-0.5 s slower than Stage B on slow 4G (first paint the same, JavaScript
only 1-7 KB more): the guard was a plain inline script after the stylesheets, which held the page until they had
loaded. As a module script (`907df9a`) it does not. Final build, slow 4G: home 3.77 s, search 3.44 s, listing
4.45 s, checkout 3.95 s (Stage B: 3.77, 3.47, 4.46, 3.99). Stalls and resets, final build: home 0.7 s, search 0.9 s,
listing 0.9 s, checkout 0.9 s, no page stuck. Lighthouse on the final build (mobile, empty database, 3 runs): search
LCP 6.2 → 4.4 s (G9), other pages within 0.15 s of Stage B; JavaScript 1-7 KB more per page (G5 deferred).

The full suite also found two faults in the first G6 code, fixed in `d9861a7`: the session check returned on a 401
without reading the answer (the browser kept the request open, so pages never went quiet), and the guard's
page-load check fetched and ran a second time a chunk the app had added late. Both have unit tests and proofs.

### G13: the indexes were not applied

The live Supabase project could not be reached on 2026-10-21: the direct host and the project's own address have
no DNS record, and the pooler answers "tenant/user not found" on both ports. That is how a paused free-tier
project looks (the last work on it was 2026-10-14, seven days before). Nothing was run on it, and the schema was
not changed, so nothing that depends on the indexes was shipped. Ready in `.scratch/idx/`:

- `statements.sql`: the 16 approved statements (the 17 less `Booking_paid_checkIn_idx`).
- `apply.cjs`: dry run by default; with `--confirm` it runs one statement at a time, skips an index that is
  already there and valid, takes row counts and hashes of the nine tables before and after each, checks the
  index is valid and ready, and stops at the first surprise. Log in `apply-log.json`.
- `undo.sql`: one `DROP INDEX CONCURRENTLY IF EXISTS` per index.
- `schema-indexes.md`: the 15 `@@index` lines for `prisma/schema.prisma`, and the `migrate diff` to run.

One needs a decision: `Booking_live_checkOut_idx` is a partial index, which Prisma 6.19 cannot state in the
schema (`prisma validate` refuses `where:`), so `migrate diff` will always show it and `prisma db push` would drop
it. Keep it partial and record it in `prisma/constraints.sql` with that warning, or use the full index
`@@index([checkOut, checkIn, listingId])`, which the schema can hold.

### Final checks

| Check | Result |
|---|---|
| Lint | 0 errors (39 warnings, as before: unused names and `<img>` elsewhere) |
| Type check | passes |
| Unit tests in six time zones (`npm run test:tz`) | 1,468 passed in each, on the code after the capacity commit. Four tests were added after (1,472); their files passed alone. **A clean full run on the final code was not obtained:** the Mac was asleep on battery, and three runs each lost a different 2-13 timing tests to 5-second timeouts (one file took 736 s that normally takes seconds). Rerun `npm run test:tz` on mains power |
| Full suite, Chromium, final code | 186 passed, 4 skipped (the opt-in contrast measurement), none flaky; crash tests alone: 10 passed |
| Core set in Firefox, WebKit, tablet, iPhone, Android | 199 passed, 1 skipped (the map in Firefox), on `bb59a8e`'s code less the last change (the guard as a module); the resilience and session tests were then run twice in all six set-ups on the final code: 156 passed. **The full core-set rerun on the final code was not completed**: the Mac went to sleep on battery twice during it (tests taking 8-17 minutes each); its partial logs are `fixperf/browsers-final*.log` and do not count |
| Races at 50 rounds, twice | 31 passed, 31 passed (G15 included: 0 second payments) |
| Removal proofs, one pass under caffeinate | **244 of 244 hold**, tree clean after. (The first pass found 2 proofs, 50 and 115, whose text the capacity commit had rewritten; fixed in `bb59a8e`, then the whole pass was run again) |
| Full production build | passes, built through the harness (`node e2e/run.mjs build`) with the fake environment: `npm run build` with `.env` would upload source maps to Sentry, because `SENTRY_AUTH_TOKEN` is set there |
| Money and date rules | clean after every test and before and after every load run |

Also: during the final checks a command meant to compare lint counts restored the old branch's files over the
working tree (`git checkout e2e-performance -- .`) and stashed the uncommitted FINDINGS draft. Everything was
committed, so the tree was restored from `HEAD` at once and the draft taken back from the stash; `git status`
and the diff against `HEAD` were checked clean. Nothing was lost.

---

## Second go: final report (2026-10-16)

Branch `e2e-performance`, not merged. Everything ran on this MacBook Air against the local test stack (production build, local Postgres, the fakes and the guards); nothing real was touched; no switch was set in `.env`; no real email or SMS was sent. Nothing under `src/` was changed. Before Stage A the post-merge run on `main` was repeated in full and passed (build, smoke 7/7, 220/220 removal proofs, build, smoke 7/7, tree clean).

### Pass / fail by area

| Area | Result |
|---|---|
| WebKit log-in through the form (https front) | pass: the 18 skipped tests run and pass |
| New browser journeys (6, all six browser set-ups) | pass |
| Chromium suite | pass (168 passed, 4 skipped); one run had one flaky test each time (the two-tab checkout, which led to G15; a rent race whose test picked the 31st of a month, fixed in the test) |
| Other browsers | pass (138 passed, 1 skipped, 1 flaky: G3) |
| Lighthouse budgets, mobile | **fail** on LCP for every page; pass on CLS and TBT; JS over on search, guest dashboard, listing |
| Lighthouse, desktop | pass |
| Bad networks and slow phones | usable in 3.5-5.9 s on slow 4G / 3G; **fail** with lost requests (G6) |
| Double submission, offline at Pay, lost answers | pass, except a lost answer to Book (G7) |
| Page to page | pass (70-170 ms, no shift, no reloads); scroll position lost on back (G8) |
| Server timing | pass for guest and host routes (p95 under 45 ms); admin overview, Verifications and the payout job slow at volume (G12) |
| Load: average, soak | pass (0 errors, no drift, no leak) |
| Load: ramp-up, spike, breakpoint | thresholds crossed at about 43-45 requests a second; recovers by itself |
| Money and date rules | **held after every test and every load scenario** |

### Findings of the second go, ranked

- **High:** G6 (one failed request leaves the page stuck), G15 (a second payment opened for a booking just paid), G2 (search by city finds almost nothing once there are more than 50 homes).
- **Medium:** G1 (one failed session check signs a guest out), G5 (mobile LCP over budget everywhere), G7 (lost answer to Book), G11 (a short stay's booking page is linked nowhere in the app), G12 (payouts-due queries read all history), G13 (unindexed foreign keys).
- **Low:** G3 (WebKit search flake, not confirmed), G4 (full-size thumbnails), G8 (scroll lost on back), G9 (lazy images above the fold), G10 (home page cached an hour), G14 (sign-in CPU), G16 (more connections than the pool once, not confirmed).

Each, with how to reproduce it, is in `FINDINGS.md`. **Nothing is fixed under `src/`: every one waits for your decision.**

### Fixed in test code only (already done)

The https front and its redirect handling; the WebKit console filter for the fake Sentry address; the admin card pins in the new journeys; the rent journey's check (it now checks the next month is offered); the date helper in `races/rent.spec.ts` (the 29th-31st); the removal-proof runner (journalled, resumable, restores on any stop); and harness bugs in my own stage scripts (the stack started in the foreground, the latency proxy reordering bytes, the sampler not stopping, zsh taking the scenario list as one word, selectors in the conditions spec). Two new tests mark known faults with `test.fail()`: G1 (`tests/resilience/session.spec.ts`) and G15 (`tests/races/bookings.spec.ts`).

### Needs your decision

Every G finding; the proposed indexes; the payouts-due design (G12); the search fix (G2: the API already accepts `city`); the sign-in hashing cost; the pool and region settings; whether per-address limits suit shared mobile addresses.

### Not tested, and why

- Real Supabase, Supavisor, Vercel, Paystack, Resend, Arkesel, MapTiler, Sentry: never touched, by the rules. Their behaviour is stood in for by the fakes and the latency proxy, which cannot reproduce Supavisor's pooling, the real network, TLS to the database, serverless instances, cold starts or CDN caching.
- Map tiles: MapTiler is answered with a blank style, so map tile downloads and drawing cost are not in any number.
- Real phones and real mobile networks: approximated with Chrome's throttling (Chromium only; WebKit and Firefox cannot be throttled this way).
- A load generator on separate hardware: k6 shared this Mac with the servers.
- The money flows under load beyond instant booking and card payment: refunds, payouts, disputes and rent reminders were not in the load mix (they are covered by the race and journey tests).
- Lighthouse on pages behind sign-in uses a session cookie added to every request; it does not include the time to log in.
- Accessibility, security and unit tests were not rerun in this go except as part of the Chromium suite; the removal proofs were run on `main` before Stage A.
- Shared mobile carrier addresses (CGNAT) against the per-address rate limits.

---

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

## Second go, Stage B: performance (2026-10-15, branch `e2e-performance`)

Chromium, production build, this MacBook Air. Machine at the start: 36 GB free, on mains power, no thermal or performance warning. Results in `e2e/.reports/stageB/`.

### B1. The load set

`e2e/load/seed.sql`: 20,000 users, 5,000 listings, 50,000 bookings, 200,000 blocked dates, 100,000 messages, 55,814 payments, 29,600 rent instalments, 47,495 payouts, 17,087 reviews, 30,000 wishlist entries. Set-based SQL, "random" values are hashes of each row's key so a rebuild is the same, dates counted from the day it is seeded, all ids `load_`. **Seeding takes 11-12 s, ANALYZE 1.6 s, 264 MB.** The money and date rules hold over the whole seeded database. Removing the set takes 238 s, against 11 s to make it: deleting bookings and users checks unindexed columns (see G13).

### B2. Lighthouse 12.8.2 against the budgets (mobile: simulated slow 4G, CPU 4x; median of 5 runs, seeded database)

| Page | LCP ≤ 2.5 s | CLS ≤ 0.1 | TBT ≤ 200 ms | JS ≤ 350 KB | of which map | Score | Empty DB: LCP / score |
|---|---|---|---|---|---|---|---|
| home | 3.6 s (**over**) | 0.000 (pass) | 30 ms (pass) | 318 KB (pass) | 0 KB | 91 | 3.5 s / 91 |
| search with map | 7.1 s (**over**) | 0.000 (pass) | 178 ms (pass) | 602 KB (**over**) | 282 KB | 74 | 6.2 s / 77 |
| listing | 4.2 s (**over**) | 0.038 (pass) | 63 ms (pass) | 353 KB (**over**) | 0 KB | 86 | 4.2 s / 86 |
| checkout | 4.1 s (**over**) | 0.077 (pass) | 64 ms (pass) | 313 KB (pass) | 0 KB | 86 | 4.1 s / 86 |
| guest dashboard | 3.8 s (**over**) | 0.000 (pass) | 63 ms (pass) | 356 KB (**over**) | 0 KB | 88 | 3.9 s / 88 |
| host dashboard | 3.3 s (**over**) | 0.062 (pass) | 62 ms (pass) | 330 KB (pass) | 0 KB | 92 | 4.4 s / 85 |
| admin | 4.2 s (**over**) | 0.000 (pass) | 58 ms (pass) | 342 KB (pass) | 0 KB | 85 | 4.1 s / 86 |

Desktop (LCP / score): home 0.6 s / 100; search with map 1.5 s / 95; listing 0.9 s / 99; checkout 0.9 s / 99; guest dashboard 1.2 s / 98; host dashboard 1.0 s / 99; admin 0.9 s / 99. All within budget on desktop.

- **LCP is over budget on every page on mobile.** CLS and TBT are within budget everywhere. JS is over on search (602 KB), the guest dashboard (356) and a listing (353).
- Why: about 300 KB of JavaScript every page loads before it can draw its data, then the data is fetched from the browser. The LCP element on checkout, the dashboards and admin is text that appears only after JS + an API call. Biggest shared pieces: the Sentry browser SDK chunk (134 KB, with tracing code although tracing is off; about 63 KB of it unused), react-datepicker (46 KB) loaded on every page, the framework (44 KB). Two render-blocking stylesheets cost about 300 ms on slow 4G. Three font files, 63 KB.
- **The map library is not loaded on pages without a map** (0 KB on all of them). On search it is 282 KB of the 602 KB; 190 KB of it is unused at first paint.
- Search's LCP is the first listing card's photo, which is `loading="lazy"` although it is above the fold.
- Checkout and both dashboards download each listing photo full size (1200 px, 120 KB) for an 80-px thumbnail, straight from the photo host, not through the image optimiser.
- Data volume hardly changes the first load (empty and seeded within 0.2 s except search: 6.2 s empty, 7.1 s seeded), because pages draw first and fetch afterwards.

### B3. Real conditions (Playwright, Chromium, median of 3; "usable" = the main control is on screen and React has attached to it)

| Profile | Home | Search | Listing | Checkout |
|---|---|---|---|---|
| desktop, no throttling | 0.2 s | 0.3 s | 0.2 s | 0.2 s |
| slow 4G | 3.8 s | 3.5 s | 4.5 s | 4.0 s |
| 3G | 5.3 s | 4.7 s | 5.7 s | 5.2 s |
| latency 300-600 ms per request | 1.2 s | 1.4 s | 2.0 s | 2.0 s |
| stalls (5%) and connection resets (2%) | **never** | **never** | **never** | **never** |
| CPU 4x slower | 0.5 s | 1.0 s | 0.6 s | 0.5 s |
| iPhone size, slow 4G, CPU 4x | 3.8 s | 3.6 s | 4.5 s | 4.1 s |
| low-end Android size, 3G, CPU 6x | 5.3 s | 4.8 s | 5.9 s | 5.3 s |

First paint is 1.5-1.7 s on slow 4G and 3G; the page is usable 2-4 s later. Nothing shifts (CLS 0 to 0.04).

**"Never" is a finding (G6), not a slow page:** with one reset among the page's requests, every page stayed on its loading state for the whole 60 s. Probes, one failure at a time: a reset JavaScript chunk leaves checkout on "Loading booking details…" for good, with no retry and no error; a reset booking request shows "Booking unavailable… Go back and pick new dates" (the booking is fine); a reset session check sends the guest to log-in (G1).

Money under bad conditions:

| Check | Result |
|---|---|
| Pay pressed three times on slow 4G | 1 request sent, 1 payment row: protected |
| Offline when Pay is pressed | the guest is told ("Network error…"); nothing recorded; online again, one press, paid once |
| The answer to Pay lost on the way back | the payment had been started; pressing Pay again hands back the same one: 1 row, paid once |
| The answer to Book lost on the way back | the booking **was** made; the guest is told nothing, and pressing Book again says "Those dates just became unavailable" (G7) |

### B4. Page to page (Chromium, 5 runs, cold and warm)

| Pair | Click to visible (cold / warm) | Layout shift | Blank or flash |
|---|---|---|---|
| home → search | 166 / 164 ms | 0 | a spinner for 2 frames |
| search → listing (card) | 141 / 148 ms | 0 | 1 blank frame |
| home → how it works | 72 / 69 ms | 0 | none |
| how it works → FAQ | 119 / 108 ms | 0 | none |
| host dashboard → host bookings | 102 / 112 ms | 0 | a spinner for 2 frames |

No full page reloads; every link stayed a client-side navigation. Header links are all prefetched; on the search grid only the cards in view are (12 of 56, Next's normal rule). Back from a listing to search takes 159 ms but **the place in the results is lost** (the list scrolls inside its own panel and comes back at the top, G8). Gallery: first photo eager, the rest lazy, all through the optimiser; search grid: all optimised, but the first five, above the fold, are lazy (G9).

Not measured, and why: home → listing (the cached home page links to a listing that no longer exists, G10) and guest dashboard → booking (a short stay has no link to its booking page anywhere in the app, G11).

### B5. Server timings (seeded database, one request at a time, 50 per route after 3 warm-ups)

No route answered 5xx. Everything a guest touches is under 45 ms at p95. The slow ones:

| Route | p50 | p95 | p99 |
|---|---|---|---|
| `GET /api/admin?type=stats` (admin overview) | 690 ms | 706 ms | 712 ms |
| `GET /api/admin/verifications` | 642 ms | 684 ms | 687 ms |
| `process-payouts` (dry run) | 302 ms | 308 ms | 308 ms |
| `POST /api/auth/signin` (bcryptjs, cost 12) | 222 ms | 237 ms | 240 ms |
| `POST /api/auth/signup` (bcryptjs) | 222 ms | 224 ms | 228 ms |
| `GET /api/admin/listings` | 104 ms | 111 ms | 112 ms |
| `GET /api/admin/users` | 95 ms | 99 ms | 122 ms |
| `GET /api/admin/listing-checks` | 82 ms | 84 ms | 109 ms |
| `GET /api/listings` with dates | 41 ms | 43 ms | 48 ms |

Full list: `server-timing-seeded.json`. The 15 slowest statements with their plans (EXPLAIN ANALYZE, BUFFERS via auto_explain): `explain-top15.json`. The two slowest by far (174 ms and 134 ms) are the "payouts due" queries, run by the payout job, the admin overview and the Verifications tab: each walks every paid booking in history (42,039 and 28,635 rows) and checks Payout for each (G12). Search with dates reads every booking for the overlap test (53 ms).

Sequential scans during one pass: Booking 35.6 M rows read (711 scans), Payment 19.1 M (342, never by index), Message 15.9 M (159), Payout 10.8 M, Review 5.4 M (318, never by index). Unused indexes: only unique keys that guard against duplicates (kept on purpose).

**Proposed indexes** (`e2e/load/proposed-indexes.sql`, shown, not run on any live database; applied to the test database only to measure, then removed): 17 indexes on foreign keys and the date search. Measured, 30 requests a route: p95 falls 40-70% on the routes people use most (a guest's bookings 11.2 → 4.7 ms, payments 10.5 → 3.1, messages 10.5 → 4.3, a host's bookings 12.6 → 6.9, booking a home 15.5 → 6.0, a listing 11.0 → 3.0); date search 43 → 39 ms; the slow admin routes and payout job unchanged. One candidate, `Payout(instalmentId)`, made the payout job and both slow admin routes 10-20% slower, and is left out.

Invariants after Stage B: all hold (`e2e/.reports/invariants/end-of-B.json`).

---

## Second go, Stage C: load, concurrency, stress, soak (2026-10-15/16, branch `e2e-performance`)

**The load generator (k6 2.3.0) ran on the same MacBook Air as the four app servers, Postgres and the fakes.** Every number below includes that competition for the same 10 cores. k6 2.3.0 is the official macOS arm64 release archive; its SHA-256 matches the checksum file published with the release (both from the same GitHub release; the binary has no Apple signature). Machine at the start: 35 GB free, on mains power, no thermal or performance warning; none was recorded during any run.

### The set-up, and what it cannot reproduce

| Production | Here |
|---|---|
| `DATABASE_URL`: Supavisor transaction pooler (`*.pooler.supabase.com:6543`, `?pgbouncer=true`), **no `connection_limit`, no `pool_timeout`** in the URL, so Prisma uses its defaults: `physical CPUs × 2 + 1` connections per server instance and a 10 s wait for one | `connection_limit=5` per app process, set by `run.mjs up --pool=5` (Prisma's default on a 2-vCPU function; left unset here it would be 21 per process on this 10-core Mac). Prisma's 10 s wait, unchanged |
| Supabase Postgres, its own connection limit | Postgres 17 (native arm64), `max_connections=60` |
| Many Vercel function instances | **4** `next start` processes sharing the database (`--apps=4`), each request sent to one of them by the visitor's number |
| The network between Vercel and Supabase | a TCP proxy adding 30-80 ms to every round trip to Postgres (`--db-latency=30-80`, `e2e/fakes/db-latency.mjs`) |

Cannot reproduce: Supavisor itself (its pool size, queueing and transaction-mode behaviour), the real network and TLS to the database, Vercel's serverless model (instances started and stopped on demand, one-at-a-time vs Fluid concurrency, the function time limit), cold starts, CDN caching of pages, a load generator on separate hardware, real Paystack and real phones.

Traffic: each virtual user (VU) is one visitor with its own address in `x-vercel-forwarded-for`, so the rate limits stayed **on**. Mix per round: 60% browse and search, 25% listing views, 8% sign-in and dashboards, 5% bookings (instant book, far-future dates on load listings), 2% payments (book, start, pay at the fake Paystack, come back through verify). Think time 1-5 s between pages. Seeded database throughout. Order run: smoke, average, ramp-up, spike, breakpoint, soak; each resumable (`e2e/load/stage-c.sh`).

### Results per scenario (browse and write: p50 / p95 / p99 in ms; app CPU is the four processes added together, 100% = one core)

| Scenario | Requests | Req/s | Browse | Write | Failed | 5xx / no answer / 429 | Bookings / payments | App CPU max | App memory max | DB connections max |
|---|---|---|---|---|---|---|---|---|---|---|
| smoke (2 VUs, 1 min) | 89 | 1.2 | 329 / 932 / 1,449 | 2,052 / 2,055 / 2,055 | 0.00% | 0 / 0 / 0 | 1 / 0 | 6% | 781 MB | 9 |
| average (50 VUs, 10 min) | 16,987 | 25.2 | 378 / 1,067 / 1,599 | 2,329 / 3,732 / 5,029 | 0.00% | 0 / 0 / 0 | 197 / 65 | 110% | 1,085 MB | 21 |
| ramp-up (to 200 VUs, 16 min) | 30,721 | 31.7 | 1,284 / 4,596 / 8,111 | 8,025 / 24,328 / 25,225 | 0.59% | 182 / 0 / 0 | 196 / 59 | 133% | 996 MB | 21 |
| spike (50 → 500 VUs in 10 s) | 19,789 | 36.6 | 839 / 10,430 / 10,700 | 5,093 / 30,002 / 30,002 | 10.25% | 1,820 / 208 / 0 | 81 / 23 | 160% | 1,053 MB | 33 |
| breakpoint, stops on latency | 1,807 | 29.3 | 570 / 2,304 / 2,848 | 2,580 / 6,955 / 8,756 | 0.06% | 1 / 0 / 0 | 14 / 2 | 93% | 979 MB | 33 |
| breakpoint, stops on errors (declared rerun) | 4,869 | 38.1 | 1,336 / 10,007 / 10,702 | 18,038 / 30,002 / 30,002 | 2.03% | 57 / 42 / 0 | 12 / 2 | 141% | 1,024 MB | 33 |
| soak (50 VUs, 60 min) | 104,775 | 29.0 | 404 / 1,120 / 1,675 | 2,374 / 3,752 / 5,613 | 0.00% | 1 / 0 / 3 | 1,219 / 327 | 81% | 1,019 MB | 33 |
| no DB latency: breakpoint, stops on errors (declared) | 124,435 | 267.1 | 249 / 6,422 / 10,808 | 1,231 / 29,791 / 30,001 | 2.19% | 385 / 2,338 / 9 | 887 / 209 | 495% | 1,316 MB | 21 |
| no DB latency: sign-in only (declared) | 877 | 10.0 | 230 / 2,169 / 2,749 | – | 0.11% | 0 / 0 / 0 | – | 405% | 876 MB | 21 |

**The money and date rules held before and after every scenario: 17 checks in this stage (19 with Stage B's two), none broken** (`e2e/.reports/invariants/`).

- **Average and soak** (50 visitors): no failures; browse p95 about 1.1 s, writes p95 about 3.7 s. The time is spent waiting on database round trips (each route makes several, one after another; one listing search is 557 ms through 30-80 ms against 15 ms without), not on CPU: the four processes used a quarter of one core between them.
- **Soak drift: none.** Requests per second, p50 and p95 were the same in every 10-minute slice (p95 1.63-1.82 s); memory per process settled at 240-251 MB by minute 10 and ended at 250-254 MB; connections steady at 33; no lock waits; 1 error in 104,775 requests.
- **Ramp-up:** from about 100 visitors every connection is held "idle in transaction" (a transaction waiting on its next round trip), throughput stops rising at about 60 transactions a second, and requests queue for a connection. 180 of 376 bookings (48%) failed with 500 (Prisma P2028: no connection to start the transaction in time); sign-in p50 13 s, p95 25 s; even the one-row exchange-rate read waited 2.2 s.
- **Spike:** throughput capped at about 56 requests a second; 10% of requests failed during the spike (Prisma P2024, "timed out fetching a new connection", 1,806 times; 208 sign-ins got no answer in 30 s). **It recovered by itself within 30 s** of the spike ending. HTML pages stayed under 10 ms throughout (they are static).
- **Breakpoint:** latency breaks first, at **about 43 requests a second** (browse p95 over 2 s; writes 7 s), with errors still 0.06%. Rerun once, declared, stopping on errors instead: errors pass 2% at **about 45 requests a second**, sign-in and booking first.
- **First bottleneck: the database connection pool**, not CPU. Transactions hold a connection for several round trips each, so 20 connections at 30-80 ms run out at about 45 requests a second.
- **Your prediction (sign-in CPU because of bcrypt):** refuted with database latency, where CPU stayed low while the pool ran out. **Confirmed where the database is fast:** run without the latency proxy (declared), sign-in alone saturates every process at about **15 sign-ins a second across 4 processes, about 4 a second per process** (each takes about 220 ms of single-threaded CPU in bcryptjs); and the full mix scales to about **300 requests a second clean and 370 at most**, when all four processes reach 100% CPU, booking failing first (serializable retries exhausted, then pool timeouts).

### Capacity, in plain words

On the production-like set-up (4 server processes, 5 connections each, 30-80 ms to the database):

- **Browsing:** about **50-70 people browsing at once** with normal pauses (about 30-40 requests a second) stay comfortable: no errors, pages' data in about 0.4 s typical, 1.1 s at worst for 1 in 20. Beyond about 100 at once it slows sharply; at 500 at once 1 request in 10 fails.
- **Bookings:** about **20 a minute** with 0 errors during the soak (1,219 in an hour) alongside that browsing; at 100-200 visitors half the booking attempts failed.
- **Payments:** about **5 a minute** with 0 errors during the soak (327 in an hour); payment starts failed rarely (2 of 68) in ramp-up.
- **What breaks first:** the database connections (the pool), from the number of round trips each request makes while holding one. Then sign-in and booking, which hold transactions longest.

What it implies for Vercel + Supabase (an inference from these runs, not a measurement of them):

- Response time will be set mostly by **the round-trip time between the Vercel function region and the Supabase region**, multiplied by the number of queries each route makes in turn (about 10 for a listing search). At 30-80 ms that is 0.4-0.6 s per API call; if the two regions are on different continents (100-200 ms), expect 1-2 s per call before any load.
- Capacity will be set by **Supavisor's pool size for the plan** (how many transactions can run at once), not by how many function instances Vercel starts. More instances only queue more work at the pooler. The ceiling seen here (about 20 transactions at once, about 45 requests a second) is of the same order as Supabase's smaller computes.
- Each function instance's Prisma pool is unset in production. Under transaction pooling each instance can open `CPUs × 2 + 1` client connections; many instances can exhaust Supavisor's client limit before its pool.
- Sign-in costs about 220 ms of CPU per request; on a function that serves several requests at once (Fluid compute) it holds up every request on that instance meanwhile.

### What to change or buy before launch, ranked

1. **Put Vercel's function region next to Supabase's region** (same cloud region), and choose that region for Ghana (for example Supabase `eu-west-2` London with Vercel `lhr1`, or the nearest pair available). Free; the largest single effect on every response.
2. **Fix G6 and G1** (pages that stay stuck after one failed request; one failed session check signs a guest out). They are what people on mobile data will meet first, at any load.
3. **Fix G15** (a second payment opened for a booking just paid) before taking real money.
4. **Cut database round trips on the busy paths and shorten interactive transactions**: run independent queries together, read the exchange rate, region counts and featured listings from a short cache (every page asks for them), and keep work that does not need the transaction outside it. This raises what the same pool can carry.
5. **Apply the proposed indexes** (`e2e/load/proposed-indexes.sql`, G13), through a reviewed migration.
6. **Set the pool explicitly**: add `connection_limit` (for example 3-5) and `pool_timeout` to `DATABASE_URL` on Vercel, and **size the Supabase compute for its pooler limits** (a larger compute has a larger pool). Watch connection counts in the Supabase dashboard during the first weeks (G16).
7. **Make sign-in cheaper**: native `bcrypt` instead of `bcryptjs`, or cost 11 (about half the CPU of 12) after a security review; existing hashes still verify.
8. **Change the payouts-due queries** (G12) before booking history grows: they read every paid booking on every run.
9. **Rate limits:** they held throughout (3 refusals in the soak, all intended). Not tested here: many people in Ghana reach the internet through mobile carriers' shared addresses (carrier-grade NAT), so per-address limits (20 sign-in failures and 5 sign-ups an hour) may refuse real people who share one address. Worth a decision.
10. **Vercel Pro** is already planned; its function limits were not tested here.

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
